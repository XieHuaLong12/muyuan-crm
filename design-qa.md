# Sales Workspace V3 design QA

final result: passed

## Source and evidence

Source visual truth: user-supplied `/Users/xiehualong/Downloads/f40344df-0944-4f5f-920f-dea90d9265f5.png` (1672 × 941 pixels), plus the explicit Apple-style V3 redesign brief. This is a redesign, not an exact screenshot clone: the source's dense table becomes a 35% customer list, its workbench expands to 65%, and the AI reply moves from below the chat to its right. Bulk controls remain available in the existing customer directory.

Browser-rendered implementation evidence: `docs/v3-preview/customer-desktop.png`, `tasks-desktop.png`, `home-desktop.png`, `tasks-mobile.png`, `home-mobile.png`, `customer-mobile.png`.

Desktop CSS viewport / image dimensions: 1280 × 800, density 1. Mobile: 390 × 844, density 1. Also measured at 1672 × 941: list/workspace 480.9 / 893.1 px, matching 35/65 after the gap; composer bottom 923 px, horizontal overflow false. Native capture at this larger override clipped in the browser integration, so the final screenshot comparison uses the complete 1280-pixel capture and compares the same customer/chat state and proportional regions rather than claiming pixel identity across widths. No image was stretched or re-generated.

State: isolated fixture data based on AKINA / Modern Home, real production React components and CSS, mocked local APIs. No production customer messages were sent. Screenshots are design evidence, not proof of live provider delivery. Database integration is separately exercised in GitHub CI.

The source and implementation captures were opened together for full-view comparison. Focused reading covered the customer header, chat composer, AI column and task row controls; these are legible in the 1280-pixel captures. No raster asset or logo reconstruction was required: the supplied screenshot uses initial avatars and simple interface icons, preserved with actual text initials and the existing Lucide library.

## Comparison history

1. P2: small working text reduced readability. Initial chat text was 11px and assistant text 10px. Increased chat/composer to 13px, AI reply to 12px, task titles to 13px; increased supporting text contrast. Revised customer capture verifies wrapping and hierarchy.
2. P1: legacy global `select { width:100% }` consumed the task row and squeezed titles vertically. Fixed task status to a 90px flex basis and title area to a flexible minimum basis. Revised tasks-desktop.png shows all four rows with readable titles and aligned controls. DOM title area is 609.85px at 1280px.
3. P2: workbench minimum height pushed the composer below shorter laptop screens. Added viewport-based height and compact header treatment. Revised 1280 × 800 capture places composer bottom at 774px. Older history and AI content scroll within their own regions; the message input remains available.
4. Post-fix mobile checks: no document horizontal overflow at 390px on home, tasks or customers; task status wraps cleanly below titles. Customer list switches to a back/list navigation and AI assistant stacks below chat at phone width, an intentional responsive exception to the desktop right-column rule.

## Required surfaces

- Typography: Inter with immediate system fallback; clear title/body/metadata hierarchy. Reading content 12–13px, compact nonessential metadata smaller. Long customer previews truncate while chat and task content wrap.
- Spacing/layout: 16px white surfaces, pale canvas, restrained gaps, fixed desktop workbench, independent scroll containers. Dense batch table remains on a dedicated route instead of occupying the daily workspace.
- Colors/tokens: #F7F8F6 background, LVANJU dark green navigation/actions, quiet green sent bubbles, white received bubbles, muted warm red only for overdue/error states. Visible focus outlines and reduced-motion rules included.
- Image/asset quality: existing Lucide line icons and initial avatars stay sharp; media uses actual attachment URLs with image/audio/video/file rendering. No decorative bitmap assets, fake online badges or CSS illustrations were introduced.
- Copy/content: concise Chinese operation labels with English sales terminology. Empty states give an action. Online status truthfully remains unknown. AI drafts are suggestions that require an explicit send.

## Interactions verified

- Task checkbox updates status to DONE and completion styling immediately.
- New task form saves a task and displays it in the list.
- Quick reply fills the composer; simulated send appends the actual returned message without page reload.
- AI generate renders editable advice; copy/edit/send controls appear.
- Mobile back-to-list and switching to Blu Garcia update the customer header.
- Desktop and mobile DOM checks report no horizontal overflow.
- Browser console error log: empty during the tested flows.
- Server/data verification: CI runs migrations, permission/lifecycle/reminder/media/AI tests, lint, strict TypeScript and full production build. No live Gupshup or paid DeepSeek calls were made during visual testing.

## Remaining non-blocking limits

In-app reminders require an open CRM. Incoming provider media URLs can expire. Audio is playable/uploadable; microphone recording is not part of V3. A full assistive-technology audit and live external-provider delivery acceptance are outside this visual QA.

## Implementation checklist

- [x] Readable working text and consistent tokens
- [x] Fixed task row sizing and complete/reopen affordances
- [x] Visible composer on desktop; responsive mobile flow
- [x] Real component browser captures and interaction checks
- [x] Existing customer, analytics, targets and settings workflows retained
