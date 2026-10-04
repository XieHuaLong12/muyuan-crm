# Temporary Gupshup URL validation diagnostic

1. Requirement: distinguish Gupshup URL-validator incompatibility from Hostinger/DNS/TLS failures using a production endpoint returning empty 204 for GET, HEAD, POST and OPTIONS.
2. BOS impact: diagnostic ingress only; no customer, conversation, workflow, attribution or AI operations.
3. Modules/callers: a standalone Next.js route at `/api/whatsapp/gupshup-check`; no auth, middleware or database imports.
4. Data: no schema changes, payload reads or writes. Log only request method, forwarded IP and user agent, bounded to 200 characters, without query strings, bodies, credentials or cookies.
5. API: all four methods return empty 204 with no cookie or redirect. This is never the permanent message callback. Diagnostic availability expires after 2026-10-05 UTC; remove the route once diagnosis finishes.
6. UI: none.
7. Verification: existing isolated database suite, lint, TypeScript, build and both CI database jobs; deploy, curl all four methods, compare Gupshup URL validation and inspect runtime logs. Preserve formal webhook secret verification. Rollback/removal is code-only.
