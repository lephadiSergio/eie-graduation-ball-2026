import {rpc} from './db.js';
import {sendTicket} from './mail.js';
let running=false,stopping=false,timer;
export async function processMail(){
 if(running||stopping)return;running=true;
 try{const jobs=await rpc('claim_mail_batch',{p_limit:2});await Promise.allSettled(jobs.map(async job=>{
  let success=false,error=null;
  try{await sendTicket(job.ticket);success=true}catch(e){error=e.code||'MAIL_DELIVERY_ERROR'}
  await rpc('finish_mail',{p_id:job.ticket.id,p_lease:job.lease_id,p_success:success,p_error:error});
 }))}catch(e){console.error(JSON.stringify({event:'mail_queue_error',type:e.name,status:e.status,code:e.code}))}finally{running=false}
}
export function startMailWorker(){timer=setInterval(processMail,1500);timer.unref();processMail()}
export async function stopMailWorker(){stopping=true;clearInterval(timer);const deadline=Date.now()+55000;while(running&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100))}
