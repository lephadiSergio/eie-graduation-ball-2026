import {passwordHash} from '../lib/security.js';

import readline from 'node:readline/promises';

const rl=readline.createInterface({input:process.stdin,output:process.stdout});

console.log(passwordHash(await rl.question('Admin password (visible locally): ')));rl.close();
