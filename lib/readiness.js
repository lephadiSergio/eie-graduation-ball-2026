export function mailConfigured(){return ['GMAIL_USER','MAIL_FROM','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN'].every(key=>Boolean(process.env[key])&&!process.env[key].endsWith('@example.com'))}
export function issuanceEnabled(){return process.env.ISSUANCE_ENABLED==='true'&&mailConfigured()}
