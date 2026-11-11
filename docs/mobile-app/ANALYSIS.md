# LVANJU BOS 移动端 · 第一步：现有系统分析

> 分析基线：`main` @ `6b47297`（2026-11-10）。所有结论来自代码，文件路径可直接打开核对。
> 本文按 [PROJECT_RULES.md](../../PROJECT_RULES.md) §0.5.2 的要求，先分析、后设计；本次只交付设计与原型，**没有改动任何生产代码、数据库或接口**。

---

## 1. 技术框架

| 层 | 现状 | 对移动端的意义 |
| --- | --- | --- |
| 前端 | Next.js 15 App Router + React 19 + TypeScript strict，Tailwind 4、Radix Dialog、`lucide-react@0.468`、Recharts 3 | 原生 App 不复用 React 组件，但复用**同一套图标（Lucide 0.468）**、色值和文案 |
| 样式 | `app/bos.css`（`.bos` 作用域 token）、`app/bos-v2.css`、`app/mobile-shell.css`、`app/mobile-lists.css`、`app/workspace-v3.css` | 品牌绿 `#164b3a`、焦点 `#498b73`、警示 `#85521b / #faf1e6`、错误 `#a44b36` 已是事实标准，移动端沿用 |
| 后端 | `app/api/**/route.ts`（135 个路由文件）→ `services/**`（业务逻辑、Zod 校验、权限作用域）→ Prisma 6 → MySQL | Android 与 HarmonyOS **共用这套 API 和业务规则**，客户端不重写业务判断 |
| 数据 | 85 个 Prisma 模型、30 个迁移，只允许加性变更（PROJECT_RULES §1） | 移动端需要的新能力都按「加表 / 加可空列」设计，见 [NATIVE_PLAN.md](NATIVE_PLAN.md) |
| 认证 | 自研 scrypt + HMAC 签名会话 Cookie `crm_session`（HttpOnly、SameSite=Lax、HTTPS 下 Secure、7 天），角色 `ADMIN` / `SALES`，`sessionVersion` 用于让旧会话失效 | 原生客户端可以直接用 Cookie 会话（V1 不改接口） |
| 防跨站 | `middleware.ts`：API 写操作检查 `Origin` / `Sec-Fetch-Site` | 原生 HTTP 客户端默认不带 `Origin`，可以通过；需在联调时实测 |
| 推送 | Web Push（`web-push`，VAPID，`PushSubscription` 表，`services/push-service.ts`），`LeadAlert` 发件箱，`public/sw.js` | **只覆盖浏览器 / PWA**。原生 App 需要新增设备令牌与厂商通道 |
| 手机现状 | 已是 PWA（`app/manifest.ts`），≤760px 有底部导航、卡片式客户列表（2026-11-10 起，`components/ui/MobileNav.tsx`） | 证明销售确实在手机上用；但仍是网页布局，订单、任务、看板在手机上是电脑版缩小 |
| 测试 / CI | `node:test` 69 个测试文件，CI 在 MySQL 8.4 与 MariaDB 11.8 上跑迁移、测试、lint、tsc、build | 原型放在 `prototypes/`，已加入 ESLint 忽略，不进入 Next 构建 |

## 2. 页面、模块与导航

导航定义在 `lib/role-workspace.ts`，侧边栏和手机底栏共用。

**管理员（`adminSections`）**

| 分区 | 页签（路由） |
| --- | --- |
| 工作台 | 工作日历 `/workbench`、话术效果 `/outreach`、话术库、人工复核 |
| 经营总览 | 驾驶舱 `/command-center`、来源与国家、财务 `/finance`、客户分析、消息分析、国家作战卡、AI 计划 |
| 客户 | 新客户 `/customers`、旧客户、跟进队列 `/sales`、销售看板 `/crm` |
| 消息 | `/messages`（WhatsApp 会话、翻译、优化话术、常用回复、标签、待处理） |
| 任务 | `/tasks` |
| 订单 | 订单 `/orders`、产品库、报价单 `/products/quotes`、运费库、资料文件、利润 |
| 广告与线索 | 广告效果、会话质量、丢单原因、数据质量、线索接入 |
| 团队 | 销售业绩 `/team`、目标、沟通监督 |
| 设置 | 公司设置、集成与接入 |

**销售（`salesSections`）**：今日工作（`/sales` 今日跟进 / 全部待办）、消息、话术、我的客户、产品与报价、我的订单、我的业绩。

**现有手机底栏（PWA）**：管理员「今日 · 消息 · 客户 · 数据 · 更多」，销售「今日 · 消息 · 客户 · 报价 · 更多」。

## 3. 核心业务逻辑（移动端必须遵守的规则）

| 领域 | 规则（来源） |
| --- | --- |
| 客户阶段 | 13 个阶段：新线索 → 已联系 → 已回复 → 已发目录 → 已确认需求 → 已确认款式 → 已报价 → 跟进中 → 确认采购 → 已成交；结束：暂不需要 / 已流失 / 无效客户（`lib/constants.ts`）。**暂不需要、已流失、无效必须填原因**（`reasonRequiredStages`） |
| 有效客户 | 进入「已回复」到「确认采购」任一阶段自动记为有效（`QUALIFYING_STAGES`）；有效 = 我们发出第一条后客户回复 |
| 线索等级 | A/B/C/D（`lib/lead-grade.ts`）：DeepSeek 评级，规则兜底；决定响铃方式 A/B 持续响铃、C 响一次、D 不打扰 |
| 待分配与首联 | 自动线索可进入待分配池（`pendingAssignment`）；24 小时内的广告留资分配后须在 `adLeadFirstContactMinutes`（默认 5 分钟）内首联，其他按 `firstContactHours` |
| 工作队列 | 待首联 / 今日跟进 / 等我回复 / 高意向（`services/bos-sales-service.ts` `queueFilters`），顶栏、侧栏、列表共用同一定义 |
| 订单 | 一笔成交（Deal）对应一张订单；七段流程 下单→付款→生产→发货→运输→清关→收货；主状态 6 个，另有付款 / 生产 / 发货三个细项（`lib/order-status.ts`）。**只有管理员能取消订单**，取消会作废关联成交 |
| 报价 | 多行报价单（`QuotationItem`），状态 `DRAFT` / `SENT`；登记发送后不可修改；单价来源 LIST / LAST_QUOTE / MANUAL，保留价格表建议价 `listPrice` |
| 任务 | 来源 CRM / 自动跟进 / 订单 / 财务 / 广告 / AI / 手动；优先级 高 / 中 / 低；`Reminder` 到期前（EARLY）与逾期（OVERDUE）各提醒一次 |
| 业绩口径 | 销售额与毛利按 `Deal.dealDate`；询盘与转化按 `Customer.inquiryAt`；**不同币种分别统计、不折算**（`lib/metrics.ts`） |
| 数据诚信 | 未知显示「—」；价格、MOQ、交期必须来自数据库；**AI 绝不自动对外发送消息**（PROJECT_RULES §0.5.4） |

## 4. 角色与权限

| 能力 | 管理员 | 销售 | 依据 |
| --- | --- | --- | --- |
| 客户范围 | 全部 | 自己负责的 | `lib/auth.ts` `scope()` |
| 待分配池、分配 / 转交 | ✓ | — | `assignCustomers` |
| 财务（收入、成本、毛利、广告花费） | ✓ | — | `finance-service.ts` `requireAdmin` |
| 驾驶舱毛利 | ✓ | 返回 `null` | `business-cockpit-service.ts` |
| 销售排行 | 全员 | 只看自己 | `sales-team-service.ts` |
| 取消订单、更正 / 作废成交 | ✓ | — | `order-service.ts`、`customer-service.ts` |
| 移入回收站 | ✓ | — | `deleteCustomer` / batch |

原型严格按上表区分两种身份（控制台可切换）。

## 5. 与移动端相关的接口

所有接口返回 `{ success: true, data }`，错误 `{ success: false, error }`（`lib/http.ts`），入参经 Zod 校验。

| 移动端页面 | 现有接口 |
| --- | --- |
| 登录 / 退出 / 改密码 | `POST /api/auth/login`、`/api/auth/logout`、`/api/auth/password` |
| 工作台 | `GET /api/notifications`（计数）、`/api/bos/sales`（今日队列）、驾驶舱 `business-cockpit-service`、`/api/tasks?view=TODAY`、`/api/orders`（提醒计数） |
| 客户列表 / 详情 | `GET /api/customers`、`GET /api/customers/:id`、`POST /api/customers` 新建、`PUT /api/customers/:id`、`POST /api/customers/:id/followups`、`POST /api/customers/assign`、`/api/bos/crm-stage`（改阶段）、`/api/inbox/customer-tags` |
| 订单 | `GET /api/orders`、`GET /api/orders/:id`、`PATCH /api/orders/:id`（主状态）、`POST /api/orders/:id/cancel` |
| 报价 | 多行报价单 `GET /api/quotes`、`GET /api/quotes/:id`（`itemized-quote-service.ts`）；旧单行报价 `GET /api/quotations` |
| 消息 / 会话 | `GET /api/notifications`；`/api/inbox/conversations`、`/api/inbox/thread`、`POST /api/whatsapp/send`、`/api/inbox/translate`、`/api/inbox/polish`、`/api/quick-replies` |
| 任务 | `GET/POST /api/tasks`、`PATCH/DELETE /api/tasks/:id`、`POST /api/tasks/:id/complete` |
| 数据 / 财务 | 驾驶舱与财务服务（页面直连 service，**目前没有独立 GET 接口**，需要加只读路由）、`/api/sales-team/performance` |
| 推送 | `/api/push`（Web Push 订阅，仅浏览器） |

## 6. 品牌与设计规范

- Logo：`public/brand/lvanju-logo.jpg`，白色字标「LVANJU 绿安居」，A 字中有房屋窗格，底色 `#2E534B`。
- 品牌绿：`--bos-green #164b3a`（v2 为 `#174b3b`）；画布 `#f5f5f7` / `#f7f7f2` / `#F7F8F6` 三套并存。
- 字体：BOS `-apple-system, SF Pro`；V3 `Inter`。字号档位 36 / 20 / 15 / 14 / 13 / 11。
- 图标：`lucide-react`，侧边栏 `size 18 strokeWidth 1.6~1.7`。
- 客户标签 8 色（`lib/customer-tags.ts`），对比度 ≥ 4.5:1。
- 动效：`.16s`，按压 `scale(.98)`，尊重 `prefers-reduced-motion`。

移动端在此基础上统一为一套 token（[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)）：画布取三套之间的偏绿浅灰 `#F5F6F2`，品牌绿、焦点、警示、错误色值与 PC 一致。

## 7. 需求与现状对照（不凭空假设功能）

| 需求 | 现状 | 原型处理 |
| --- | --- | --- |
| 今日新增 / 待跟进 / 待处理订单 / 今日业绩 / 趋势 | ✅ 全部有数据来源 | 实现 |
| 客户列表、搜索、筛选、来源、国家、标签、阶段 | ✅ | 实现 |
| 一键拨号、WhatsApp | ✅ BOS 会话可发送；手机 WhatsApp 发的消息可同步回 BOS | 实现：默认在 BOS 会话中回复（留痕），可选打开 WhatsApp App |
| 添加跟进、设置回访 | ✅ `FollowUp.nextFollowUpAt`、`Customer.nextFollowUpAt` | 实现 |
| 订单列表 / 详情 / 状态 / 付款 / 生产发货进度 | ✅ | 实现；**订单只有一个产品行**（来自成交），逐行明细在报价单 |
| 报价单 | ✅ 多行报价 | 手机端查看、转发、登记发送；逐行编辑留在电脑端 |
| 订单审批 | 🔴 不存在 | **2026-11-11 确认不做**，原型已删除 |
| 通知：新询盘、跟进提醒、首联超时、再次留资 | ✅ `notificationFeed` | 实现 |
| 通知：**新订单、付款、系统公告** | 🔴 没有这些通知种类（今日简报 ✅ 已有推送） | 标「新增通知」 |
| 已读 / 未读、批量已读 | 🟡 只在浏览器本地记住「已提示过」，服务端无已读状态 | 实现交互；后端需新增已读表 |
| 铃声、振动、重要消息偏好 | 🟡 响铃方式由线索等级决定，没有个人设置 | 实现设置页；后端需新增偏好表 |
| 系统推送 | 🟡 只有 Web Push | 原型模拟系统通知外观；原生推送方案见 NATIVE_PLAN |
| 回款情况 | 🟡 只有付款状态（未付 / 定金 / 付清），没有收款金额 | 2026-11-11 确认不加收款记录：按订单付款状态统计单数 |
| 转化率、销售排行、业务趋势 | ✅ | 实现，权限与 PC 一致 |
| 账号安全 | 🟡 改密码 ✅；登录设备列表、单设备退出 ❌ | 改密码实现；设备管理标「规划」 |
| 语言设置 | 🔴 只有中文界面（报价单支持英文） | 2026-11-11 确认不需要英文界面，App 内去掉语言设置 |
| 离线查看客户 | 🔴 PWA 不在手机上保存任何客户数据 | 2026-11-11 确认允许离线查看最近客户：原型已实现只读离线 + 离线跟进补发，方案见 NATIVE_PLAN §3.1 |
| 主题设置 / 深色模式 | 🔴 PC 无深色 | 原型完整支持浅色 / 深色 / 跟随系统 |
| 生物识别解锁 | 🔴 | 标「规划」，仅本机验证 |
