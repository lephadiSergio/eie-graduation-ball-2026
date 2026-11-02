import {api,downloadPDF,demo} from './api.js';
import {qrData} from './browser-pdf.js';
const $=id=>document.getElementById(id);
let rows=[],offset=0,hasMore=false,loading=false,authorized=false,role='admin',ready=demo;
let scanner,scanning=false,busy=false,audio;
const pendingKey='eie-pending-order';
let pending;try{pending=JSON.parse(sessionStorage.getItem(pendingKey)||'null')}catch{pending=null}
function notice(message){$('notice').textContent=message}
function setPending(value){pending=value;if(value)sessionStorage.setItem(pendingKey,JSON.stringify(value));else sessionStorage.removeItem(pendingKey);$('pendingNotice').hidden=!value;$('restorePending').hidden=!value}
function showLogin(){$('login').hidden=false;$('admin').hidden=true;$('scan').hidden=true;$('logout').hidden=true;if(scanning)stopCamera()}
window.addEventListener('session-expired',()=>{authorized=false;showLogin()});
async function boot(){
 try{const session=await api('/api/session');role=session.role||'admin';authorized=true;$('login').hidden=true;$('logout').hidden=false;
  const scan=role==='scanner'||new URLSearchParams(location.search).get('view')==='scan'||location.pathname==='/scan';
  $('scan').hidden=!scan;$('admin').hidden=scan;
  if(!scan){if(!demo){const r=await api('/api/readiness');ready=r.issuance_enabled;$('readinessText').textContent=(ready?'Ready for official ticket issuance.':'Issuance locked: complete email configuration and enable issuance.')+(r.scanner_login_configured?' Scanner-only access is configured.':' Configure a separate scanner password before event night.')}
   $('issueButton').disabled=!ready;await load();setPending(pending)}
 }catch(e){showLogin();notice(e.message)}
}
$('loginForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const f=new FormData(e.target);await api('/api/login',{password:f.get('password'),role:f.get('role'),station:f.get('station')});e.target.elements.password.value='';notice('');await boot()}catch(e){notice(e.message)}finally{button.disabled=false}};
$('logout').onclick=async()=>{try{await api('/api/logout',{});authorized=false;setPending(null);$('issueForm').reset();showLogin()}catch(e){notice(e.message)}};
function updateOption(){const option=$('option').value,double=option==='EIE Double Special';$('partner').hidden=!double;$('partner').disabled=!double;$('price').textContent=double?'R600 total - two linked admissions':option==='Wits Staff'?'R400 - one admission':'R350 - one admission';$('issueForm').elements.student1.required=option.startsWith('EIE')}
$('option').onchange=updateOption;
function restorePending(){if(!pending)return;const f=$('issueForm');f.elements.option.value=pending.body.option;updateOption();pending.body.attendees.forEach((a,i)=>{f.elements['name'+(i+1)].value=a.name;f.elements['student'+(i+1)].value=a.student;f.elements['email'+(i+1)].value=a.email});f.elements.paid.checked=true;notice('Pending issuance restored. Submit to recover the original tickets safely.')}
$('restorePending').onclick=restorePending;
$('issueForm').onsubmit=async e=>{
 e.preventDefault();if(!ready)return;const button=$('issueButton');button.disabled=true;
 const f=new FormData(e.target);const attendees=[{name:f.get('name1'),student:f.get('student1'),email:f.get('email1')}];
 if(f.get('option')==='EIE Double Special')attendees.push({name:f.get('name2'),student:f.get('student2'),email:f.get('email2')});
 const body={option:f.get('option'),attendees,paymentConfirmed:f.get('paid')==='on'};
 if(pending&&JSON.stringify(pending.body)!==JSON.stringify(body)){notice('Recover the pending issuance first. Check the roster before issuing another ticket for the same guest.');button.disabled=false;return}
 if(!pending)setPending({key:crypto.randomUUID(),body});
 try{const tickets=await api('/api/tickets',body,{'Idempotency-Key':pending.key});notice(tickets.map(t=>t.id+' - email '+t.email_status).join('\n'));setPending(null);e.target.reset();updateOption();await load()}
 catch(e){if([400,409].includes(e.status)){setPending(null);notice(e.message+' Check the roster before trying again.')}else notice(e.message+' The request key and details are saved in this tab. Keep them unchanged and retry, or restore after reloading.')}
 finally{button.disabled=!ready}
};
function cell(tr,text){const td=document.createElement('td');td.textContent=text;tr.append(td);return td}
function button(label,action){const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await action()}catch(e){notice(e.message)}finally{b.disabled=false}};return b}
function render(stats){
 const q=$('filter').value.toLowerCase();$('roster').replaceChildren();
 for(const t of rows.filter(t=>[t.id,t.attendee_name,t.student_number].some(x=>x.toLowerCase().includes(q)))){
  const tr=document.createElement('tr');const who=cell(tr,t.attendee_name);
  for(const text of [t.student_number,t.email,t.id]){const small=document.createElement('small');small.textContent=text;who.append(small)}
  cell(tr,t.ticket_option+' | R'+(t.price_cents/100)+' | '+t.payment_status);
  cell(tr,t.status+(t.checked_in_at?' | '+new Date(t.checked_in_at).toLocaleString():''));
  const delivery=cell(tr,t.email_status);
  if(!demo&&t.status!=='Cancelled')delivery.append(button(t.email_status==='Sent'?'Resend email':'Retry email',async()=>{if(t.email_status==='Sent'&&!confirm('Resend this same ticket to '+t.email+'?'))return;await api('/api/tickets/'+t.id+'/retry',{});notice('Email queued for the same ticket.');await load()}));
  const actions=cell(tr,'');actions.append(button('Download PDF',()=>downloadPDF(t)));
  if(demo){const b=button('QR & email preview',()=>previewTicket(t));b.className='secondary';actions.append(b)}
  if(t.status==='Issued'){const b=button('Cancel ticket',async()=>{const reason=prompt('Cancellation reason? The QR will be rejected. This does not process a refund.');if(!reason)return;await api('/api/tickets/'+t.id+'/cancel',{reason});notice('Ticket cancelled. Handle any payment refund separately.');await load()});b.className='secondary';actions.append(b)}
  $('roster').append(tr);
 }
 if(stats){$('total').textContent=stats.total;$('checked').textContent=stats.checked_in;$('revenue').textContent=new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR',maximumFractionDigits:0}).format(stats.sales_cents/100);if(stats.email_failed)notice(stats.email_failed+' ticket email(s) need retry. Check the delivery column.')}
}
let lastStats;
async function load(more=false){
 if(loading)return;loading=true;
 try{const target=more?offset+200:Math.max(200,offset);let fresh=more?[...rows]:[],cursor=more?offset:0;
  while(cursor<target){const page=await api('/api/tickets?offset='+cursor);fresh.push(...page);cursor+=page.length;hasMore=page.length===200;if(!hasMore)break}
  rows=[...new Map(fresh.map(t=>[t.id,t])).values()];offset=cursor;
  lastStats=await api('/api/stats');$('more').hidden=!hasMore;render(lastStats);
 }finally{loading=false}
}
$('refresh').onclick=()=>load().catch(e=>notice(e.message));$('more').onclick=()=>load(true).catch(e=>notice(e.message));$('filter').oninput=()=>render(lastStats);
setInterval(()=>{if(authorized&&!$('admin').hidden)load().catch(e=>notice(e.message))},15000);
async function enableSound(){try{audio??=new(window.AudioContext||window.webkitAudioContext)();await audio.resume()}catch{}}
function sound(ok){try{if(audio){const o=audio.createOscillator(),g=audio.createGain();o.type=ok?'sine':'sawtooth';o.frequency.value=ok?880:125;g.gain.value=.12;o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+.22)}}catch{}if(!ok)navigator.vibrate?.([100,50,100])}
function result(data){const t=data.ticket,status=$('result');status.className=data.result;status.textContent=data.result==='valid'?'VALID - Welcome '+t.attendee_name:data.result==='duplicate'?'ALREADY REDEEMED at '+new Date(t.checked_in_at).toLocaleString():data.result==='cancelled'?'TICKET CANCELLED':'INVALID TICKET';if(demo)status.textContent+=' (TEST)';sound(data.result==='valid')}
async function redeem(body,manual=false){if(busy){notice('Wait for the current verification to finish');return}busy=true;$('result').className='';$('result').textContent='Verifying...';try{result(await api(manual?'/api/manual-check-in':'/api/scan',body))}catch(e){$('result').className='error';$('result').textContent='NOT CONFIRMED - '+e.message+' Scan again to verify current status.'}finally{setTimeout(()=>busy=false,1800)}}
$('start').onclick=async()=>{try{await enableSound();scanner??=new Html5Qrcode('reader');$('start').disabled=true;await scanner.start({facingMode:'environment'},{fps:8,qrbox:(w,h)=>{const size=Math.min(250,Math.floor(Math.min(w,h)*.8));return {width:size,height:size}}},text=>{if(!busy)redeem({payload:text})},()=>{});scanning=true;$('start').hidden=true;$('stop').hidden=false}catch(e){notice('Camera could not start. Use Safari/Chrome over HTTPS and allow camera access. You can upload a QR image or search manually.')}finally{$('start').disabled=false}};
async function stopCamera(){if(!scanning)return;try{await scanner.stop();scanning=false;$('start').hidden=false;$('stop').hidden=true}catch{notice('Unable to stop camera')}}$('stop').onclick=stopCamera;
$('searchForm').onsubmit=async e=>{e.preventDefault();try{const matches=await api('/api/search?q='+encodeURIComponent(new FormData(e.target).get('q')));$('matches').replaceChildren();if(!matches.length)$('matches').textContent='No matching attendees';for(const t of matches){const article=document.createElement('article');const description=document.createElement('p');description.textContent=t.attendee_name+' | '+t.student_number+' | '+t.ticket_option+' | '+t.id+' | '+t.status;const b=button(t.status==='Checked In'?'Verify previous check-in':'Check in this attendee',async()=>{if(!confirm('Check in '+t.attendee_name+' ('+t.id+')?'))return;await enableSound();await redeem({id:t.id},true)});article.append(description,b);$('matches').append(article)}}catch(e){notice(e.message)}};
function previewTicket(t){const box=$('ticketPreview');box.replaceChildren();const name=document.createElement('p');name.textContent=t.attendee_name+' | '+t.ticket_option+' | '+t.id;const img=document.createElement('img');img.src=qrData(t.payload);img.alt='Test ticket QR code';img.width=240;const label=document.createElement('label');label.textContent='Copy this test QR payload';const code=document.createElement('textarea');code.readOnly=true;code.value=t.payload;label.append(code);const email=document.createElement('p');email.textContent='To: '+t.email+' | Congratulations on completing final year! Join us on 17 November 2026 at Randpark Club. Your QR code is single-use and becomes invalid immediately on check-in. TEST PREVIEW ONLY - no email sent.';box.append(name,img,label,email);$('ticketDialog').showModal()}
$('closeDialog').onclick=()=>$('ticketDialog').close();
$('payloadForm').onsubmit=async e=>{e.preventDefault();await enableSound();await redeem({payload:new FormData(e.target).get('payload').trim()})};
$('qrFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{await enableSound();await stopCamera();const fileScanner=new Html5Qrcode('fileReader');let payload;try{payload=await fileScanner.scanFile(file,false)}finally{fileScanner.clear()}await redeem({payload})}catch{notice('Could not read this QR image. Try a clearer screenshot or paste the decoded payload.')}finally{e.target.value=''}};
$('runDiagnostics').onclick=async()=>{if(!confirm('Run a 200-ticket test with temporary fictional records? No emails will be sent and real guests will not be changed.'))return;const b=$('runDiagnostics');b.disabled=true;$('diagnosticsResult').hidden=false;$('diagnosticsResult').textContent='Running database workload and duplicate-scan checks...';try{$('diagnosticsResult').textContent=JSON.stringify(await api('/api/diagnostics',{}),null,2)}catch(e){$('diagnosticsResult').textContent=e.message}finally{b.disabled=false}};
if(demo){
 $('modeBanner').hidden=false;$('modeBanner').textContent='TEST MODE - Browser-only records. No emails are sent. Test tickets are not valid for event entry. Records are not shared between phones.';
 $('testTools').hidden=false;$('operations').hidden=true;$('passwordLabel').hidden=true;$('roleLabel').hidden=true;$('stationLabel').hidden=true;
 $('loginForm').elements.password.required=false;$('loginForm').querySelector('button').textContent='Enter test workspace';$('issueButton').textContent='Issue test ticket';
 $('seedDemo').onclick=async()=>{try{await api('/api/login',{});await api('/api/tickets',{option:'EIE Double Special',paymentConfirmed:true,attendees:[{name:'Sample Graduate',student:'TEST001',email:'graduate@example.com'},{name:'Sample Partner',student:'TEST002',email:'partner@example.com'}]},{'Idempotency-Key':crypto.randomUUID()});notice('Two sample admissions added. Open their QR previews in the roster.');await boot()}catch(e){notice(e.message)}};
 $('resetDemo').onclick=async()=>{if(!confirm('Delete all test tickets saved in this browser?'))return;try{await api('/api/login',{});await api('/api/reset-demo',{});setPending(null);notice('Test data reset');await boot()}catch(e){notice(e.message)}};
}
updateOption();setPending(pending);boot();
