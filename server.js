import express from 'express';

import helmet from 'helmet';

import {rateLimit} from 'express-rate-limit';

import {randomUUID} from 'node:crypto';

import path from 'node:path';

import {fileURLToPath} from 'node:url';

import {db,rpc} from './lib/db.js';

import {passwordOK,sign,verify,qrID} from './lib/security.js';

import {prepareOrder} from './lib/issuance.js';

import {sendTicket} from './lib/mail.js';

import {ticketPDF} from './lib/pdf.js';

const required=['APP_ORIGIN','SESSION_SECRET','QR_SECRET','ADMIN_PASSWORD_HASH','ADMIN_ID','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','GMAIL_USER','MAIL_FROM','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN'];

for(const key of required)if(!process.env[key])throw new Error('Missing environment variable: '+key);

for(const key of ['SESSION_SECRET','QR_SECRET'])if(process.env[key].length<32)throw new Error(key+' needs at least 32 characters');

const app=express(),root=path.dirname(fileURLToPath(import.meta.url));

// Render uses one trusted reverse proxy. Adjust only for a known deployment topology.

if(process.env.NODE_ENV==='production')app.set('trust proxy',1);

app.disable('x-powered-by');

app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:','blob:'],mediaSrc:["'self'",'blob:'],connectSrc:["'self'"],workerSrc:["'self'",'blob:'],objectSrc:["'none'"],frameAncestors:["'none'"],upgradeInsecureRequests:process.env.NODE_ENV==='production'?[]:null}}}));

app.use(express.json({limit:'16kb'}));

app.use('/api',(_,res,next)=>{res.set('Cache-Control','no-store');next()});

const allowedOrigins=new Set([process.env.APP_ORIGIN,process.env.PAGES_ORIGIN].filter(Boolean));
app.use('/api',(req,res,next)=>{
 const origin=req.get('origin');
 if(origin&&allowedOrigins.has(origin)){
  res.set('Access-Control-Allow-Origin',origin);res.vary('Origin');
  res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers','Content-Type, Authorization, Idempotency-Key');
  res.set('Access-Control-Max-Age','600');
 }
 if(req.method==='OPTIONS')return origin&&allowedOrigins.has(origin)?res.sendStatus(204):res.sendStatus(403);
 next();
});
app.use('/api',rateLimit({windowMs:60000,limit:180,standardHeaders:'draft-8',legacyHeaders:false}));

app.use('/api',(req,res,next)=>{if(req.method!=='GET'&&!allowedOrigins.has(req.get('origin')))return res.status(403).json({error:'Origin rejected'});next()});

const cookie=(value,maxAge)=>'session='+value+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+maxAge+(process.env.NODE_ENV==='production'?'; Secure':'');

function auth(req,res,next){const token=req.get('authorization')?.match(/^Bearer (.+)$/)?.[1]||(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);const value=verify(token,process.env.SESSION_SECRET);try{const s=JSON.parse(Buffer.from(value||'','base64url').toString());if(!Number.isFinite(s.exp)||s.exp<Date.now()||s.admin!==process.env.ADMIN_ID)throw Error();req.admin=s.admin;next()}catch{res.status(401).json({error:'Please sign in'})}}

app.post('/api/login',rateLimit({windowMs:15*60000,limit:10,standardHeaders:'draft-8',legacyHeaders:false}), (req,res)=>{if(typeof req.body.password!=='string'||req.body.password.length>256||!passwordOK(req.body.password,process.env.ADMIN_PASSWORD_HASH))return res.status(401).json({error:'Incorrect password'});const value=Buffer.from(JSON.stringify({admin:process.env.ADMIN_ID,exp:Date.now()+8*3600000,nonce:randomUUID()})).toString('base64url');const token=sign(value,process.env.SESSION_SECRET);res.setHeader('Set-Cookie',cookie(token,8*3600));res.json({ok:true,...(process.env.PAGES_ORIGIN&&req.get('origin')===process.env.PAGES_ORIGIN?{token}:{})})});

app.post('/api/logout',(_,res)=>{res.setHeader('Set-Cookie',cookie('',0));res.json({ok:true})});

app.get('/health',(_,res)=>res.json({ok:true}));

app.use('/api',auth);

app.get('/api/session',(req,res)=>res.json({admin:req.admin}));

async function deliver(ticket){if(!await rpc('claim_mail',{p_id:ticket.id}))return;let status='Sent';try{await sendTicket(ticket)}catch{status='Failed'}await db('tickets?id=eq.'+encodeURIComponent(ticket.id),{method:'PATCH',body:{email_status:status}});await db('mail_jobs?ticket_id=eq.'+encodeURIComponent(ticket.id),{method:'DELETE'})}

app.post('/api/tickets',async(req,res)=>{let order;try{order=prepareOrder(req.body)}catch(e){return res.status(400).json({error:e.message})}const key=req.get('Idempotency-Key');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key||''))return res.status(400).json({error:'A UUID v4 Idempotency-Key is required'});const tickets=await rpc('issue_order',{p_id:key,p_hash:order.hash,p_tickets:order.tickets});for(const ticket of tickets)await deliver(ticket);res.status(201).json(await db('tickets?order_id=eq.'+key+'&order=id'))});

app.get('/api/tickets',async(req,res)=>{const offset=Math.max(0,Number.parseInt(req.query.offset)||0);const rows=await db('tickets?select=*&order=issued_at.desc,id&limit=200&offset='+offset);res.json(rows)});

app.get('/api/search',async(req,res)=>{const query=String(req.query.q||'').trim().toLowerCase();if(query.length<2||query.length>90)return res.status(400).json({error:'Search needs 2–90 characters'});const term=query.replace(/[^a-z0-9 -]/g,'').trim();if(term.length<2)return res.json([]);res.json(await db('tickets?or='+encodeURIComponent('(student_number.ilike.*'+term+'*,attendee_name.ilike.*'+term+'*)')+'&limit=30&order=attendee_name'))});

app.get('/api/tickets/:id/pdf',async(req,res)=>{const [ticket]=await db('tickets?id=eq.'+encodeURIComponent(req.params.id));if(!ticket)return res.sendStatus(404);res.type('pdf').set('Content-Disposition','attachment; filename="'+ticket.id+'.pdf"').send(await ticketPDF(ticket))});

app.post('/api/tickets/:id/retry',async(req,res)=>{const [ticket]=await db('tickets?id=eq.'+encodeURIComponent(req.params.id));if(!ticket)return res.sendStatus(404);await deliver(ticket);res.json({ok:true})});

app.post('/api/scan',async(req,res)=>{const id=qrID(req.body.payload,process.env.QR_SECRET);if(!id)return res.json({result:'invalid'});res.json(await rpc('redeem_ticket',{p_id:id,p_admin:req.admin}))});

app.post('/api/manual-check-in',async(req,res)=>{if(typeof req.body.id!=='string'||req.body.id.length>80)return res.status(400).json({error:'Invalid ticket ID'});res.json(await rpc('redeem_ticket',{p_id:req.body.id,p_admin:req.admin}))});

app.get('/vendor/html5-qrcode.js',(_,res)=>res.sendFile(path.join(root,'node_modules/html5-qrcode/html5-qrcode.min.js')));

app.get('/vendor/qrcode.js',(_,res)=>res.sendFile(path.join(root,'node_modules/qrcode-generator/dist/qrcode.js')));
app.get('/vendor/jspdf.js',(_,res)=>res.sendFile(path.join(root,'node_modules/jspdf/dist/jspdf.umd.min.js')));
app.use(express.static(path.join(root,'public'),{index:'index.html'}));

app.get(['/admin','/scan'],(_,res)=>res.sendFile(path.join(root,'public/index.html')));

app.use((err,req,res,next)=>{console.error(JSON.stringify({event:'request_failed',method:req.method,path:req.path,type:err.name}));res.status(err.status===400?400:503).json({error:err.status===400?'Invalid JSON request':'Service unavailable. Retry using the same issuance request; do not issue again.'})});

app.listen(process.env.PORT||3000,()=>console.log('EIE Ball server ready'));
