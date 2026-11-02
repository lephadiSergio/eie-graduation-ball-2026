import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import {rpc} from './db.js';
import {prepareOrder} from './issuance.js';
async function pool(items,concurrency,task){let cursor=0;const output=[];await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<items.length){const i=cursor++;output[i]=await task(items[i],i)}}));return output}
export async function acceptanceProbe(admin){
 const ids=[],latencies=[];let tickets=[];const start=performance.now();
 try{
  tickets=await pool(Array.from({length:200}),8,async(_,i)=>{const order=prepareOrder({option:'EIE Single',paymentConfirmed:true,attendees:[{name:'SYSTEM TEST '+i,student:'PROBE'+i,email:'probe'+i+'@example.invalid'}]});const id=randomUUID();ids.push(id);return (await rpc('issue_order',{p_id:id,p_hash:order.hash,p_tickets:order.tickets,p_admin:admin,p_is_test:true}))[0]});
  const same=tickets[0];const duplicateRace=await pool(Array.from({length:20}),20,()=>rpc('redeem_ticket',{p_id:same.id,p_admin:'SYSTEM TEST'}));
  const winners=duplicateRace.filter(r=>r.result==='valid').length;
  if(winners!==1||duplicateRace.filter(r=>r.result==='duplicate').length!==19)throw Error('Duplicate race test failed');
  const results=await pool(tickets.slice(1),16,async t=>{const at=performance.now();const result=await rpc('redeem_ticket',{p_id:t.id,p_admin:'SYSTEM TEST'});latencies.push(performance.now()-at);return result});
  if(results.some(r=>r.result!=='valid'))throw Error('Admission workload test failed');
  latencies.sort((a,b)=>a-b);
  return {passed:true,tickets:200,scan_concurrency:16,duplicate_race_requests:20,duplicate_race_winners:winners,scan_p50_ms:Math.round(latencies[Math.floor(latencies.length*.5)]),scan_p95_ms:Math.round(latencies[Math.floor(latencies.length*.95)]),elapsed_ms:Math.round(performance.now()-start),note:'Synthetic test admissions only. No email sent. Not a 200-simultaneous-user benchmark.'};
 }finally{for(let i=0;i<ids.length;i+=20)await rpc('cleanup_probes',{p_ids:ids.slice(i,i+20)})}
}
