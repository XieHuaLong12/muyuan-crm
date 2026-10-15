# Meta Facebook Lead Ads 接入说明

## 流程

```
客户提交 Facebook / Instagram 广告表单
 ├─ ① Webhook（实时，通常几秒）→ /api/leads/webhook（先验 X-Hub-Signature-256）
 └─ ② 定时补拉（每 5 分钟）→ GET /{form_id}/leads?filtering=time_created>水位
        ↓ 两条通道走同一个入库函数，按 leadgen_id 幂等，不会重复建档
   Graph API 线索详情 → 映射 CRM 字段 → 按电话 / 邮箱关联老客户或新建客户（带广告归因）
        ↓
   新客户进入待分配池 → 管理员实时收到「新线索待分配」→ 分配给销售
        ↓
   销售实时收到「新分配客户 · 请在 5 分钟内联系」→ 首联任务 5 分钟到期，超时再次提醒
   老客户再次留资 → 给当前负责人建高优先级任务（同样 5 分钟），记录跟进后自动完成
```

## 实时入库、补拉与提醒（2026-10-09）

| 环节 | 行为 |
|---|---|
| Webhook | 主通道。处理完成才返回 200；失败返回 503 让 Meta 重试。`MetaLeadEvent.receivedVia=WEBHOOK` |
| 定时补拉 | `POST /api/cron/meta-leads`（请求头 `x-cron-secret: META_SYNC_SECRET`），**建议每 5 分钟**。按 ACTIVE 表单读取「上次水位 − 10 分钟」之后提交的线索，补回 Webhook 漏掉的（`receivedVia=POLL`）。首次运行回看 48 小时；设置页可手动补拉最近 1 / 7 / 30 / 90 天（Meta 只保留 90 天） |
| 自动重试 | 网络、限流、Token 等失败按 1、2、4 … 分钟退避，最长 1 小时一次，由同一个定时任务执行；缺联系方式、对应多个客户、关联到回收站客户的线索需要人工认领，不自动重试 |
| 首联时限 | 24 小时内有 Meta 表单或 WhatsApp 广告留资的客户，分配后须在 **5 分钟**内首次联系（销售团队页可改，1–1440 分钟）；其他客户仍按小时计 |
| 实时提醒 | 页面每 20 秒（后台标签页每 60 秒）读取 `/api/notifications`：页内弹窗 + 提示音 + 浏览器桌面通知（需在顶栏点「开启桌面通知」）。管理员：新线索待分配、线索需人工处理、自己名下的任务；销售：新分配客户、首联超时、老客户再次留资、任务到期 |
| 接入体检 | 广告与线索 →「线索接入」（`/growth/intake`）：今日收到 / 建档 / 失败、提交到入库的时延、待分配数量、最近一次 Webhook 与补拉、表单入库对照；读取失败时列出 Meta 原文、原因和处理步骤。「检测连接」会用主页 Token 读取 `/me` 与 `/{page_id}/subscribed_apps`，用 `debug_token` 检查权限，并实际读取一条线索，确认 Token 属于该主页、有读线索权限、主页已为本应用订阅 `leadgen`；未订阅时可一键订阅（需要 `pages_manage_metadata` 权限，保留已订阅的其他字段） |

### 部署后配置

1. 在 Hostinger 面板的 Cron Jobs 中新增每 5 分钟一次：
   ```bash
   curl -fsS -X POST -H "x-cron-secret: <META_SYNC_SECRET>" https://你的域名/api/cron/meta-leads
   ```
2. 确认 `META_PAGE_ID` 已配置（表单目录每小时自动刷新一次，新建的表单会自动纳入补拉）。
3. 打开「广告与线索 → 线索接入」，点「检测连接」，提示全部正常后，用 Meta 线索测试工具提交一条测试线索：几秒内应在「待分配」看到它，管理员浏览器弹出提醒。
4. 销售与管理员各自在手机 App（或电脑浏览器）顶栏点「开启通知」并允许（需要 HTTPS）。之后 App 关着也能收到新线索推送，见 [手机 App](MOBILE_APP.md)。

> 体检提示「最近 24 小时有 N 条线索是定时补拉补回的」说明 Webhook 没有送达：按下方「生产定位顺序」检查主页订阅、应用上线状态和 `META_APP_SECRET`。

### 收到推送但线索进不来（读取线索失败）

症状：「最近一次 Webhook 线索」有时间，但各表单「CRM 已入库」为 0，「自动重试中」不断增加，补拉提示「N 个表单读取失败」。这说明 Meta 推送已经到达、验签也通过，失败在**用主页 Token 读取线索内容**这一步。表单目录能同步不代表能读线索：读表单列表和读线索内容是两种权限。

面板会把 Meta 返回的原文、原因和处理步骤直接列出来（同一原因只列一次，并注明出现在哪些环节）。「检测连接」会额外：

- 用 `debug_token` 查看 Token 类型、是否有效、过期时间，以及缺少哪些读线索权限（`leads_retrieval`、`pages_manage_ads`、`pages_read_engagement`、`pages_show_list`）。配置了 `META_APP_ID` 和 `META_APP_SECRET` 时用应用 Token 检查。
- 实际读取一次「最近失败的线索」和「线索最多的表单」，与 Webhook、补拉走同一个接口，结果就是线上真实情况。

常见原因与处理：

| Meta 返回 | 原因 | 处理 |
|---|---|---|
| `code 100 subcode 33` / `code 10` / `code 200` | Token 没有该主页的线索访问权限 | ① 重新生成 Token 时勾选上面四项权限；② Business 设置 → 集成 → **线索访问权限（Leads Access）** → 选中主页，在「CRM」中分配本应用、在「人员」中加入生成 Token 的人或系统用户；③ 应用在开发模式时，生成 Token 的人必须是应用管理员或开发者，否则为 `leads_retrieval` 申请高级权限 |
| `code 190` | Token 失效 | 用系统用户重新生成不过期的主页 Token，更新 `META_PAGE_ACCESS_TOKEN` 后重启 |
| `code 4 / 17 / 32 / 613` | 调用次数超限 | 无需处理，自动退避重试 |

改好后点「检测连接」确认两项读取都显示 ✓，再点「立即重试失败线索」和「补拉最近 7 天」，积压的线索会立即入库。补拉到的几天前的老留资只记录，不会给负责人生成「5 分钟内联系」的再次留资任务。

> Lead Ads Testing Tool 生成的线索字段是 `<test lead: dummy data for email>` 这类占位数据，没有真实联系方式，所以不会建客户；面板「需要人工处理」里会标注「Meta 线索测试工具生成的占位数据」，管理员收到「收到 Meta 测试线索」提醒——看到它就说明接入已打通。要走完「建档 → 待分配 → 提醒销售」全流程，请在广告或表单预览里用自己的真实邮箱 / 手机号提交一次。

## 环境变量

在 **Hostinger 面板 → Environment variables**（或本机 `.env`）添加：

| 变量 | 必填 | 说明 |
|---|---|---|
| `META_LEAD_WEBHOOK_SECRET` | ✅ | 专用于 Meta Webhook 验证。**不要复用 `WEBHOOK_SECRET`** |
| `META_PAGE_ACCESS_TOKEN` | ✅ | 读取 leadgen 详情的 Page Access Token |
| `META_APP_SECRET` | ✅ | 校验 `X-Hub-Signature-256`。**不配则拒绝一切推送** |
| `META_GRAPH_VERSION` | ➖ | 已存在，默认 `v26.0`。Meta 约两年废弃一次版本，到期只改这个变量，不用改代码 |

> ⚠️ 不加 `META_APP_SECRET` 的话，本接口会**拒绝所有推送**（有意为之：宁可漏，不可被伪造客户灌库）。

## Meta 后台配置

1. **developers.facebook.com → 你的 App → Webhooks → Page**
2. **Callback URL**：`https://你的域名/api/leads/webhook`
3. **Verify Token**：填 `META_LEAD_WEBHOOK_SECRET` 的值（必须完全一致）
4. 点 **Verify and Save**
5. **订阅字段**：勾选 **`leadgen`**
6. 到 **Page → Lead Access**，确认该 Page 已授权给你的 App
7. 生成 `META_PAGE_ACCESS_TOKEN`：App → Messenger/Page → 生成 **Page Access Token**（需要 `leads_retrieval` 权限）

## 测试

### 1. 浏览器验证（最快）

```
https://avenlee.online/api/leads/webhook?hub.mode=subscribe&hub.verify_token=<TOKEN>&hub.challenge=test123
```

- 页面显示 **`test123`** → 通过
- 返回 `forbidden` → `META_LEAD_WEBHOOK_SECRET` 不匹配或未配置

### 2. 用 Meta 的测试工具推送

Meta App → Webhooks → Page → **Test** 按钮，或到 **Lead Ads Testing Tool** 用真实表单提交一条测试线索。

### 3. 确认 CRM

1. 打开 **客户 → 客户列表**，应出现一条 `source=Facebook`、`sourceDetail=Facebook Ads`、阶段 **新客户** 的记录
2. 或直接查库：

```sql
SELECT leadgenId, formId, status, customerId, error, createdAt
FROM MetaLeadEvent ORDER BY createdAt DESC LIMIT 10;
```

`status` 含义：

| status | 含义 |
|---|---|
| `RECEIVED` | 已登记，正在处理（超过 2 分钟仍未完成会由定时任务接手） |
| `PROCESSING` | 处理器已认领；若进程中断，5 分钟后重试可重新认领 |
| `CREATED` | 已创建新客户 |
| `LINKED` | **已有相同邮箱/电话的客户，已关联而不重复创建** |
| `SKIPPED` | 该 `leadgen_id` 已处理过（Meta 重推） |
| `FAILED` | 失败，`error` 列有原因（多为 token 缺失或权限不足）；`attempts` / `nextAttemptAt` 为自动重试次数与下次时间 |

签名正确但 `entry: []` 的测试包只证明入口和验签可用，不会产生 `MetaLeadEvent` 或客户。要验证入库，必须用真实表单产生带 `leadgen_id` 的事件。

### 生产定位顺序

1. 在 Meta Lead Ads Testing Tool 对目标 Page 的真实 Instant Form 创建一条**新的**测试 Lead，并记录时间和测试工具的投递状态。确认该 App 在 Meta Business Settings → Integrations → Leads Access 的该 Page 下获准访问，且 Webhooks → Page 已订阅 `leadgen`。若工具仍为 Pending，先查 Page 对 App 的订阅与 Lead Access；广告账户和表单目录同步成功不等于 Lead Webhook 已投递。
2. 在 Hostinger 同一时间段日志中按 `[meta-lead] POST received` 检索。如果没有该日志，Meta 没有到达此入口，检查 Meta App 的 Callback URL、Page 订阅、投递记录和 Hostinger 代理/WAF。如果有 `signature failed`，核对 Meta App 对应的 `META_APP_SECRET`。
3. 看 `payload parsed` 的 `accepted`。`0` 表示该请求没有 `leadgen` 变更；正数表示已提取事件。随后查 `SELECT leadgenId, pageId, formId, status, customerId, error, createdAt FROM MetaLeadEvent ORDER BY createdAt DESC LIMIT 20;`。
4. `FAILED` 且 `Graph API HTTP ... code ...` 时，用**同一个 Page Token**在 Meta Graph API Explorer 读取该测试 `leadgen_id`，核对 token 的 Page ID、`leads_retrieval` 权限和 Leads Access。不要把 token、App Secret 或完整客户信息贴到工单或日志。`CREATED` / `LINKED` 则说明入库已成功，再到 CRM 核对客户筛选条件。

部署时必须先执行 Prisma migration，再启动新版应用；否则新增的处理认领字段会导致数据库查询失败。无需新增环境变量；继续使用当前的 `META_APP_SECRET`、`META_PAGE_ACCESS_TOKEN`，以及可选的 `META_GRAPH_VERSION`。

## 字段映射

| Facebook 问题 | CRM 字段 |
|---|---|
| Company name | `companyName` |
| Full name | `name` |
| Email | `email` |
| WhatsApp number | `whatsapp`（并写入 `whatsappNormalized`） |
| 客户类型：What best describes your business? / What type of business are you? / Vous êtes ? / 客户类型… | `purchaseType`（归一到批发商/进口商/经销商…） |
| Which market or country… | `country` |
| 数量：Estimated order quantity per model? / How many pieces for your first order? / Quantité… | `quantity`（只记明确的件数；区间、「200+」、整柜不填，原答案进 `notes`） |
| 下单时间：When do you plan to place your order? / Purchase timeline… | `purchaseTimeline`（采购计划） |
| Are you interested in compressed / roll-packed sofas? | `productInterest` |
| Do you currently import furniture from China? | `notes` |
| What is your main concern when sourcing sofas? | `notes` |
| **未识别的问题** | `notes`，并保留**完整 JSON 原文** |

> 匹配按**问题的意思**而非写死的字段名（`lib/lead-answers.ts`），所以你在 Meta 里改问题措辞、新建不同问法的表单也能识别；英文、法文、西班牙文、阿拉伯文、中文的常见问法都认得。
> 客户类型的答案按关键词归类：wholesaler / grossiste / mayorista → 批发商，importer → 进口商，distributor → 经销商，retailer / store / showroom → 家具零售，brand → 品牌，online / e-commerce → 电商；一个答案命中多个类别时（如「Importer / wholesale」「furniture_/_mattress_wholesaler_or_distributor」），按**最早出现**的关键词归类。设计师、工程、酒店客户记为「其他」，但评级时算企业买家。
> 智能导入用同一套规则识别客户类型和数量。

## 安全设计

| 防线 | 作用 |
|---|---|
| `X-Hub-Signature-256`（HMAC SHA256 + `META_APP_SECRET`） | 防伪造推送写入客户 |
| `MetaLeadEvent.leadgenId` 唯一约束 | 防 Meta 重推造成重复客户 |
| 邮箱/电话查重后**关联**而非新建 | 防同一客户因多次投放重复建档 |

## 不会破坏的既有功能

`/api/leads/webhook` 原先由 catch-all 处理，走 `x-webhook-secret` 请求头。新路由**完整保留了该分支**：

- 带 `x-webhook-secret` 的 POST → 行为与之前**完全一致**（仍调用 `importLead`）
- 不带该头 → 走 Meta 签名校验流程

---

## 为什么 GET 必须完全独立（线上故障记录）

**症状**：Meta 后台点 Verify 报 `ERR_CONNECTION_CLOSED`。

**原因**：Next.js 在**模块加载期**就执行所有顶层 import。原来的 `route.ts` 顶层引了
`lead-import-service` 与 `meta-lead-service`，那条链会拉起 Prisma 客户端与整棵依赖图。
只要初始化失败或冷启动超时，**连不需要数据库的 GET 验证也会一起挂掉** ——
连接被直接关闭，Meta 看到的就是 `ERR_CONNECTION_CLOSED`。

**修法**：

| | 做法 |
|---|---|
| GET | 只 import `next/server` + `node:crypto`，不查库、不调 service、不调 Graph API |
| POST | service 一律用 `await import(...)` **动态加载**，只有真的收到推送才付出加载成本 |

`tests/meta-lead.test.ts` 里有一条断言把这条路钉死：**顶层一旦出现 service / Prisma import 就测试失败**。

## 排查顺序（如果 Verify 仍然失败）

1. **确认已重新部署** —— 改动不部署等于没改
2. 在服务器上直接 curl：

```bash
curl -i "https://avenee.online/api/leads/webhook?hub.mode=subscribe&hub.verify_token=<TOKEN>&hub.challenge=test123"
```

| 现象 | 说明 |
|---|---|
| 返回 `test123` | 代码与变量都对，问题在 Meta 后台填的 token |
| 返回 `403 forbidden` | 变量名或值不对（注意是 `META_LEAD_WEBHOOK_SECRET`） |
| 仍然连接被关闭 | **不再是代码问题**：Hostinger 代理 / WAF / SSL / 域名解析层拦截 |
| 返回 404 | 部署的还是旧版本，该路由不存在 |

---

## 相关文档

- **广告数据 + 表单目录同步**（Marketing API / leadgen_forms）：见 [META_ADS_SYNC.md](META_ADS_SYNC.md)。
  它与本页的 Lead Ads 线索推送互补：线索推送负责「进客户」，广告同步负责「看花费与归因」。

## 表单自动分级与响铃推送（2026-10-14）

每条广告表单入库后立刻评出 A / B / C / D 级，然后才发提醒，所以提醒里就带着等级和理由。

| 等级 | 含义 | 提醒方式 |
|---|---|---|
| A 优质 | 企业买家 + ≥ 20 件（线下起订量）或整柜 + 已从中国进口或 1 个月内下单 | 手机推送常驻通知栏；CRM 页面顶部置顶并持续响铃 |
| B 良好 | 企业买家并且满足其中一项（≥ 10 件、已从中国进口、1 个月内下单），或 ≥ 20 件 / 整柜但身份不明 | 同 A |
| C 一般 | 身份不明、个人自用、需求模糊 | 推送一次；页面弹出并响一声 |
| D 无效 | 测试数据、乱填、没有可联系方式 | 不推送、不响铃，只记录 |

- **谁来评**：配置了 `DEEPSEEK_API_KEY` 时由 DeepSeek 读整张表单判断（能看懂"两个货柜""我有三家店"这类自由填写），最多等 12 秒；没配置、失败或超时时按上表规则评。发给 AI 的只有表单答案，**不包括姓名、电话和邮箱**。
- **哪些会评**：Meta 表单（Webhook、定时补拉、失败重试）和智能导入（导入的历史线索只用规则评，不产生 AI 费用）。只在 WhatsApp 上聊天的客户没有表单，不评级，由聊天分析判断。之前已有的表单客户由页面同步和定时任务逐批用规则补评。
- **在哪看**：客户列表姓名旁的 A/B/C/D（鼠标停留看理由），筛选栏「全部表单等级」，客户档案标题下的「表单评级」。
- **提醒发给谁**：新表单推给所有管理员；分配后推给负责人（带首联时限）；老客户再次留资推给负责人。24 小时前的旧留资（补拉回来的）只评级不提醒。
- **可靠性**：提醒和客户在同一个数据库事务里写入「发件箱」，Webhook 返回 Meta 之后立即评级并推送；如果那一刻失败，定时任务 `/api/cron/meta-leads`（每 5 分钟）和打开着的 CRM（每 15 分钟同步）会补发，每条只发一次。

### 还在用「智能导入」？先检查实时接入

表单其实可以自动进来，不需要手动导入。按顺序检查：

1. 打开「广告与线索 → 线索接入」，点「检测连接」，看哪一项不是 ✓。
2. Meta 开发者后台：应用已「上线」（Live），Webhooks 里 Page 对象订阅了 `leadgen`，回调地址填 `https://你的域名/api/leads/webhook`，验证令牌与 `META_LEAD_WEBHOOK_SECRET` 一致。
3. 主页 Token（`META_PAGE_ACCESS_TOKEN`）有 `leads_retrieval`、`pages_manage_ads`、`pages_read_engagement`、`pages_show_list` 权限，并在 Business 设置 → 线索访问权限里给这个应用开了权限。
4. Hostinger Cron 每 5 分钟调用一次 `/api/cron/meta-leads`（见上文「部署后配置」），Webhook 漏掉的会被补回。
5. 用 Meta 的 Lead Ads 测试工具提交一条，几秒内应在「待分配」看到并响铃（测试工具的占位数据会显示为「收到 Meta 测试线索」，不建客户）。

### 修订：不同表单的问法（2026-10-15）

- **问题**：第一版规则只认「What best describes your business?」「Estimated order quantity」这类固定问法。床垫表单问的是「What type of business are you?」「How many pieces for your first order?」（答案 `50–200_pcs`），客户类型和数量都没识别出来，没有配置 DeepSeek 时几乎全部评成 C，档案里的采购类型也显示「其他」。
- **现在**：客户类型、数量、下单时间按问题的意思识别（见上面的字段映射），评级规则直接读表单答案，不依赖映射是否成功：数量是区间时按下限算（`50–200_pcs` 算 50 件），「1 个月内下单」与「已从中国进口」同样算作明确的采购计划。上面那张床垫表单（批发商 + 50–200 件 + 1 个月内下单）评为 A。
- **已有线索**：上线后第一次定时任务或管理员打开 CRM 时开始，按规则评过级的表单线索逐批（每次 100 位）重新评级，同时把档案里空着的采购类型、数量、采购计划按表单答案补上（已填写的不改）。每位只重评一次，不重复推送提醒。AI 评过的不动。
- **留资历史**：不再显示 `extras: [object Object]` 和英文的 `purchaseType`（客户类型以档案为准，表单原答案在「补充回答」里）；补充回答里不再重复整段 JSON（原文仍在下方「原始 CSV 回答」里）。
