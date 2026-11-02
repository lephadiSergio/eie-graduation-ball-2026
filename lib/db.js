const base=process.env.SUPABASE_URL+'/rest/v1';

export async function db(path,{method='GET',body}={}){const response=await fetch(base+'/'+path,{method,headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Database request failed ('+response.status+')');return response.status===204?null:response.json()}

export const rpc=(name,body)=>db('rpc/'+name,{method:'POST',body});
