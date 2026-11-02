import nodemailer from 'nodemailer';
import {ticketPDF} from './pdf.js';

async function sendMessage({to,subject,text,attachments=[]}){
 const transporter=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'});
 const composed=await transporter.sendMail({from:process.env.MAIL_FROM,to,subject,text,attachments});
 const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:process.env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
 if(!tokenResponse.ok)throw Error(tokenResponse.status===400?'Gmail OAuth refresh failed. Check the OAuth client and refresh token.':'Gmail OAuth service is temporarily unavailable.');
 const token=await tokenResponse.json();
 const sent=await fetch('https://gmail.googleapis.com/gmail/v1/users/'+encodeURIComponent(process.env.GMAIL_USER)+'/messages/send',{method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:JSON.stringify({raw:composed.message.toString('base64url')}),signal:AbortSignal.timeout(30000)});
 if(!sent.ok)throw Error(sent.status===403?'Gmail rejected sending. Check the Gmail API scope and chairperson send-as authorization.':sent.status===401?'Gmail rejected the access token. Reauthorize the OAuth client.':'Gmail send failed ('+sent.status+').');
}

export async function sendTicket(ticket){
 await sendMessage({to:ticket.email,subject:'Confirmed: Your Ticket for the 2026 EIE Final-Year Graduation Ball',text:`Dear ${ticket.attendee_name},

Congratulations on securing your ticket to the 2026 EIE Final-Year Graduation Ball!

We’re excited to celebrate this milestone with you and look forward to ending the year on a high together.

17 November 2026 | Randpark Club

Your ticket is attached. QR codes are single-use only and become invalid immediately upon successful check-in. Do not share your QR code. Each attendee on a double special has a separate ticket.

See you at the ball!

EIE Student Council`,attachments:[{filename:ticket.id+'.pdf',content:await ticketPDF(ticket),contentType:'application/pdf'}]});
}

export async function sendTestEmail(to){
 await sendMessage({to,subject:'Email delivery test: 2026 EIE Graduation Ball',text:`This is a delivery test for the 2026 EIE Final-Year Graduation Ball ticket system.

No ticket has been created, and this message contains no admission QR code.

Configured sender: ${process.env.MAIL_FROM}
Event date: 17 November 2026
Venue: Randpark Club

If you received this message and the sender is correct, email dispatch is ready for a final staff review.`});
}
