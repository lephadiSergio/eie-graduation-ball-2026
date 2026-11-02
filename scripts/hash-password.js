import {passwordHash} from '../lib/security.js';

if(!process.stdin.isTTY||!process.stdin.setRawMode)throw Error('Run this command in a local interactive terminal.');
function readHidden(label){return new Promise((resolve,reject)=>{
 process.stdout.write(label);let value='';process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
 const done=(error,result)=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdout.write('\n');error?reject(error):resolve(result)};
 const onData=chunk=>{for(const char of chunk){if(char==='\u0003')return done(Error('Cancelled'));if(char==='\r'||char==='\n')return done(null,value);if(char==='\u007f'||char==='\b')value=value.slice(0,-1);else if(char>=' '&&char<='~'&&value.length<256)value+=char}}
 process.stdin.on('data',onData);
})}
const first=await readHidden('Password (hidden): '),second=await readHidden('Repeat password: ');
if(first.length<14)throw Error('Use at least 14 characters.');
if(first!==second)throw Error('Passwords did not match.');
console.log(passwordHash(first));
