# Task deadlock repair

Confirmed against main merge 528b990 (PR #5); its tree matches the local V3 checkout.

## Call chain and cause

Before: app/page.tsx → salesHome; app/tasks/page.tsx; GET /api/sales-workspace → salesHome; GET /api/tasks; GET /api/reminders → syncWorkflows → syncAll → Promise.all (4 customer transactions) → syncCustomerWorkflow → db.$transaction → resolveRule → reminder.updateMany → task.updateMany.

Webhook background work, successful WhatsApp sends, and quotation/follow-up mutations also call syncCustomerWorkflow. Manual task updates use Task → Reminder, the reverse lock order from resolveRule. Multiple tabs, users and server processes can overlap; the process-local throttle is not a distributed lock. MySQL range writes and inverse lock acquisition can produce P2034. This is a code-confirmed contention path matching the reported stack, not a verified production InnoDB wait graph (no production deadlock report was supplied).

Global search covered updateMany, task.updateMany, $transaction and Promise.all. Other transaction sites include imports, customers, targets, quotations, WhatsApp ingestion/sending/read state and AI analysis. Read-only Promise.all queries are retained.

## Changes

- Retry whole task/workflow/AI task transactions on Prisma P2034 only. Three total attempts: wait 500 ms after first failure, 1000 ms after second, throw original third error. No network provider call is replayed; validation/409/P2002 errors are not retried.
- Resolve obsolete rules by sorted task primary keys, acquiring Task before Reminder; avoid broad relational reminder writes. Customer sweeps run sequentially. A parameterized Customer primary-key FOR UPDATE lock precedes workflow snapshot reads, serializing the same customer across server processes and preventing concurrent automation-key creation. An in-flight sweep remains coalesced even after 60 seconds.
- Home/task rendering and GET APIs are read-only. WorkspaceShell uses authenticated POST /api/workflows/sync at mount and 60 seconds after each completed request. Failures are isolated from page rendering; next interval retries. Event-triggered sync remains intact. This is an in-app catch-up mechanism, not a durable external job scheduler. Separate processes serialize same-customer sweeps with a database row lock; other task writers are protected by consistent lock ordering and bounded retries.
- No schema migration or new environment variables required. No production database was modified by this repair.

## Validation

Unit tests cover recovery, exact delays/attempt cap and non-retryable failures. MySQL integration adds concurrent workflow convergence and task completion versus rule resolution, checking reminders stay dismissed. Existing CI runs the full MySQL suite, ESLint, strict TypeScript and npm run build.
