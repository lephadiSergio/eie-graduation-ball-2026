export class DatabaseError extends Error {
 constructor(status,code){super(code==='23505'?'This attendee already has an active ticket. Search the roster before issuing again.':status===409?'This request conflicts with an existing order.':'Database temporarily unavailable');this.name='DatabaseError';this.status=code==='23505'?409:status;this.code=code}
}
export async function db(path,{method='GET',body,timeout=15000}={}){
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const headers={apikey:key,'Content-Type':'application/json',Prefer:'return=representation'};
 // Legacy service_role keys are JWTs and are accepted as Bearer tokens.
 // New Supabase secret keys (sb_secret_...) are API keys, not JWTs; sending
 // them as Bearer tokens makes PostgREST reject valid requests with HTTP 401.
 if(!key.startsWith('sb_secret_'))headers.Authorization='Bearer '+key;
 const response=await fetch(process.env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
 if(!response.ok){const detail=await response.json().catch(()=>({}));throw new DatabaseError(response.status,detail.code)}
 if(response.status===204)return null;
 const text=await response.text();return text?JSON.parse(text):null;
}
export const rpc=(name,body={})=>db('rpc/'+name,{method:'POST',body});
