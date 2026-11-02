// Isolated browser-only test data. Never used for real admissions or email.
const DB='eie-ball-demo-v1';
let opened;
function openDB(){return opened??=new Promise((resolve,reject)=>{const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>{request.result.createObjectStore('tickets',{keyPath:'id'});request.result.createObjectStore('orders',{keyPath:'id'})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function transaction(stores,run){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(stores,'readwrite');let result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||Error('Browser storage unavailable'));tx.onabort=()=>reject(tx.error||Error('Browser transaction aborted'));try{run(tx,value=>result=value)}catch(e){tx.abort();reject(e)}})}
const prices={'EIE Single':35000,'EIE Double Special':30000,'Non-EIE Guest':35000,'Wits Staff':40000};
export async function demoRequest(route,body,headers={}){
 if(route==='/api/login'){sessionStorage.setItem('eie-demo-login','1');return {ok:true}}
 if(route==='/api/logout'){sessionStorage.removeItem('eie-demo-login');return {ok:true}}
 if(!sessionStorage.getItem('eie-demo-login')){window.dispatchEvent(new Event('session-expired'));throw Error('Enter the test workspace to continue')}
 if(route==='/api/session')return {admin:'demo-staff'};
 const url=new URL(route,location.origin);
 if(route==='/api/reset-demo'){await transaction(['tickets','orders'],(tx,done)=>{tx.objectStore('tickets').clear();tx.objectStore('orders').clear();done({ok:true})});return {ok:true}}
 if(route==='/api/tickets'&&body){
  const count=body.option==='EIE Double Special'?2:1;
  if(!Object.hasOwn(prices,body.option)||!body.paymentConfirmed||body.attendees?.length!==count)throw Error('Check category, attendees and payment confirmation');
  for(const a of body.attendees)if(!a.name?.trim()||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)||body.option.startsWith('EIE')&&!a.student?.trim())throw Error('Enter a name, valid email and student number for each EIE guest');
  const id=headers['Idempotency-Key'],digest=JSON.stringify(body);
  return transaction(['tickets','orders'],(tx,done)=>{const orders=tx.objectStore('orders');const request=orders.get(id);request.onsuccess=()=>{if(request.result){if(request.result.digest!==digest){tx.abort();return}done(request.result.tickets);return}const tickets=body.attendees.map(a=>{const ticketID='DEMO-'+crypto.randomUUID().slice(0,18).toUpperCase();return {id:ticketID,order_id:id,attendee_name:a.name.trim(),student_number:a.student?.trim()||'',email:a.email.trim(),ticket_option:body.option,price_cents:prices[body.option],payment_status:'Test confirmed',status:'Issued',issued_at:new Date().toISOString(),checked_in_at:null,scanned_by:null,email_status:'Demo - not sent',payload:'EIE2026-DEMO:'+ticketID}});for(const t of tickets)tx.objectStore('tickets').add(t);orders.add({id,digest,tickets});done(tickets)}});
 }
 if(url.pathname==='/api/tickets'||url.pathname==='/api/search')return transaction(['tickets'],(tx,done)=>{const request=tx.objectStore('tickets').getAll();request.onsuccess=()=>{const all=request.result.sort((a,b)=>b.issued_at.localeCompare(a.issued_at)||a.id.localeCompare(b.id));if(url.pathname==='/api/search'){const q=(url.searchParams.get('q')||'').toLowerCase();done(all.filter(t=>t.attendee_name.toLowerCase().includes(q)||t.student_number.toLowerCase().includes(q)).slice(0,30))}else{const offset=Number(url.searchParams.get('offset')||0);done(all.slice(offset,offset+200))}}});
 if(route==='/api/scan'||route==='/api/manual-check-in'){
  const id=route==='/api/scan'?(typeof body.payload==='string'&&body.payload.startsWith('EIE2026-DEMO:')?body.payload.slice(13):null):body.id;
  if(!id)return {result:'invalid'};
  return transaction(['tickets'],(tx,done)=>{const store=tx.objectStore('tickets');const request=store.get(id);request.onsuccess=()=>{const t=request.result;if(!t||(route==='/api/scan'&&t.payload!==body.payload)){done({result:'invalid'});return}if(t.status==='Checked In'){done({result:'duplicate',ticket:t});return}t.status='Checked In';t.checked_in_at=new Date().toISOString();t.scanned_by='demo-staff';store.put(t);done({result:'valid',ticket:t})}});
 }
 if(route.endsWith('/retry'))return {ok:true};
 throw Error('Unsupported test action');
}
