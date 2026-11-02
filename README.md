# 2026 EIE Final-Year Graduation Ball

Staff ticketing and phone check-in for **17 November 2026 at Randpark Club**. The official deployment is a same-origin Node/Express app on Render backed by Supabase PostgreSQL. The separate GitHub Pages site is a browser-only demo and never issues event-valid tickets or sends email.

## Architecture

```text
Staff phone/browser → HTTPS Express app (Render) → Supabase Postgres RPC/REST
                                  ├─ PDFKit ticket PDF + signed QR
                                  └─ Gmail API delivery queue (OAuth2)
```

- `server.js`: session login, staff roles, rate limits, protected API and static site.
- `schema.sql`: atomic order creation, row-locked check-in, email job leases, RLS and service-role RPCs.
- `lib/`: pricing/validation, QR/session crypto, PDF creation, Gmail delivery and diagnostics.
- `public/`: responsive admin roster, issuance form and camera/manual check-in.
- `test/`: unit and local API smoke tests.

Only the server receives the Supabase service-role key. The browser receives no database credentials. A ticket QR contains a random ID and HMAC, not attendee details. A database row lock allows only one successful redemption, even when several scanners read the same QR together.

## Event and ticket rules

| Category | Price |
|---|---:|
| EIE Single | R350 |
| EIE Double Special | R600 total; two linked, individual R300 admissions |
| Non-EIE Guest | R350 |
| Wits Staff | R400 |

Staff confirm payment before issuance; this is not a payment gateway. A double ticket requires both guests' details and creates two separate QRs. Duplicate active student numbers are rejected. Cancellation invalidates an unused QR but does not process a refund. Email retries reuse the same ticket and QR.

## Supabase setup

The production project `eie-graduation-ball-2026` is already created and `schema.sql` has been run successfully. Its project URL is:

```text
https://tllfnybrnqbuqjwmidfn.supabase.co
```

In Supabase **Project Settings → API Keys**, copy the server-only `service_role` key into Render's `SUPABASE_SERVICE_ROLE_KEY`. Never put this value in GitHub Pages, client JavaScript, chat, or a committed `.env` file. The database is in the Free tier; monitor its capacity/backups before event night.

The schema has row-level security enabled and denies anonymous/authenticated table access. The server's service role can call the listed functions. Do not run the schema a second time; it is for a fresh database and creates the event tables, indexes and RPCs.

## Gmail sending

Use the event's approved chairperson From address and authorized Wits delegate mailbox. Keep the actual addresses and OAuth values private in Render; Gmail mailbox delegation alone may not authorize sending from the chairperson alias. Verify the alias under **Gmail → Settings → Accounts → Send mail as** and make sure the chairperson address is confirmed.

The app refreshes an OAuth access token server-side and sends the PDF through Gmail HTTPS. In Google Cloud, enable Gmail API and use an OAuth client authorized for `https://www.googleapis.com/auth/gmail.send`. Save `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` only in Render. Set `GMAIL_USER` to the delegate mailbox and `MAIL_FROM` to the verified chairperson sender address. Institutional Workspace policy can block this flow; resolve that with Wits IT before sale. OAuth consent apps left in Testing may issue refresh tokens that expire after seven days.

Test one email to an address you control before opening ticket sales. Verify the sender, attached PDF, QR scan, and inbox/spam delivery. Sent means Gmail accepted the message; it does not guarantee inbox delivery. The durable queue retries temporary delivery failures and marks a ticket Failed after five attempts. A crash between Gmail accepting a message and the app recording it may result in a duplicate email with the same single-use QR.

## Render deployment

The repository includes a Free-tier `render.yaml`; the service is configured for Node 22, health route `/health`, and generated independent session/QR secrets. The live app derives its same-origin URL from Render's `RENDER_EXTERNAL_URL`.

1. Create a Render **Web Service** from the GitHub repository. Set build command to `corepack pnpm install --frozen-lockfile --ignore-scripts`, start command to `node server.js`, health check to `/health`, and choose **Free** for the initial deployment.
2. Set `NODE_ENV=production`, `NODE_VERSION=22`, `ADMIN_ID=eie-ball-team`, `ISSUANCE_ENABLED=false`, `MAIL_WORKER_ENABLED=false`, and the following private values in Render's environment settings: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD_HASH`, `SCANNER_PASSWORD_HASH`, `GMAIL_USER`, `MAIL_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN`. Do not place secrets in Render's source, Blueprint, or GitHub.
3. Generate separate strong passwords for management and scanner-only access. In a local terminal, run `node scripts/hash-password.js` twice and privately paste each output into the corresponding Render variable. The script hides typed passwords. Use at least 14 characters; do not send them in chat.
4. Let Render generate `SESSION_SECRET` and `QR_SECRET`. **Keep `QR_SECRET` unchanged after any real ticket is issued** or existing QRs stop verifying. Rotating `SESSION_SECRET` logs out staff.
5. Deploy. Visit `/admin`, sign in as the manager, verify roster and database readiness, then use **Test email delivery** with an address you control. Confirm it arrives and displays the intended sender. Then set both `ISSUANCE_ENABLED=true` and `MAIL_WORKER_ENABLED=true` in Render and redeploy/restart to open official ticket emails. The test message creates no ticket and contains no QR code.
6. Before event day, run **Run 200-ticket system check** from the dashboard. It creates disposable synthetic database records, concurrently redeems test tickets and deletes those records; it sends no email and does not touch real tickets. It is an app/database acceptance check, not a 200-device or 200-concurrent-user load test.

Render Free services may sleep when idle, so opening the site at the door can take time. A paid always-on instance is recommended for event-night reliability; choose one only if the organizers approve that cost. The Supabase Free database has its own limits. This design targets a 200-attendee event with a handful of scanners, not 200 people simultaneously scanning or administering.

## Staff and phone check-in

Use **two or three phones** at separate entry positions, plus one charged backup phone and a power bank. Door staff use the scanner-only password and enter a station label (for example, `Gate 1`) so the roster records where a successful scan happened. Use modern iPhone Safari or Android Chrome over HTTPS; grant camera access and press **Start camera & sound**. Camera APIs are not available in insecure HTTP pages. Avoid in-app browsers opened inside messaging/social apps; choose **Open in Safari/Chrome**. Sound needs the initial button gesture; vibration is best-effort and browser dependent.

Each device checks the live database. The first scan is green; a second scan is red and shows the original timestamp. On poor camera focus, search by name/student number and confirm the guest before manual check-in. If the network is offline or verification fails, the page must never show green. Restore the connection and verify again; check the roster timestamp before admitting someone whose scan may have committed during a disconnect.

## Local development and tests

Node.js 22+ and pnpm 10.11 are expected.

```powershell
corepack pnpm install
Copy-Item .env.example .env
node scripts/hash-password.js
# Set the private values in .env locally; do not commit it.
node --test test/*.test.js
node server.js
```

Set independent `SESSION_SECRET` and `QR_SECRET` values to at least 32 random characters. See `.env.example`. Open `http://localhost:3000/admin` or `/scan`. A phone cannot use your computer's `localhost`; deploy HTTPS for camera testing.

The hosted demo remains at [GitHub Pages](https://lephadisergio.github.io/eie-graduation-ball-2026/). It stores fictional test records in that browser only; records do not synchronize across phones and its QRs are never valid at the official event. The production service is same-origin and has a live database. Do not issue tickets until production email is verified and issuance is enabled.

## Before event day

- Confirm final attendee roster and reconcile payment records separately.
- Verify chairperson send-as authority, OAuth token health, and a successful test message.
- Run the 200-ticket app/database diagnostic and check Render/Supabase capacity.
- Test printed and phone-screen QR scans on the actual entry phones, plus manual search and network failure behavior.
- Keep a charged backup phone, stable Wi-Fi/mobile coverage, and a private roster export.
- Review access and data-retention arrangements with the event organizers. The app stores attendee names, student numbers and email addresses; individual staff identities and automated retention/deletion are not included.
