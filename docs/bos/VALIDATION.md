# BOS validation

- Design System: strict TypeScript and scoped ESLint passed before starting Command Center.
- Command Center: timezone/DST boundaries, stage mapping, unknown advertising values unit tests; TypeScript and ESLint passed.
- Growth Center: Prisma migration generated from the prior schema; additive tables/foreign keys inspected. Prisma generate, TypeScript and ESLint passed.
- Sales OS: TypeScript and ESLint passed; full Next production build compiled all three new routes while retaining legacy routes.
- Browser checks used real React components in a temporary local fixture route (no production data or sends). Inspected Command Center, Lead Pool, and Sales OS at desktop/MacBook width; validated AI generation → edit in composer, quotation creation form, and embedded task editor. At 390px checked responsive navigation/customer queue and document width (390px, no page overflow). Adjusted desktop workspace height so composer remains visible. Fixture route is removed from the commit.
- Added MySQL service regression: owner isolation for customers/campaigns, soft deletes, due/reply/high/recent queues, reply resolution, search and validation, currency-separated deal totals, reporting-date campaign metrics, CPL/CTR, and absence of task creation during reads.
- GitHub CI is the authoritative full MySQL verification, including existing database upgrade, existing CRM/WhatsApp/task tests, ESLint, TypeScript and npm run build. Local environment has no MySQL service; no production database migration was run from the developer machine.
