# Verification record

- Node.js 24.22.1: 9 tests passed (`node --test`).
- Password hashing/verification, signed-session tampering, QR tampering/wrong key, double-admission total, request digest and invalid-input checks passed.
- Production verifier rejects browser-demo QR payloads.
- Pages links/assets checked for compatibility with repository subpaths.
- Express integration tests: unauthorized roster denied, missing/untrusted Origin rejected, valid login accepted, protected roster/PDF served, fake QR rejected, scanner bundle served. Pages CORS preflight and bearer login accepted; modified bearer token rejected.
- Server PDF generated and visually inspected after rendering. Gmail HTTPS calls mocked; MIME attachment composition verified.
- Browser tested on the static build: sample double special creates two admissions totaling R600; QR and email preview visible; first scan valid; second scan duplicate; status persists on roster navigation; downloadable browser PDF generated.
- Production dependency audit: zero reported vulnerabilities after updating PDF/email packages.

Not yet verified: real Supabase migration and concurrent two-phone check-in, actual Gmail sender authority/delivery, physical mobile camera/audio, or the production backend. Public Pages test mode uses isolated browser-local records and never sends mail.
