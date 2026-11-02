# GitHub Pages testing and live connection

The public source contains fictional test identities and placeholder email addresses only. Put the real institutional sender/delegate addresses and all secrets in Render's private environment settings.

## Published test mode

With no LIVE_API_URL repository variable, the deployment is explicitly in TEST MODE:

1. Open the Pages site and choose **Add sample guests**. It enters the test workspace and issues a linked double special with two admissions totaling R600.
2. Open **QR & email preview** on either row. Copy its QR payload or take a screenshot of the QR. The preview is not sent as an email.
3. Choose **Download PDF** for a real printable PDF labelled TEST TICKET - NOT VALID FOR ENTRY.
4. Open **Door check-in**. Paste the payload into **Verify a QR payload** and click **Verify QR**. First result: green VALID (TEST). Repeat after three seconds: red ALREADY REDEEMED (TEST).
5. Verify a random payload to see INVALID TICKET. Upload a QR screenshot to test decoding, or use the phone camera with its normal browser permission prompt.
6. Search TEST001 or Sample Graduate, then confirm manual check-in. Each partner admission redeems independently.
7. Refresh/reopen: the browser retains the test roster. **Reset test data** clears this browser's test tickets.

Records live in IndexedDB on that browser, with serialized write transactions for duplicate prevention across its tabs. They are not shared between devices or browser profiles. Demo login is a workspace entry, not real authentication. QR test payloads are not cryptographically signed and the live backend rejects them. No mail, real payment, server authorization, or shared database is simulated as live. Use fictional data only.

## Production: GitHub Pages + Render + Supabase

GitHub Pages serves static files and cannot run the Express API or store secrets. The complete production source is in this repository; the server must run separately.

1. Connect Supabase and Render, or configure them in their own dashboards using README.md.
2. Execute schema.sql in your Supabase project. Deploy this repository as a Render Node Web Service. Use Node 22+, build `corepack pnpm install --frozen-lockfile --ignore-scripts`, start `npm start`, health `/health`. Add every required .env.example value privately. APP_ORIGIN is the backend's exact HTTPS origin; PAGES_ORIGIN is the GitHub Pages origin (e.g. https://YOUR_USERNAME.github.io, without the repository path).
3. Configure the real Gmail OAuth client/refresh token and institution-authorized chairperson From address. The public example addresses are placeholders, not the operational sender. Gmail UI delegation alone is insufficient; use an authorized send-as address or the documented Workspace-admin route.
4. In repository **Settings > Secrets and variables > Actions > Variables**, set LIVE_API_URL to the backend HTTPS origin. This is a public URL, not a secret. Never put database keys, passwords, OAuth credentials, or QR/session signing secrets in repository variables or browser config.
5. Run **Actions > Test and deploy GitHub Pages > Run workflow**. Build writes a live config and redeploys. The test banner disappears and real password login is required. There is no automatic fallback to demo after a live error.
6. The Pages client uses an eight-hour signed bearer session stored only in sessionStorage for this tab. The backend allows CORS only for the configured Pages origin, and accepts login/mutations only from approved origins. It does not rely on Safari permitting third-party cookies. Same-origin hosting retains HttpOnly cookie sessions.
7. Complete the real two-phone simultaneous-scan and Gmail acceptance checks in README.md before using at the event.

For quick mode changes remove LIVE_API_URL and redeploy to return to the separate test workspace. Test and live records never mix. Logging out clears this tab's token; shared stateless sessions expire after eight hours, and rotating SESSION_SECRET revokes all of them. For per-user revocation and audit identities, add individual authentication.

## Deploy pipeline

The workflow installs locked dependencies, runs the Node tests, copies the interface and locally bundled scanner/PDF/QR libraries into dist, and deploys dist with GitHub Pages Actions. It uploads no .env, source database credentials, tests, or server runtime. Only synthetic test records created by the visitor are stored locally. No CDN requests are needed.

Navigation uses repository-relative assets and query routes (`?view=admin`, `?view=scan`), so it works under a project Pages subpath.
