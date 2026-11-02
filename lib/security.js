import {createHmac,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';

export function equal(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}

export function passwordHash(password,salt=randomBytes(16).toString('hex')){return salt+':'+scryptSync(password,salt,64).toString('hex')}

export function passwordOK(password,hash){try{const [salt]=hash.split(':');return equal(passwordHash(password,salt),hash)}catch{return false}}

const mac=(value,key)=>createHmac('sha256',key).update(value).digest('base64url');

export function sign(value,key){return value+'.'+mac(value,key)}

export function verify(token,key){if(typeof token!=='string')return null;const i=token.lastIndexOf('.');if(i<0)return null;const value=token.slice(0,i);return equal(sign(value,key),token)?value:null}

export const qrToken=(id,key)=>sign('EIE2026:'+id,key);

export function qrID(token,key){const v=verify(token,key);return v?.startsWith('EIE2026:')?v.slice(8):null}
