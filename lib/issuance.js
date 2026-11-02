import {createHash,randomBytes} from 'node:crypto';

export const categories={'EIE Single':35000,'EIE Double Special':30000,'Non-EIE Guest':35000,'Wits Staff':40000};

export function prepareOrder(body){

 if(!Object.hasOwn(categories,body.option))throw new Error('Choose a ticket category');

 const count=body.option==='EIE Double Special'?2:1;

 if(!Array.isArray(body.attendees)||body.attendees.length!==count)throw new Error('Provide '+count+' attendee(s)');

 if(body.paymentConfirmed!==true)throw new Error('Confirm payment before issuing');

 const attendees=body.attendees.map(a=>{

 const attendee_name=String(a.name||'').trim(),email=String(a.email||'').trim().toLowerCase(),student_number=String(a.student||'').trim();

 if(attendee_name.length<2||attendee_name.length>90||/[\r\n]/.test(attendee_name))throw new Error('Name must be 2–90 characters');

 if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Enter a valid email');

 if(student_number.length>30||! /^[a-zA-Z0-9 -]*$/.test(student_number))throw new Error('Invalid student number');

 if(body.option.startsWith('EIE')&&!student_number)throw new Error('EIE attendees need a student number');

 return {attendee_name,email,student_number,ticket_option:body.option,price_cents:categories[body.option]};

 });

 return {hash:createHash('sha256').update(JSON.stringify(attendees)).digest('hex'),tickets:attendees.map(a=>({...a,id:'EIE-GB-'+randomBytes(12).toString('hex').toUpperCase()}))};

}
