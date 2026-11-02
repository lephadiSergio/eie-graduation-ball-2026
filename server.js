import express from 'express';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {db,rpc,DatabaseError} from './lib/db.js';
import {passwordOK,sign,verify,qrID} from './lib/security.js';
import {prepareOrder} from './lib/issuance.js';
import {ticketPDF} from './lib/pdf.js';
import {sendTestEmail} from './lib/mail.js';
import {mailConfigured,issuanceEnabled} from './lib/readiness.js';
import {startMailWorker,stopMailWorker} from './lib/worker.js';
import {acceptanceProbe} from './lib/diagnostics.js';
const required=['SESSION_SECRET','QR_SECRET','ADMIN_PASSWORD_HASH','SCANNER_PASSWORD_HASH','ADMIN_ID','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
for(const key of required)if(!process.env[key])throw Error('Missing environment variable: '+key);
for(const key of ['SESSION_SECRET','QR_SECRET'])if(process.env[key].length<32)throw Error(key+' requires at least 32 characters');
if(!/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(process.env.ADMIN_PASSWORD_HASH))throw Error('ADMIN_PASSWORD_HASH must be a valid scrypt hash');
if(!/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(process.env.SCANNER_PASSWORD_HASH))throw Error('SCANNER_PASSWORD_HASH must be a valid scrypt hash');
const app=express(),root=path.dirname(fileURLToPath(import.meta.url));
const appOrigin=process.env.APP_ORIGIN||process.env.RENDER_EXTERNAL_URL;
if(!appOrigin)throw Error('Set APP_ORIGIN or deploy on Render (RENDER_EXTERNAL_URL)');
const origins=new Set([appOrigin,process.env.PAGES_ORIGIN].filter(Boolean));
if(process.env.NODE_ENV==='production')app.set('trust proxy',1);
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','blob:'],mediaSrc:["'self'",'blob:'],connectSrc:["'self'"],workerSrc:["'self'",'blob:'],objectSrc:["'none'"],frameAncestors:["'none'"],upgradeInsecureRequests:process.env.NODE_ENV==='production'?[]:null}}}));
app.use(express.json({limit:'16kb'}));
app.use('/api',(req,res,next)=>{
 res.set('Cache-Control','no-store');const origin=req.get('origin');
 if(origin&&origins.has(origin)){res.set('Access-Control-Allow-Origin',origin);res.vary('Origin');res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.set('Access-Control-Allow-Headers','Content-Type, Authorization, Idempotency-Key');res.set('Access-Control-Max-Age','600')}
 if(req.method==='OPTIONS')return res.sendStatus(origins.has(origin)?204:403);
 if(req.method!=='GET'&&!origins.has(origin))return res.status(403).json({error:'Origin rejected'});
 next();
});
app.use('/api',rateLimit({windowMs:60000,limit:1200,standardHeaders:'draft-8',legacyHeaders:false}));
const cookie=(value,age)=>'session='+value+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+age+(process.env.NODE_ENV==='production'?'; Secure':'');
function sessionFrom(req){const token=req.get('authorization')?.match(/^Bearer (.+)$/)?.[1]||(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8);const value=verify(token,process.env.SESSION_SECRET);try{const session=JSON.parse(Buffer.from(value||'','base64url').toString());if(!Number.isFinite(session.exp)||session.exp<Date.now()||!session.sid)throw Error();return session}catch{return null}}
async function auth(req,res,next){const s=sessionFrom(req);if(!s)return res.status(401).json({error:'Please sign in'});const [session]=await db('staff_sessions?id=eq.'+encodeURIComponent(s.sid)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=*');if(!session)return res.status(401).json({error:'Session expired. Please sign in'});req.session=session;req.admin=session.staff_id;next()}
function manager(req,res,next){if(req.session.role!=='admin')return res.status(403).json({error:'Ticket-management access required'});next()}
app.post('/api/login',rateLimit({windowMs:15*60000,limit:15,standardHeaders:'draft-8',legacyHeaders:false}),async(req,res)=>{
 const role=req.body.role==='scanner'?'scanner':'admin';const hash=role==='scanner'?process.env.SCANNER_PASSWORD_HASH:process.env.ADMIN_PASSWORD_HASH;
 if(typeof req.body.password!=='string'||req.body.password.length>256||!hash||!passwordOK(req.body.password,hash))return res.status(401).json({error:'Incorrect password or staff access unavailable'});
 const station=String(req.body.station||'Main').trim();if(!/^[a-zA-Z0-9 -]{1,30}$/.test(station))return res.status(400).json({error:'Enter a station name using 1-30 letters or numbers'});
 const sid=randomUUID(),exp=Date.now()+8*3600000;const admin=process.env.ADMIN_ID+':'+station;
 await db('staff_sessions',{method:'POST',body:{id:sid,staff_id:admin,role,expires_at:new Date(exp).toISOString()}});
 const token=sign(Buffer.from(JSON.stringify({sid,exp})).toString('base64url'),process.env.SESSION_SECRET);
 res.setHeader('Set-Cookie',cookie(token,8*3600));res.json({ok:true,role,...(process.env.PAGES_ORIGIN&&req.get('origin')===process.env.PAGES_ORIGIN?{token}:{})});
});
app.post('/api/logout',async(req,res)=>{const session=sessionFrom(req);if(session)await db('staff_sessions?id=eq.'+encodeURIComponent(session.sid),{method:'DELETE'});res.setHeader('Set-Cookie',cookie('',0));res.json({ok:true})});
app.get('/health',(_,res)=>res.json({ok:true}));
app.use('/api',auth);
app.get('/api/session',(req,res)=>res.json({admin:req.admin,role:req.session.role}));
app.get('/api/readiness',manager,async(_,res)=>{await rpc('event_stats');res.json({database:true,mail_configured:mailConfigured(),issuance_enabled:issuanceEnabled(),scanner_login_configured:Boolean(process.env.SCANNER_PASSWORD_HASH)})});
app.post('/api/email-test',manager,rateLimit({windowMs:60*60*1000,limit:3,standardHeaders:'draft-8',legacyHeaders:false}),async(req,res)=>{
 if(!mailConfigured())return res.status(503).json({error:'Email credentials are incomplete. Check Gmail environment settings in Render.'});
 const to=typeof req.body.email==='string'?req.body.email.trim():'';
 if(to.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))return res.status(400).json({error:'Enter a valid test email address.'});
 try{await sendTestEmail(to);res.json({ok:true})}
 catch(e){console.error(JSON.stringify({event:'email_test_failed',type:e.name,status:e.status,code:e.code}));res.status(502).json({error:e.message.startsWith('Gmail ')?e.message:'Test email failed. Check the OAuth and sender settings in Render.'})}
});
app.get('/api/stats',manager,async(_,res)=>res.json(await rpc('event_stats')));
app.get('/api/tickets',manager,async(req,res)=>{const offset=Math.min(100000,Math.max(0,Number.parseInt(req.query.offset)||0));res.json(await db('tickets?is_test=eq.false&select=*&order=issued_at.desc,id&limit=200&offset='+offset))});
app.post('/api/tickets',manager,async(req,res)=>{
 if(!issuanceEnabled())return res.status(503).json({error:'Official issuance is locked until Gmail is configured and ISSUANCE_ENABLED=true'});
 let order;try{order=prepareOrder(req.body)}catch(e){return res.status(400).json({error:e.message})}
 const key=req.get('Idempotency-Key');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key||''))return res.status(400).json({error:'A UUID v4 Idempotency-Key is required'});
 const tickets=await rpc('issue_order',{p_id:key,p_hash:order.hash,p_tickets:order.tickets,p_admin:req.admin,p_is_test:false});res.status(201).json(tickets);
});
app.get('/api/orders/:id',manager,async(req,res)=>res.json(await db('tickets?is_test=eq.false&order_id=eq.'+encodeURIComponent(req.params.id)+'&order=id')));
const minimal=t=>{if(!t)return undefined;const {id,attendee_name,student_number,ticket_option,status,checked_in_at,scanned_by}=t;return {id,attendee_name,student_number,ticket_option,status,checked_in_at,scanned_by}};
app.get('/api/search',async(req,res)=>{const q=String(req.query.q||'').trim();if(q.length<2||q.length>90)return res.status(400).json({error:'Search requires 2-90 characters'});const term=q.replace(/[(),.*%_\\]/g,'').trim();if(term.length<2)return res.json([]);const records=await db('tickets?is_test=eq.false&select=id,attendee_name,student_number,ticket_option,status,checked_in_at,scanned_by&or='+encodeURIComponent('(student_number.ilike.*'+term+'*,attendee_name.ilike.*'+term+'*)')+'&limit=30&order=attendee_name');res.json(records.map(minimal))});
app.get('/api/tickets/:id/pdf',manager,async(req,res)=>{const [t]=await db('tickets?id=eq.'+encodeURIComponent(req.params.id)+'&is_test=eq.false');if(!t)return res.sendStatus(404);res.type('pdf').set('Content-Disposition','attachment; filename="'+t.id+'.pdf"').send(await ticketPDF(t))});
app.post('/api/tickets/:id/retry',manager,async(req,res)=>{if(!mailConfigured())return res.status(503).json({error:'Email service not configured'});const queued=await rpc('retry_mail',{p_id:req.params.id});if(!queued)return res.status(409).json({error:'Ticket is cancelled, missing or currently sending'});res.json({ok:true,queued:true})});
app.post('/api/tickets/:id/cancel',manager,async(req,res)=>{const reason=String(req.body.reason||'').trim();if(reason.length<3||reason.length>200)return res.status(400).json({error:'Provide a cancellation reason (3-200 characters)'});if(!await rpc('cancel_ticket',{p_id:req.params.id,p_admin:req.admin,p_reason:reason}))return res.status(409).json({error:'Only an issued, unused ticket can be cancelled'});res.json({ok:true})});
const scanLimit=rateLimit({windowMs:60000,limit:120,keyGenerator:req=>req.session.id,standardHeaders:'draft-8',legacyHeaders:false});
app.post('/api/scan',scanLimit,async(req,res)=>{const id=qrID(req.body.payload,process.env.QR_SECRET);if(!id)return res.json({result:'invalid'});const result=await rpc('redeem_ticket',{p_id:id,p_admin:req.admin});res.json({result:result.result,ticket:minimal(result.ticket)})});
app.post('/api/manual-check-in',scanLimit,async(req,res)=>{if(typeof req.body.id!=='string'||!/^EIE-GB-[A-F0-9]{24}$/.test(req.body.id))return res.status(400).json({error:'Invalid ticket ID'});const result=await rpc('redeem_ticket',{p_id:req.body.id,p_admin:req.admin});res.json({result:result.result,ticket:minimal(result.ticket)})});
let diagnosticRunning=false;
app.post('/api/diagnostics',manager,rateLimit({windowMs:60000,limit:1}),async(req,res)=>{if(diagnosticRunning)return res.status(409).json({error:'A system check is already running'});diagnosticRunning=true;try{res.json(await acceptanceProbe(req.admin))}finally{diagnosticRunning=false}});
const vendors={'html5-qrcode.js':'html5-qrcode/html5-qrcode.min.js','qrcode.js':'qrcode-generator/dist/qrcode.js','jspdf.js':'jspdf/dist/jspdf.umd.min.js'};
for(const [name,file] of Object.entries(vendors))app.get('/vendor/'+name,(_,res)=>res.sendFile(path.join(root,'node_modules',file)));
app.use(express.static(path.join(root,'public'),{index:'index.html'}));
app.get(['/admin','/scan'],(_,res)=>res.sendFile(path.join(root,'public/index.html')));
app.use((err,req,res,next)=>{console.error(JSON.stringify({event:'request_failed',path:req.path,type:err.name,status:err.status,code:err.code}));const status=err instanceof DatabaseError&&err.status===409?409:err.status===400?400:503;res.status(status).json({error:status===409?err.message:status===400?'Invalid JSON request':'Service temporarily unavailable. Check the roster and retry using the same order.'})});
const server=app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('EIE Ball server ready'));
if(mailConfigured()&&process.env.MAIL_WORKER_ENABLED!=='false')startMailWorker();
async function shutdown(){server.close();await stopMailWorker();process.exit(0)}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
