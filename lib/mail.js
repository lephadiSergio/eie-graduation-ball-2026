import nodemailer from 'nodemailer';
import {ticketPDF} from './pdf.js';

const signatureText=`Sergio Lephadi\nChairperson | School of Electrical and Information Engineering Council\nE: eiesc.chairperson@students.wits.ac.za\nT: +27 11 717 7261\nW: https://www.wits.ac.za/eie | https://www.witsfebesc.co.za`;

function escapeHTML(value){
 return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function signatureHTML(){
 return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:620px;width:100%;margin-top:28px;font-family:Arial,Helvetica,sans-serif;color:#12304a"><tr><td style="border-top:2px solid #1f5363;padding:18px 0 8px"><strong style="font-size:18px;color:#123b68">Sergio Lephadi</strong><br><span style="font-size:14px;line-height:1.6">Chairperson | School of Electrical and Information Engineering Council</span></td></tr><tr><td style="border-top:1px solid #d8c28a;padding:10px 0 4px;font-size:14px;line-height:1.7"><span style="color:#b58a3b;font-weight:bold">E:</span> <a href="mailto:eiesc.chairperson@students.wits.ac.za" style="color:#174d82">eiesc.chairperson@students.wits.ac.za</a><br><span style="color:#b58a3b;font-weight:bold">T:</span> <a href="tel:+27117177261" style="color:#174d82">+27 11 717 7261</a><br><span style="color:#b58a3b;font-weight:bold">W:</span> <a href="https://www.wits.ac.za/eie" style="color:#174d82">www.wits.ac.za/eie</a> &amp; <a href="https://www.witsfebesc.co.za" style="color:#174d82">www.witsfebesc.co.za</a></td></tr><tr><td style="border-bottom:2px solid #1f5363;height:10px;font-size:0;line-height:0">&nbsp;</td></tr></table>`;
}

async function sendMessage({to,subject,text,html,attachments=[]}){
 const transporter=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'});
 const composed=await transporter.sendMail({from:process.env.MAIL_FROM,to,subject,text,html,attachments});
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

EIE Student Council

${signatureText}`,html:`<div style="font-family:Arial,Helvetica,sans-serif;color:#17212b;font-size:15px;line-height:1.65;max-width:620px"><p>Dear ${escapeHTML(ticket.attendee_name)},</p><p>Congratulations on securing your ticket to the <strong>2026 EIE Final-Year Graduation Ball</strong>!</p><p>We’re excited to celebrate this milestone with you and look forward to ending the year on a high together.</p><p><strong>17 November 2026 | Randpark Club</strong></p><p>Your ticket is attached. QR codes are single-use only and become invalid immediately upon successful check-in. Do not share your QR code. Each attendee on a double special has a separate ticket.</p><p>See you at the ball!</p><p>EIE Student Council</p>${signatureHTML()}</div>`,attachments:[{filename:ticket.id+'.pdf',content:await ticketPDF(ticket),contentType:'application/pdf'}]});
}

export async function sendTestEmail(to){
 await sendMessage({to,subject:'Email delivery test: 2026 EIE Graduation Ball',text:`This is a delivery test for the 2026 EIE Final-Year Graduation Ball ticket system.

No ticket has been created, and this message contains no admission QR code.

Configured sender: ${process.env.MAIL_FROM}
Event date: 17 November 2026
Venue: Randpark Club

If you received this message and the sender is correct, email dispatch is ready for a final staff review.

${signatureText}`,html:`<div style="font-family:Arial,Helvetica,sans-serif;color:#17212b;font-size:15px;line-height:1.65;max-width:620px"><p>This is a delivery test for the 2026 EIE Final-Year Graduation Ball ticket system.</p><p>No ticket has been created, and this message contains no admission QR code.</p><p><strong>Configured sender:</strong> ${escapeHTML(process.env.MAIL_FROM)}<br><strong>Event date:</strong> 17 November 2026<br><strong>Venue:</strong> Randpark Club</p><p>If you received this message and the sender is correct, email dispatch is ready for a final staff review.</p>${signatureHTML()}</div>`});
}
