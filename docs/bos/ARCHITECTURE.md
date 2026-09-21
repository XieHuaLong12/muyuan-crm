# LVANJU BOS Core System v1

## Existing architecture and migration boundary

Base: main 82cf3e9 (PR #6 deadlock fix). Next.js 15 App Router, React 19, strict TypeScript; Prisma 6 / MySQL. `app/page.tsx` is the V3 Today workspace. Customers, WhatsApp and Tasks have explicit pages; the legacy catch-all serves analytics/funnel/settings/targets. Basic CRM APIs live in `app/api/[...path]/route.ts`; tasks, quotations, workflow events, WhatsApp, reminders and sync have explicit routes. `services/` owns access scope and database operations. V3 components live in `components/workspace/`; old components remain available. Customer is the canonical record linking conversations, tasks, quotations, deals and AI intelligence.

The P2034 retry and Customer row lock from PR #6 remain intact. BOS page loaders and GET APIs only read. Background task catch-up uses the existing authenticated POST /api/workflows/sync; no render-time mutation is added.

## Routes

```
app/
  (command-center)/command-center/{page,loading}.tsx → /command-center
  (growth)/growth/{page,loading}.tsx                 → /growth
  (sales)/sales/{page,loading}.tsx                   → /sales
  customers/[[...customerPath]]/page.tsx             → unchanged
  whatsapp/page.tsx                                 → unchanged
  tasks/page.tsx                                    → unchanged
  page.tsx                                         → unchanged old Today
```

Route groups do not create URLs. Only new modules are grouped in v1. `(customers)`, `(whatsapp)` and `(tasks)` are reserved for a later move of existing pages, avoiding duplicate Next routes and unnecessary path churn now. Old navigation gains one BOS entry; successful login lands admins at /command-center and sales users at /sales. Old pages stay directly accessible.

Read APIs: GET /api/bos/command-center, /api/bos/growth, /api/bos/sales. All require the existing session. Admins see team records; sales users see their own customer and marketing records. Query validation caps page size and input lengths. No advertising connector or marketing write API is added in v1.

## Data contracts

Reuse canonical Customer fields rather than introducing competing copies:

| BOS field | Existing source |
|---|---|
| source | Customer.source |
| leadScore | Customer.aiScore |
| lastContactAt | Customer.lastContactAt |
| nextFollowUpAt | Customer.nextFollowUpAt |
| opportunityStage | mapping from Customer.stage |
| estimatedValue | Customer.estimatedOrderValue + currency |

NEW → New Lead; CONTACTED → Contacted; REPLIED / NEEDS_CONFIRMED → Replied; QUOTED → Quoted; FOLLOW_UP / ORDER → Negotiation; WON → Won. ORDER confirms purchase intent, not an actual registered deal. Other states stay visible in the full CRM and are counted separately in Command Center. Funnel counts are current mutually exclusive stage counts, not historical conversion rates.

Additive tables only:
- LeadSource: channel dimension, optional external ID, creator scope.
- Campaign: channel, source relation, currency, status, optional external ID and creator scope.
- MarketingMetric: daily campaign totals (spend Decimal(14,2), impressions, clicks, leads), unique campaign/day. Currency comes from Campaign. Daily metric dates represent reporting calendar dates, not timestamp instants.

Migration 20260921090000_bos_growth_foundation creates only these tables and their indexes/foreign keys. It does not change any existing columns. Existing production initialization applies migrations; no new secrets, services or environment variables required. Full deployment build must finish before serving new routes.

## Metric semantics

Command: today means company timezone; new customers use createdAt. Follow-ups include active customers with due schedules/tasks through today. Quotes/orders/revenue are month-to-date, explicitly labeled. Actual deal values stay separated by currency. Business Assistant v1 uses deterministic CRM rules; it does not claim to run an LLM. No advertising costs or trends are invented.

Growth: Lead Pool includes all scoped non-deleted sources, 50 per page, searched by name/company/country. Campaign table shows up to 100 recently created campaigns and 30 reporting days. CTR = clicks/impressions; CPL = spend/leads. Unknown/zero-denominator values use an em dash. Source customer counts are not labeled as platform-attributed ad leads. Channels remain NOT_CONNECTED until real connectors are built.

Sales: queues are today's due work (including overdue), inbound messages awaiting our reply, high intent/score ≥80, and recent customer updates. 50 customers per page; no cross-currency value comparison. Deep links and Next navigation retain the selected customer. Existing WhatsApp transport, 5-second message refresh, attachments, AI reply generator, quotation and optimistic TaskCenter logic are reused. Sending a catalog selects a real attachment; it does not pretend a catalog was sent. The AI panel is portaled into the third column via an optional prop; legacy callers retain their existing layout.

## Design system

Scoped `.bos` CSS prevents regressions to existing pages. Mac system font stack, 36/20/15/14/13 typography, requested color tokens, 12–16px corners, restrained shadows. Shared Typography, Button, Card, Input, Search, Table, Badge, Sidebar, Header plus empty/loading states. Responsive layouts collapse on smaller widths; reduced-motion and visible keyboard focus are supported.

## Next phase (not implemented)

Agree on advertising account ownership and reporting timezone, then connect one channel first. Add authenticated ingestion with stable external IDs and daily metric upserts; define lead attribution before computing ROI. Add campaign paging beyond 100 and saved sales filters based on real usage. Do not add unrelated BOS modules during this phase.
