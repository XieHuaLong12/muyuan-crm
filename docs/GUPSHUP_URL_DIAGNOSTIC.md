# Temporary Gupshup URL validation diagnostic

1. Requirement: distinguish Gupshup URL-validator incompatibility from Hostinger/DNS/TLS failures using a production endpoint returning empty 204 for GET, HEAD, POST and OPTIONS.
2. BOS impact: diagnostic ingress only; no customer, conversation, workflow, attribution or AI operations.
3. Modules/callers: a standalone Next.js route at `/api/whatsapp/gupshup-check`; no auth, middleware or database imports.
4. Data: no schema changes, payload reads or writes. Log only request method, forwarded IP and user agent, bounded to 200 characters, without query strings, bodies, credentials or cookies.
5. API: all four methods return empty 204 with no cookie or redirect. This is never the permanent message callback. Diagnostic availability expires after 2026-10-05 UTC; remove the route once diagnosis finishes.
6. UI: none.
7. Verification: existing isolated database suite, lint, TypeScript, build and both CI database jobs; deploy, curl all four methods, compare Gupshup URL validation and inspect runtime logs. Preserve formal webhook secret verification. Rollback/removal is code-only.

## Real inbound identity defect found during acceptance

1. Requirement: a real authenticated inbound message matched a legacy customer, but the customer's canonical phone field remained empty. Complete that customer's existing identity using the shared normalization service.
2. BOS impact: only the already matched customer's phone/email normalization and historical contact aliases, in the existing inbound transaction.
3. Modules/callers: `whatsapp-webhook-service` and existing `rememberCustomerContacts`; unchanged parser, message, account and conversation resolution.
4. Data: no schema/migrations, reassignment, merge or raw contact overwrite. Reuse contact values already held by the matched customer; retain conflict detection before the write.
5. API: unchanged authentication, response and deferred processing; only authenticated Gupshup inbound matches normalize old records.
6. UI: none.
7. Verification: a legacy customer with a formatted phone and no canonical identity must match once, acquire its canonical identity/alias, preserve name/owner/stage, save one message and open its account window. Run both database CI jobs and real inbound acceptance.

## Production diagnosis

- All four diagnostic methods returned empty 204 with no redirect. Gupshup's URL check successfully created a diagnostic subscription, then that temporary subscription was immediately deleted. Runtime logs show its validator used POST from `15.206.217.7` with `okhttp/4.12.0`. Production formal POST rejects unauthenticated/non-business probes rather than writing arbitrary public input to CRM.
- An ordinary official subscription update returned HTTP 400 `Invalid URL Passed`; the same formal URL saved successfully using the official `doCheck=false` option. Read-back confirmed active Meta v3 subscription and `x-webhook-secret` matching the production secret. No secret values are included here.
- Independent SSL Labs nodes: two IPv4 and two IPv6 endpoints all grade A, TLS 1.2/1.3, certificate chain issues 0. The diagnostic check also directly proves that Gupshup can reach the production hosting/network, so an external test-message sink was unnecessary.
- A real WhatsApp message from the owner's test account reached the existing customer and canonical conversation, persisted the requested text, and opened the correct business account's window. This exposed the legacy canonical-phone gap addressed above.
- The temporary public diagnostic route is removed in this change. Formal webhook health/ACK responses and security remain unchanged.

Official API references: [subscription update](https://docs.gupshup.io/reference/updateanexisitngsubscription), [documented URL-check and custom-header options](https://partner-docs.gupshup.io/reference/put_partner-app-appid-subscription-subscriptionid).
