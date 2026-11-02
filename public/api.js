import {config} from './config.js';
import {demoRequest} from './demo.js';
const key='eie-session:'+config.apiBase;
let token=sessionStorage.getItem(key);
export const demo=config.mode==='demo';
export async function api(route,body,extra={}){
 if(demo)return demoRequest(route,body,extra);
 const response=await fetch(config.apiBase+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body),credentials:config.apiBase?'omit':'same-origin',signal:AbortSignal.timeout(90000)});
 const data=await response.json().catch(()=>({error:'Service returned an unexpected response'}));
 if(response.status===401){token=null;sessionStorage.removeItem(key);window.dispatchEvent(new Event('session-expired'))}
 if(!response.ok)throw Error(data.error||'Request failed');
 if(route==='/api/login'&&data.token){token=data.token;sessionStorage.setItem(key,token)}
 if(route==='/api/logout'){token=null;sessionStorage.removeItem(key)}
 return data;
}
export async function downloadPDF(ticket){
 if(demo){const {demoPDF}=await import('./browser-pdf.js');return demoPDF(ticket)}
 const response=await fetch(config.apiBase+'/api/tickets/'+encodeURIComponent(ticket.id)+'/pdf',{headers:token?{Authorization:'Bearer '+token}:{},credentials:config.apiBase?'omit':'same-origin',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('PDF unavailable. Check your session and retry.');
 const href=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=href;a.download=ticket.id+'.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(href),60000);
}
