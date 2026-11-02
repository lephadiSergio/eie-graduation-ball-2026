import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {qrID} from '../lib/security.js';
test('Pages links and assets resolve within a project subpath',async()=>{const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){assert.ok(!match[1].startsWith('/'),'Root-absolute path breaks project Pages: '+match[1])}assert.match(html,/TEST|modeBanner/);assert.match(html,/payloadForm/)});
test('production verifier rejects browser demo QR payloads',()=>{assert.equal(qrID('EIE2026-DEMO:DEMO-123','production-key'),null)});
