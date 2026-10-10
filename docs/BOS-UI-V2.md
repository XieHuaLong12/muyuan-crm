# LVANJU BOS UI V2

## Information architecture

The daily entry point `/` redirects to the role home (`/command-center` for administrators, `/sales` for salespeople). Since 2026-10-10 the sidebar is organised into sections whose related pages are tabs (see `lib/role-workspace.ts` and docs/ROLE_WORKSPACES.md); old addresses such as `/command-center/legacy`, `/orders/list` and `/today` redirect from `next.config.ts`.

## Layout and component system

`app/bos-v2.css` provides cream surfaces, deep green accents, type hierarchy, responsive cards, a reduced sidebar, horizontally scrollable Kanban, concise data visualizations, and reduced-motion support. Existing CRM and WhatsApp components retain their functionality and are reused inside the Communication Center. New components are `Dashboard`, `CrmKanban`, `OrderJourney`, and `FinanceCenter` under `components/bos-v2/`.

Dashboard starts with four decision metrics, followed by a six-stage activity funnel and a proactive business briefing. The funnel combines synchronized ad activity and CRM events, so its adjacent ratios are explicitly labeled directional rather than as a single attributed cohort. Growth Center uses one date window for campaign, lead, quote, and deal data. Its ROI placeholder is intentional: ad leads cannot yet be reliably tied to all CRM revenue and currencies. Displaying a computed ROI now would imply accuracy the data does not support.

CRM Kanban uses persisted `Customer.stage` values. Drag-and-drop and the keyboard-accessible stage selector call `/api/bos/crm-stage`, which checks access, compares the current stage, updates the customer, and records `StageHistory` in one retryable transaction. A customer with a deal cannot be demoted or marked won by dragging. There is no independent `CATALOG_SENT` stage in the current schema, so the UI uses the existing WhatsApp “发送目录” action. `FOLLOW_UP` represents the current negotiation/follow-up stage and `ORDER` means purchase confirmed. These meanings are explained in the UI.

Order Center adds an eight-step journey map while preserving the existing seven-step persisted order workflow. Quality inspection has no field in the current schema, so it is marked as pending rather than recorded as done. Finance Center reads real deal revenue, product cost, gross profit, and ad spend, grouped by currency. Sales and freight costs are unavailable; net profit is deliberately not calculated. Messenger and Email appear as future channels; WhatsApp uses the working Sales OS chat and AI reply.

## Data and deployment boundaries

No Prisma migration or new environment variable is required. Existing Meta Ads, customer, order, WhatsApp, task, authentication, and role logic remain in place. Future iterations can add catalog-send milestones, a quality inspection record, expense entries, and lead-to-deal campaign attribution before activating precise ROI and net-profit figures. Validate those changes separately from the V2 navigation release.
