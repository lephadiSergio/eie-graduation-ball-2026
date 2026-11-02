import nodemailer from 'nodemailer';

import {ticketPDF} from './pdf.js';

export async function sendTicket(ticket){const transporter=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'});const composed=await transporter.sendMail({from:process.env.MAIL_FROM,to:ticket.email,subject:'Confirmed: Your Ticket for the 2026 EIE Final-Year Graduation Ball',text:`Dear ${ticket.attendee_name},



Congratulations on completing final year and securing your ball ticket!



17 November 2026 | Randpark Club



Your ticket is attached. QR codes are single-use only and become invalid immediately upon successful check-in. Do not share your QR code. Each attendee on a double special has a separate ticket.



See you at the ball!

EIE Student Council`,attachments:[{filename:ticket.id+'.pdf',content:await ticketPDF(ticket),contentType:'application/pdf'}]});

const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:process.env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});if(!tokenResponse.ok)throw Error('OAuth refresh failed');const token=await tokenResponse.json();

const sent=await fetch('https://gmail.googleapis.com/gmail/v1/users/'+encodeURIComponent(process.env.GMAIL_USER)+'/messages/send',{method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:JSON.stringify({raw:composed.message.toString('base64url')}),signal:AbortSignal.timeout(30000)});if(!sent.ok)throw Error('Gmail send failed ('+sent.status+')');

}
