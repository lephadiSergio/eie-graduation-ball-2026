import test from 'node:test';

import assert from 'node:assert/strict';

import {passwordHash,passwordOK,sign,verify,qrID,qrToken} from '../lib/security.js';

import {prepareOrder} from '../lib/issuance.js';

const attendee={name:'Sample Graduate',student:'TEST001',email:'test@example.com'};

test('password verification and tampered sessions',()=>{const hash=passwordHash('a-long-test-password');assert.equal(passwordOK('a-long-test-password',hash),true);assert.equal(passwordOK('wrong',hash),false);const token=sign('session','secret');assert.equal(verify(token,'secret'),'session');assert.equal(verify(token+'x','secret'),null)});

test('QR rejects modification, wrong key and plain ticket ID',()=>{const t=qrToken('EIE-GB-ABC','key');assert.equal(qrID(t,'key'),'EIE-GB-ABC');assert.equal(qrID(t,'wrong'),null);assert.equal(qrID('EIE-GB-ABC','key'),null);assert.equal(qrID(t.replace('ABC','ABD'),'key'),null)});

test('double special creates distinct admissions for R600',()=>{const order=prepareOrder({option:'EIE Double Special',paymentConfirmed:true,attendees:[attendee,{...attendee,name:'Guest Two'}]});assert.equal(order.tickets.length,2);assert.notEqual(order.tickets[0].id,order.tickets[1].id);assert.equal(order.tickets.reduce((n,t)=>n+t.price_cents,0),60000)});

test('idempotency digest stable but sensitive to attendee changes',()=>{const b={option:'EIE Single',paymentConfirmed:true,attendees:[attendee]};assert.equal(prepareOrder(b).hash,prepareOrder(b).hash);assert.notEqual(prepareOrder(b).hash,prepareOrder({...b,attendees:[{...attendee,name:'Another Guest'}]}).hash)});

test('rejects missing payment, wrong headcount, unknown categories and malformed email',()=>{const b={option:'EIE Single',paymentConfirmed:true,attendees:[attendee]};for(const change of [{paymentConfirmed:false},{option:'EIE Double Special'},{option:'free'},{attendees:[{...attendee,email:'bad'}]}])assert.throws(()=>prepareOrder({...b,...change}))});
