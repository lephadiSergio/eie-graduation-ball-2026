import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {passwordHash,qrToken} from '../lib/security.js';
import {ticketPDF} from '../lib/pdf.js';
import {sendTicket} from '../lib/mail.js';

const ticket={id:'EIE-GB-000000000000000000000000',attendee_name:'Sample Attendee',student_number:'1234567',email:'test@example.com',ticket_option:'EIE Single',price_cents:35000,status:'Issued'};

test('PDF and Gmail MIME composition over mocked HTTPS',async()=>{process.env.QR_SECRET='q'.repeat(32);const pdf=await ticketPDF(ticket);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>5000);const original=globalThis.fetch;let sent=false;globalThis.fetch=async(url,options)=>{if(url.includes('oauth2'))return {ok:true,json:async()=>({access_token:'test'})};const raw=Buffer.from(JSON.parse(options.body).raw,'base64url').toString();assert.match(raw,/application\/pdf/);assert.match(raw,/Confirmed: Your Ticket/);sent=true;return {ok:true}};try{await sendTicket(ticket);assert.equal(sent,true)}finally{globalThis.fetch=original}});

test('server roles, cookie revocation, origin and protected PDF routes',async()=>{
 const sessions=new Map();let ticketRow=ticket;
 const fake=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const route=req.url.replace(/^\/rest\/v1/,'');const send=(data,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(data===null?'':JSON.stringify(data))};
  if(route==='/staff_sessions'&&req.method==='POST'){const s=JSON.parse(body);sessions.set(s.id,s);return send([s],201)}
  if(route.startsWith('/staff_sessions?')&&req.method==='GET'){const id=new URL(route,'http://mock').searchParams.get('id')?.replace('eq.','');return send(sessions.has(id)?[sessions.get(id)]:[])}
  if(route.startsWith('/staff_sessions?')&&req.method==='DELETE'){const id=new URL(route,'http://mock').searchParams.get('id')?.replace('eq.','');sessions.delete(id);return send(null,204)}
  if(route==='/rpc/event_stats')return send({total:1,checked_in:0,cancelled:0,sales_cents:35000,email_pending:0,email_failed:0});
  if(route.startsWith('/tickets?')&&req.method==='GET')return send(route.includes('id=eq.')?[ticketRow]:[ticketRow]);
  if(route==='/tickets'&&req.method==='POST')return send([ticket],201);
  if(route==='/rpc/redeem_ticket')return send({result:'invalid'});
  return send({message:'not found'},404);
 });await new Promise(r=>fake.listen(0,'127.0.0.1',r));
 const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const origin='http://127.0.0.1:'+port;const env={...process.env,PORT:String(port),RENDER_EXTERNAL_URL:origin,PAGES_ORIGIN:'https://pages.example.com',NODE_ENV:'development',SESSION_SECRET:'s'.repeat(32),QR_SECRET:'q'.repeat(32),ADMIN_PASSWORD_HASH:passwordHash('manager-test-password'),SCANNER_PASSWORD_HASH:passwordHash('scanner-test-password'),ADMIN_ID:'test-admin',SUPABASE_URL:'http://127.0.0.1:'+fake.address().port,SUPABASE_SERVICE_ROLE_KEY:'fake',MAIL_WORKER_ENABLED:'false',ISSUANCE_ENABLED:'false'};delete env.APP_ORIGIN;
 const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});let log='';child.stderr.on('data',x=>log+=x);
 try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Server timeout '+log)),10000);child.stdout.on('data',()=>{clearTimeout(timeout);resolve()});child.on('exit',code=>{clearTimeout(timeout);reject(Error('Server exited '+code+' '+log))})});
  assert.equal((await fetch(origin+'/api/tickets')).status,401);
  assert.equal((await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'manager-test-password',role:'admin'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],headers={Cookie:cookie};
  assert.equal((await fetch(origin+'/api/tickets',{headers})).status,200);assert.equal((await fetch(origin+'/api/readiness',{headers})).status,200);assert.equal((await fetch(origin+'/api/tickets',{method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json','Idempotency-Key':'f1a2413c-7b42-4b95-83c2-87ffb114d39c'},body:'{}'})).status,503);
  const pdf=await fetch(origin+'/api/tickets/'+ticket.id+'/pdf',{headers});assert.equal(pdf.status,200);assert.match(pdf.headers.get('content-type'),/application\/pdf/);
  const invalid=await fetch(origin+'/api/scan',{method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({payload:'fake'})});assert.equal((await invalid.json()).result,'invalid');
  const scanner=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'scanner-test-password',role:'scanner',station:'Gate 2'})});const scannerCookie=scanner.headers.get('set-cookie').split(';')[0],scanHeaders={Cookie:scannerCookie};
  assert.equal((await fetch(origin+'/api/tickets',{headers:scanHeaders})).status,403);assert.equal((await fetch(origin+'/api/search?q=Sample',{headers:scanHeaders})).status,200);
  const preflight=await fetch(origin+'/api/tickets',{method:'OPTIONS',headers:{Origin:'https://pages.example.com','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'https://pages.example.com');
  const pageLogin=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:'https://pages.example.com','Content-Type':'application/json'},body:JSON.stringify({password:'manager-test-password'})});const {token}=await pageLogin.json();assert.ok(token);assert.equal((await fetch(origin+'/api/session',{headers:{Origin:'https://pages.example.com',Authorization:'Bearer '+token}})).status,200);assert.equal((await fetch(origin+'/api/session',{headers:{Authorization:'Bearer '+token+'tampered'}})).status,401);
  const logout=await fetch(origin+'/api/logout',{method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(logout.status,200);assert.equal((await fetch(origin+'/api/tickets',{headers})).status,401);
  assert.equal((await fetch(origin+'/vendor/html5-qrcode.js')).status,200);assert.equal((await fetch(origin+'/api/login',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'})).status,403);
 }finally{child.kill();await new Promise(r=>fake.close(r))}
});
