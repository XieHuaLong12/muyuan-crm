# Gupshup CTWA implementation and impact analysis

## 1. Requirement

Implement the real CTWA → Gupshup → canonical CRM identity chain first. Retain Lead Form, Cloud API and historical Local Sync. Follow with approved-template reactivation, manual confirmation, durable queue and acquisition/reactivation attribution. Provider configuration, an incoming ad referral and external template approval are evidence requirements, never simulated production success.

## 2. BOS impact

L3 across Communication, Customer, Sales, Growth and Order OS. Customer remains the canonical entity; no parallel contact CRM. Live service windows are scoped to provider/business account, separately from historical customer last-contact facts. AI remains advisory; CAPI remains disabled by default.

## 3. Existing modules and callers

`whatsapp-webhook-service`, `whatsapp-message-service`, `conversation-identity-service`, `contact-identity-service`, `customer-intelligence-service`, `identity-analytics-service`, `order-attribution-service`; webhook/send/history APIs; SalesOS, WhatsAppChatPanel, WhatsAppWorkspace, IdentityTimeline and analytics pages. Existing webhook originally incorrectly unwraps the Gupshup envelope before parsing. Existing ingestion queues all unknown contacts, contrary to new Gupshup auto-create requirement. Existing send gate uses customer-wide history rather than account-scoped live inbound evidence.

## 4. Data model change

Phase one reuses Customer, ContactIdentity, WhatsAppContact, WhatsAppConversation, WhatsAppMessage and CustomerLeadAttribution. CTWA acquisition is an immutable ledger entry keyed by provider/account/message with referral in `answers`; ad source IDs are only treated as ads when `source_type=ad`. Names come from actual AdDimension snapshots; unavailable dimensions remain null. No destructive operations.

Subsequent additive migration: opt-in status/source/evidence/dates on Customer; verified customer-window timestamp on Conversation; provider/account/source/destination/status timestamps and optional campaign recipient on Message; template inventory with provider verification; ReactivationCampaign and Recipient with preview digest, delivery facts, finite retry/lease state; persisted status receipt journal for out-of-order callbacks; order reactivation snapshot plus configurable follow-up hours. All new existing-table fields nullable or defaulted. Existing unique IDs, singleton rows, soft deletion, Deal.dealDate and message `text` mapping are preserved. Old migrations are never modified. Provider/account/message sourceKey provides scoped idempotence without weakening old global keys.

## 5. API change

Existing webhook/send/history remain compatible. Add authenticated templates list/import/sync, preview/confirmed template send, CRM recipient filters, campaign draft/preview/confirm/cancel/worker, integration status and admin debug endpoints. Every input is Zod validated in services; responses retain `{success,data}`. Sales access is customer-owner scoped; managers/admins control batch operations. Provider secrets are server-only. Callback authentication is mandatory and payload size bounded.

## 6. UI change

Reuse the existing Sales communication center for `/whatsapp/inbox`. Add BOS template/campaign/settings pages using existing primitives and tokens; display provider-confirmed status and UNKNOWN window/consent explicitly. Template previews and batch second confirmation are required. No separate chat subsystem. Raw provider bodies and secrets are excluded from default response projections.

## 7. Implementation and validation

1. Repair authenticated envelope parsing; auto-create only valid unambiguous Gupshup inbound identities, snapshot referral, account-scoped sending window, integration diagnostics. Real incoming CTWA acceptance is the first production milestone.
2. Add approved-template inventory and preview/confirmation, explicit opt-in with audit, STOP handling. Inbound customer message alone is not proof of marketing opt-in.
3. Add CRM-only campaign recipients, preview digest and account rate configuration; bounded durable worker, failure isolation and UNKNOWN send-result quarantine. Do not blindly retry accepted/unknown network requests.
4. Freeze acquisition + qualifying reactivation at order creation; reuse incremental AI/human precedence, configurable follow-up, actual-metric analytics and journey/debug views.
5. Generate additive Prisma diff against the deployed schema. Test isolated MySQL upgrade/idempotence/concurrency/authorization/receipt order/window and consent gates; Prisma, lint, TypeScript, build; desktop/mobile UI. Do not run write tests against production.
6. Deploy only validated changes through existing Hostinger main deployment; real A–D evidence stays separate from unit/integration mocks. Real batch execution requires the user's explicit final approval. Rollback application only; preserve additive tables and historical data.

## Official contract evidence (checked 2026-10-04)

- [Gupshup referral](https://docs.gupshup.io/docs/other): ad/post source_id and source_type; ctwa_clid where present. A referral proves an incoming message from an ad, not a separately observed click timestamp.
- [Gupshup message events](https://docs.gupshup.io/docs/message-events): id/gsId differ; callbacks may arrive out of order. Enqueued is not delivered.
- [Gupshup subscriptions](https://docs.gupshup.io/docs/subscriptions-and-notifications): sent/delivered/read and template/account events require subscriptions.
- [WhatsApp policy](https://whatsappbusiness.com/policy/): ordinary replies within 24h of the user's message; approved templates outside it; subsequent messaging requires opt-in and opt-out must be honored.

## Live provider inventory observed

2026-10-04: JasonCRM live on +8619966852192; business portfolio limit shown 2K customers/24h. Jason4430 has incomplete embedded signup. JasonCRM has no custom templates. These facts do not prove webhook delivery, valid server credentials, template approval or CTWA referral ingestion. The portfolio recipient limit is not messages/second and must not be converted into one.

Phase-one migration: `20261004023000_gupshup_live_identity` (Prisma-generated), Customer consent default UNKNOWN, WhatsAppMessage provider/account and receipt timestamps, Conversation live inbound evidence, one receipt journal. All original 16 migration files unchanged. Template/campaign models remain a next-phase design until the required real first milestone is accepted.

Cross-source dedup is implemented bidirectionally for exact shared native `wamid` + business phone + customer phone + direction. Provider raw evidence remains in the imported ingestion ledger; canonical chat displays one message. DOM-only historical IDs cannot be proven equal to API IDs and are never fuzzy-merged.

MariaDB CI uncovered ER_CHECKREAD 1020 in the existing concurrent task/workflow test. Phase one therefore extends the existing bounded whole-transaction retry classifier to this exact Prisma connector error, without retrying network requests or weakening optimistic task updates. This shared-helper change is covered by recovery/exhaustion/non-retryable tests and both database CI jobs.
