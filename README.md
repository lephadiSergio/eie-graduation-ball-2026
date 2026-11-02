# 2026 EIE Final-Year Graduation Ball



**GitHub Pages:** see [Pages testing and live connection](PAGES-SETUP.md). The hosted test mode supports issuance, QR validation and browser PDF downloads using fictional browser-local records. A real deployment requires the Render backend and Supabase.

A small Node.js 22+ / Express application with vanilla HTML/CSS/JS, Supabase PostgreSQL, PDFKit, html5-qrcode, and Nodemailer MIME composition + Gmail HTTPS delivery. Designed for Render. No bundler, frontend framework, browser database key, or Google SDK required.



## Architecture and core files



Phone/browser Ã¢â€ â€™ same-origin Express API Ã¢â€ â€™ Supabase REST/RPC. The server creates signed QR payloads and PDFs, composes MIME messages, and sends them through Gmail API. Only authenticated staff can retrieve guest data, download PDFs, or redeem admissions. The public HTML is an empty staff shell until login. All mutable APIs check the configured Origin. The optional Pages frontend uses allowlisted CORS and bearer sessions; same-origin cookies are HttpOnly/SameSite=Strict/Secure in production.



- `server.js`: session login, rate limits, protected API routes, delivery coordination.

- `schema.sql`: tables, transactional issuance, check-in row locking, mail leases, grants/RLS.

- `lib/issuance.js`: authoritative prices, input validation, order digest.

- `lib/security.js`: scrypt passwords, signed sessions, HMAC QR payloads.

- `lib/pdf.js`: printable black/gold A4-style ticket, white-backed QR.

- `lib/mail.js`: PDF attachment, Nodemailer MIME generation, OAuth refresh, Gmail API.

- `public/`: responsive dashboard, camera scanner, sound and manual check-in.

- `test/`: meaningful core and integration smoke tests.



The supplied event metadata is used as given; the `[cite: n]` markers are not printed as citations because no source documents were supplied.



## Database schema



| Requested field | PostgreSQL column |

|---|---|

| Ticket ID | id (primary key, 96 random bits, EIE-GB- prefix) |

| Student Number | student_number |

| Attendee Name | attendee_name |

| Email Address | email |

| Ticket Option | ticket_option |

| Price (ZAR) | price_cents (integer cents; UI/PDF divides by 100) |

| Status | status: Issued / Checked In |

| Issued At | issued_at (timestamptz) |

| Checked In At | checked_in_at (timestamptz, initially null) |

| Scanned By | scanned_by (configured admin/team identifier) |



Additional columns: order_id links the two admissions; email_status tracks Pending/Sent/Failed; payment_status records staff confirmation. This app records confirmed payments, not online payment collection. An EIE Double Special costs R600 total: each of the two independent admissions records R300. Each attendee has a name, number, email and QR. Other prices: EIE Single R350, Non-EIE Guest R350, Wits Staff R400.



## 1. Install and run



```sh

npm install

cp .env.example .env

node scripts/hash-password.js

# Paste the resulting salt:hash into ADMIN_PASSWORD_HASH.

node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Run twice; use different values for SESSION_SECRET and QR_SECRET.

npm test

npm start

```



On Windows use `Copy-Item .env.example .env`. The local password helper shows input; run it on your own terminal. Set every .env.example variable before starting; startup fails closed when a required value is missing. Do not commit .env. Open http://localhost:3000/admin or /scan. Phones need the deployed HTTPS URL (localhost on the phone points to the phone itself).



Keep QR_SECRET unchanged for the lifetime of the event: rotating it invalidates all issued QR codes. Changing SESSION_SECRET revokes all sessions. Sessions last eight hours. ADMIN_ID identifies this shared staff login; if individual attribution is required, replace shared login with individual identities before use. The single-process login limiter resets on restart; use one instance and a strong random admin password. Multi-instance deployments need a shared limiter and individual authentication.



## 2. Supabase setup (selected database)



1. Create a Supabase project; retain its database password privately.

2. Open SQL Editor and execute schema.sql once in a fresh project.

3. Copy the project URL into SUPABASE_URL (without trailing slash).

4. Copy the legacy service_role key into SUPABASE_SERVICE_ROLE_KEY from the project's API keys. It is server-only and bypasses RLS; never expose it to the browser.

5. Tables use RLS with no anonymous/authenticated access policies. RPC execute permissions are granted only to service_role. Review these in the dashboard after applying the migration.

6. Confirm REST API access to the public schema is enabled. Back up/export the roster before event night.



Supabase is deliberately used instead of Sheets: a normal Sheets read-then-update is not an atomic check-in and can admit a duplicated QR on simultaneous phones. Do not substitute Sheets without a single transactional authority. No Google Sheets credentials are needed for this version.



If an institutional spreadsheet is needed separately: create a Google Cloud project, enable Google Sheets API v4, create a service account, share only the target spreadsheet with that service account as editor, and keep its JSON credential server-side. That is an optional reporting integration, not implemented as a second check-in database.



## 3. Gmail OAuth and authorized chairperson sender



Mailbox delegation in Gmail's UI does not by itself authorize an OAuth token to send as another mailbox. A From header alone cannot grant sender permission. Wits Workspace policy/admin approval may be required.



### Recommended: delegate token + authorized Send mail as



1. In Google Cloud create/select a project and enable **Gmail API**.

2. Configure Google Auth Platform consent/audience. Use an Internal app if eligible in the Wits organization; otherwise configure the permitted test users/publishing state according to institutional policy.

3. Create an OAuth client of type Web application. For one-time setup, register `https://developers.google.com/oauthplayground` as an authorized redirect URI. Retain the client ID and secret privately.

4. In the delegate mailbox `delegate@example.com`, configure and verify **Settings Ã¢â€ â€™ Accounts Ã¢â€ â€™ Send mail as** for `chairperson@example.com`, with the chairperson/Workspace administrator's authorization. If unavailable, stop here and obtain institution-approved sender access; do not assume existing mailbox delegation is sufficient.

5. Open Google's OAuth 2.0 Playground. In settings enable **Use your own OAuth credentials**, enter your client ID/secret, and use server-side/offline authorization. Authorize scope `https://www.googleapis.com/auth/gmail.send` while signed into **delegate@example.com**. Exchange the authorization code for tokens and copy the refresh token privately into GOOGLE_REFRESH_TOKEN.

6. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_USER to the delegate email and MAIL_FROM to the chairperson email. The code refreshes the access token with HTTPS and sends a base64url MIME message via `/gmail/v1/users/{GMAIL_USER}/messages/send`.

7. Issue one real test admission to an address you control. Verify sender, reply address, attachment, spam placement, and scan it. Confirm the chairperson alias is not rewritten/rejected by Gmail. Only then issue attendee tickets.

8. Remove the Playground redirect URI after setup if your institution requires it. Keep OAuth credentials out of chat, source control and logs. External apps left in Testing generally receive refresh tokens that expire after seven days; resolve the publishing/internal-app policy before the ball.



### Institutional alternative: domain-wide delegation



A Workspace super administrator can authorize a service account's OAuth client for `gmail.send` and impersonate the chairperson mailbox directly. This requires institution approval, not just student account access. The supplied app uses refresh-token OAuth; this alternative requires replacing its token refresh block with a signed service-account JWT assertion (`sub` = chairperson) and setting GMAIL_USER accordingly. Do not use a delegate refresh token with the chairperson URL and assume it impersonates them.



Official references: [Google server-side OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [token expiry policies](https://developers.google.com/identity/protocols/oauth2), [Gmail send-as settings](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs), [Gmail messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send), [Nodemailer stream transport](https://nodemailer.com/transports/stream).



## 4. Deploy to Render



1. Create a repository containing this folder's files at its root and push them. No repository has been created or modified automatically.

2. Render Ã¢â€ â€™ New Web Service Ã¢â€ â€™ connect that repository. Runtime Node; build `npm install` (or `npm ci` after generating/committing a package-lock.json); start `npm start`; health path `/health`. The included render.yaml uses npm install. Alternatively use `corepack pnpm install --frozen-lockfile` with the supplied pnpm lockfile.

3. Select the free plan. Add all secrets from .env.example using Render's environment UI; set NODE_ENV=production and APP_ORIGIN to the exact HTTPS service origin, with no trailing slash/path. Do not upload .env. If using render.yaml, add the remaining environment values before deploying.

4. Deploy, visit /admin and /scan, and test on the actual iPhone/Android devices. HTTPS and camera permission are required. Sound requires the Start camera & sound gesture; vibration is best-effort and may not be supported on iOS.

5. Render free services sleep after inactivity. Open the service before guests arrive and keep the roster active on a staff device. Check current platform limits; there is no uptime guarantee. All records remain in Supabase across server restarts.



Render free blocks SMTP ports; this implementation sends through Gmail HTTPS instead. See [Render free-tier limits](https://render.com/docs/free). This Express server targets Render; it is not a drop-in Vercel serverless entry point. A Vercel adaptation should export the app and bound request time/email work appropriately.



## API contract



All endpoints except login/logout/health/static require the staff cookie. POST requests require an approved APP_ORIGIN or PAGES_ORIGIN.



| Method | Endpoint | Purpose |

|---|---|---|

| POST | /api/login | `{password}` Ã¢â€ â€™ eight-hour session |

| POST | /api/logout | Clear cookie |

| GET | /api/session | Current configured admin ID |

| POST | /api/tickets | `{option, paymentConfirmed:true, attendees:[{name,student,email}]}` + UUID v4 Idempotency-Key |

| GET | /api/tickets?offset=0 | Latest 200 rows; paginate for more |

| GET | /api/search?q=... | Name/number search, max 30 matches |

| GET | /api/tickets/:id/pdf | Regenerate PDF for staff |

| POST | /api/tickets/:id/retry | Retry Pending/Failed delivery without issuing new admission |

| POST | /api/scan | `{payload}` Ã¢â€ â€™ valid / duplicate / invalid |

| POST | /api/manual-check-in | `{id}` Ã¢â€ â€™ same atomic redemption, after staff confirmation |



A database transaction inserts both tickets or neither. Retrying the same request UUID returns the original admissions; the database rejects a changed payload under that UUID. The browser retains the UUID while the unchanged form remains open; after a browser reload/network interruption, search the roster before creating a new order. A scanned QR carries only event prefix, random ticket ID and HMAC, with no attendee PII. A ticket copy is a bearer credential: the first successful check-in wins.



Database failure/offline mode never displays green. If the network fails after a successful database commit, scan again: a duplicate response establishes that it was recorded. Staff should review the timestamp rather than admit the same person again.



## Delivery and operations



Issuance commits before email delivery. The dashboard shows Pending/Sent/Failed and permits retry, plus a PDF download. A five-minute persistent mail lease prevents normal simultaneous retries. If the process stops after Gmail accepts the message but before status persistence, a retry can send the same ticket twice; email delivery is at-least-once and both attachments contain the same single-use QR. Sent means accepted by Gmail, not delivered to the inbox. Failed delivery never creates a replacement ticket automatically.



Before event night run the integration acceptance checks below. Remaining secondary work: individual staff accounts, distributed rate limiting if scaling, payment reconciliation/import, cancellations/refunds, retention/deletion policy, and scheduled delivery-retry worker if needed. These are not silently simulated.



## Verification



`npm test` checks passwords/sessions, QR tamper rejection, price validation, double-ticket IDs/total, and idempotency digests. The smoke test generates a PDF, mocks Gmail fetch calls, and exercises auth + API routes against a local fake Supabase service; it does not prove real Gmail authority or production PostgreSQL locking.



Required live acceptance checks after configuration:

1. Issue all four categories and a double special. Verify actual PDF QR decoding and both emails.

2. Submit the same order UUID twice: identical ticket IDs, only one order. Submit changed data with same UUID: no new order.

3. On two phones scan one ticket simultaneously: exactly one green, one duplicate, one timestamp in Supabase. The double-special partner remains independently redeemable.

4. Scan modified QR and random text: invalid. Deny camera permission and test manual name/number search.

5. Disconnect the network during scan: never show green; reconnect and verify status. Stop the service during email and recover via Pending/Failed retry after the lease expires.

6. Log out: roster, PDFs and API must return 401. Test same-origin rejection, phone camera, small screen, sound, long names, pagination, failed Gmail authorization, and Supabase outage.



The implementation is complete source, but deployment, real database concurrency, actual camera hardware and institution-approved sender access require your external accounts and are not claimed as verified here.
