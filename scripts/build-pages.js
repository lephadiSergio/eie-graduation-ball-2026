import {mkdir,copyFile,readdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve('dist');await mkdir(path.join(out,'vendor'),{recursive:true});
for(const name of await readdir('public')){if(name!=='config.js')await copyFile(path.join('public',name),path.join(out,name))}
const apiBase=(process.env.LIVE_API_URL||'').trim().replace(/\/$/,'');
if(apiBase){const url=new URL(apiBase);if(url.protocol!=='https:'||url.origin!==apiBase)throw Error('LIVE_API_URL must be an HTTPS origin without a path')}
const config={mode:apiBase?'live':'demo',apiBase};
await writeFile(path.join(out,'config.js'),'export const config = '+JSON.stringify(config)+';\n');
const vendors=[['html5-qrcode/html5-qrcode.min.js','html5-qrcode.js'],['qrcode-generator/dist/qrcode.js','qrcode.js'],['jspdf/dist/jspdf.umd.min.js','jspdf.js']];
for(const [source,name] of vendors)await copyFile('node_modules/'+source,path.join(out,'vendor',name));
await writeFile(path.join(out,'.nojekyll'),'');
const csp=`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'${apiBase?' '+apiBase:''}; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'`;
let html=await readFile(path.join(out,'index.html'),'utf8');html=html.replace('<meta charset="utf-8">','<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><meta name="referrer" content="no-referrer">');await writeFile(path.join(out,'index.html'),html);
await writeFile(path.join(out,'vendor/NOTICE.txt'),'Bundled third-party libraries: html5-qrcode (Apache-2.0), qrcode-generator (MIT), jsPDF (MIT). Copyright and license headers retained in distributed files. See package sources for full license terms.\n');
console.log('GitHub Pages build complete: '+config.mode+' mode');
