# LVANJU BOS 架构规划

> **文档性质**：系统级架构规划与路线图，非功能开发文档。
> **当前阶段**：第一阶段（系统规划）。本文档不包含任何已实施的代码变更。
> **事实基线**：`muyuan-crm` @ 分支 `feature/bos-core-v1`，最后提交 `27aeb27`（2026-09-21）。
> **配套规范**：[PROJECT_RULES.md](../PROJECT_RULES.md) —— 所有实施必须遵守该规范。

---

## 0. 如何使用本文档

### 0.1 目标定位

`muyuan-crm` 不再作为"一个 CRM 项目"维护，而是 **LVANJU BOS（Business Operating System）** 的基础内核。当前 CRM 只是其中一个模块，未来的每一项需求都按"企业级运营操作系统"的标准评估，而不是"优化某个页面"。

### 0.2 需求受理流程（强制）

收到任何需求后，**先输出以下 7 段分析，获得确认后再写代码**：

1. **需求理解** —— 用业务语言复述，指出歧义与隐含假设
2. **对 LVANJU BOS 整体的影响** —— 属于哪个 OS，是否影响其他 OS 的边界
3. **涉及模块** —— 具体文件/服务/页面清单
4. **数据变化** —— 新增/修改的表、字段、迁移、受保护语义核对
5. **API 变化** —— 新增/修改的端点、入参出参、契约兼容性
6. **UI 变化** —— 新增/修改的页面、设计系统符合性
7. **实施计划** —— 步骤拆分、依赖顺序、验证方式、风险

### 0.3 事实与设想的区分

本文档严格区分三种状态，全文用标记标注：

| 标记 | 含义 |
|---|---|
| ✅ **已实现** | 代码中已存在并通过测试，可直接依赖 |
| 🟡 **部分实现** | 有数据结构或雏形，但缺少关键能力 |
| 🔴 **缺失** | 完全没有，需要新建 |

---

## 1. 执行摘要

**现状**：一个分层纪律良好、工程质量超出同规模项目的 CRM。约 4,450 行业务代码（app/components/lib/services），22 张表，23 个 API 路由文件，14 个测试文件 / 37 个用例，CI 在真实 MySQL 8.4 上跑全量回归。技术栈 Next.js 15 + React 19 + Prisma 6 + MySQL，严格 TypeScript、Zod 全量入参校验、业务逻辑集中在 services 层。

**已具备的能力**：客户主数据与阶段管理、跟进与任务、报价单（单行草稿）、WhatsApp 双通道收发与 AI 草稿、Meta CSV 智能导入、规则驱动的自动任务、BOS 三模块（驾驶舱/运营中心/销售工作台）只读视图。

**与目标的四个结构性差距**（这是本文最重要的结论）：

| # | 差距 | 影响 |
|---|---|---|
| **G1** | **没有 Product 实体**。产品仅以 `productInterest`/`productModel` 自由文本存在，AI 提示词里硬编码"compressed sofa"。 | Product OS 无从建立；报价单无产品依据；**AI 知识库没有事实来源，必然产生幻觉** |
| **G2** | **自动化是"拉取式"而非"事件式"**。规则硬编码在 `syncCustomerWorkflow`，靠前端轮询触发；关掉网页即停止；无 cron / queue / worker。 | 无法实现"自动欢迎、自动回复、自动派单、到点提醒"；Workflow OS 不成立 |
| **G3** | **营销数据无来源也无归因**。`LeadSource`/`Campaign`/`MarketingMetric` 表已建但无任何写入 API，渠道硬编码 `NOT_CONNECTED`；`Customer` 没有 campaignId / clickId / UTM 字段。 | Marketing OS 只有空壳；**ROI 在数据模型层面就算不出来** |
| **G4** | **AI 是"提示词直调"而非"分层系统"**。`callDeepSeek` 被两个 service 直接调用，提示词内联，无知识库、无检索、无工具调用、无成本计量、无评测。 | 无法从"生成回复草稿"升级为"AI Business Assistant" |

**三个必须先做的架构决策**（详见 §8）：① 是否引入独立 `Lead` 实体；② 数据库是否迁移到 PostgreSQL + pgvector；③ 三套并存的 UI 如何收敛。

**推荐的 V1.0 范围**（详见 §10）：不追求 8 个 OS 同时铺开，而是先完成 **"闭环入口 + 产品事实层 + 事件驱动地基 + AI 分层"** 这四件事，让后续每个 OS 都有可依赖的地基。V1.0 交付 **M0–M8 共 9 个里程碑**。

---

## 2. 当前系统结构

### 2.1 技术栈基线 ✅

| 层 | 选型 |
|---|---|
| 框架 | Next.js 15.5 App Router（Server Component 取数 + Client Component 交互） |
| 语言 | TypeScript 5.9（strict） |
| UI | React 19.1、Tailwind CSS 4、Radix Dialog、lucide-react、clsx / tailwind-merge |
| 数据 | Prisma 6.19 + **MySQL**；4 个迁移（`mysql_baseline` → `whatsapp_v2` → `sales_workbench_v3` → `bos_growth_foundation`） |
| 校验 | Zod 3（全量入参）+ React Hook Form |
| 认证 | 自研 scrypt + HMAC 签名 HttpOnly Cookie，角色 `ADMIN` / `SALES` |
| 事务 | `retryTransaction`（P2034 死锁重试）+ Customer 主键行锁串行化 |
| 图表/时间 | Recharts 3；date-fns + date-fns-tz（`Asia/Shanghai`） |
| 测试/CI | `node:test` + tsx；GitHub Actions + MySQL 8.4 service |
| 运行时 | Node ≥ 22、pnpm 11；单进程 `next start` |

### 2.2 分层架构（实际）

```
┌─────────────────────────────────────────────────────────────┐
│ 页面层  app/**/page.tsx + loading.tsx                        │
│   Server Component 取数 → 传给 Client Component              │
├─────────────────────────────────────────────────────────────┤
│ 客户端组件层  components/**                                  │
│   V3: components/workspace/*   BOS: components/bos/*         │
│   职责：展示 / 局部状态 / 轮询 / 乐观更新                     │
├─────────────────────────────────────────────────────────────┤
│ API 层  app/api/**/route.ts （23 个）                        │
│   requireUser() 鉴权 → handle() 包装 → ok() 响应信封          │
│   职责极薄：不写业务逻辑、不写 db 查询、不写 Zod 解析          │
├─────────────────────────────────────────────────────────────┤
│ 服务层  services/** （23 个文件）  ← 全部业务逻辑在此         │
│   Zod 解析 → 作用域鉴权 → 事务 → Prisma 访问                  │
├─────────────────────────────────────────────────────────────┤
│ 横切层  lib/**                                               │
│   auth / db / http / validation / time / transaction-retry   │
│   gupshup / whatsapp / bos / constants / types               │
├─────────────────────────────────────────────────────────────┤
│ 数据层  Prisma → MySQL（22 张表）                            │
└─────────────────────────────────────────────────────────────┘
```

**这个分层是资产，必须保留**：它让"加一个 OS"变成"加一批 services + 一批只读页面"，而不是重写。

### 2.3 入口地图

| 入口 | 路径 | 现状 |
|---|---|---|
| Today 销售首页 | `/` | ✅ V3（`WorkspaceShell` + `SalesDashboard`） |
| 老板驾驶舱 | `/command-center` | ✅ BOS 只读 |
| 运营中心 | `/growth` | 🟡 Lead Pool / Campaign / Channels，渠道未连接 |
| 销售工作台 | `/sales` | ✅ 三栏 Sales OS（四类队列 + 聊天 + AI 面板） |
| 客户 CRM | `/customers` | ✅ 列表 + 详情 + 批量 + 回收站 |
| WhatsApp | `/whatsapp` | ✅ 独立会话页 |
| 任务中心 | `/tasks` | ✅ V3 TaskCenter |
| 旧版工作台 | `/funnel` `/targets` `/analytics` `/settings` | 🟡 由 `app/[...path]/page.tsx` 兜底渲染旧 `Workspace` |
| 统一旧 API | `app/api/[...path]/route.ts` | 🟡 单文件承载客户/仪表盘/目标/设置/用户/webhook/Meta 导入 |
| 显式 REST | `tasks` `quotations` `reminders` `workflow-events` `workflows` `sales-workspace` `workspace-customers` | ✅ |
| BOS 只读 API | `/api/bos/{command-center,growth,sales}` | ✅ 全部只读 |
| WhatsApp API | `/api/whatsapp/{webhook,send,messages,media,read,connect,ai-reply}` | ✅ |

> **技术债提示**：`app/api/[...path]/route.ts` 是 300+ 行的单文件路由分发（`if(resource===...)` 链），随着 Order OS / Product OS 加入会迅速失控。**新功能一律不得再往这个文件里加分支**，应建显式路由目录。

### 2.4 数据模型现状（22 张表分域）

| 域 | 表 | 状态 |
|---|---|---|
| **身份** | `User`、`Setting`（单例）、`TranslationSetting`（单例） | ✅ |
| **客户主数据** | `Customer`（约 60 字段）、`FollowUp`、`StageHistory`、`CustomerIntelligence` | ✅ |
| **询盘来源** | `LeadSubmission`（留资历史，含 `eventKey` 幂等、`@@unique([customerId, ordinal])`）、`MetaImportRun` | ✅ |
| **会话** | `WhatsAppMessage`（三重幂等唯一键）、`WhatsAppReadState`、`MediaAsset` | ✅ 仅 WhatsApp 单一渠道 |
| **销售过程** | `Deal`（订单号/金额/成本/毛利/毛利额）、`Quotation`（**单行**：product/quantity/unitPrice） | 🟡 Quotation 过于简单 |
| **任务与自动化** | `Task`（`automationKey` 唯一）、`Reminder`（`@@unique([taskId,kind])`）、`WorkflowEvent`（业务节点：样品/生产/付款） | ✅ |
| **营销** | `LeadSource`、`Campaign`、`MarketingMetric`（`@@unique([campaignId,metricDate])`） | 🟡 **无写入 API、无连接器** |
| **集成** | `WhatsAppIntegration`（单例 `primary`，令牌加密） | ✅ Meta 共存 onboarding |
| **目标** | `SalesTarget` | ✅ |
| **缺失** | Product / ProductVariant / ProductPrice / Order / OrderItem / Payment / Shipment / Supplier / Inventory / Conversation / KnowledgeDocument / AIInvocation / AISuggestion / AuditLog / DomainEvent | 🔴 |

**关键观察**：`Deal` 是事实上的"订单"，但它**没有订单行、没有支付、没有发货、没有状态机**，且被业绩指标强依赖（销售额/毛利按 `Deal.dealDate`）。升级为 Order OS 时必须**增量扩展而非替换**，否则会破坏全部业绩口径。

### 2.5 外部集成现状

| 集成 | 用途 | 状态 |
|---|---|---|
| **Gupshup**（`lib/gupshup.ts`） | WhatsApp 消息发送主通道 | ✅ 收发 + 回执 + 去重 |
| **Meta WhatsApp Cloud API**（`whatsapp-connect-service.ts`） | Coexistence 嵌入式注册 / 共存连接 | ✅ 接入引导 + 令牌加密 |
| **DeepSeek**（`deepseek-customer-service.ts`） | 客户分析 + WhatsApp 回复/阶段分类 | ✅ 提示词直调，JSON 模式，temperature 0.2 |
| **LibreTranslate 兼容接口** | Meta 导入的"翻译待处理"回答 | ✅ 配置加密存储 |
| **Meta Ads / TikTok Ads / Google Analytics** | 广告花费与效果 | 🔴 无连接器 |
| **邮件 / 短信 / Web Push** | 出站提醒 | 🔴 无 |

> **⚠️ 命名与通道双重风险**：① WhatsApp 存在 **Gupshup 与 Meta 两套传输**，发送路径在 Gupshup，Meta 用于 onboarding —— 收敛策略未定义（ADR-006）。② `WorkflowEvent` 在 schema 里是**业务里程碑**（样品寄出/开始生产），不是事件总线；未来引入事件总线时**必须另起名**（建议 `DomainEvent`），否则概念冲突会造成长期误读。

### 2.6 工程质量现状 ✅

- `PROJECT_RULES.md` 六条铁律已被遵守：加性迁移、Zod 全量校验、services 集中业务逻辑、BOS 设计系统作用域隔离（`.bos` / `.v3-shell`）。
- P2034 死锁重试 + Customer 行锁串行化 + Task→Reminder 固定加锁顺序，读路径无副作用。
- CI 在真实 MySQL 上验证"老库自动 baseline 升级 + 重复初始化不覆盖 + 全量回归 + ESLint + tsc + build"。
- **已知缺口**：仓库**无 `main` 分支**；CI 只监听 `main` 与 `feature/whatsapp-webhook`，当前分支 push **不触发 CI**；无备份计划、无可观测性、限速与去重为单进程内存实现。

---

## 3. 已有模块清单（按目标 OS 归位）

| 目标 OS | 现有实现 | 成熟度 | 关键缺口 |
|---|---|---|---|
| **Customer OS** 客户中心 | `Customer` + `FollowUp` + `StageHistory` + `CustomerIntelligence` + 批量/回收站 + 去重 + `LeadSubmission` | ✅ 70% | 无标签/分群、无客户生命周期价值、无合并、无归属权转移审计 |
| **Sales OS** 销售中心 | `Task` + `Reminder` + `Quotation` + `WorkflowEvent` + V3 工作台 + BOS Sales OS | ✅ 65% | 报价单过简、无订单/合同、无销售目标下钻、无双人协作 |
| **Marketing OS** 营销中心 | `LeadSource` + `Campaign` + `MarketingMetric` + Growth 只读页 | 🟡 20% | **无连接器、无写入、无归因字段、无 ROI** |
| **Product OS** 产品中心 | 仅 `Customer.productInterest/productModel` 自由文本 | 🔴 5% | **整个域缺失** |
| **Order OS** 订单中心 | `Deal`（订单号/金额/成本/毛利）+ `Quotation` 单行 | 🟡 30% | 无订单行、无支付、无发货、无状态机、无合同/PI |
| **AI OS** 人工智能中心 | `analyzeCustomerWithDeepSeek` + `whatsapp-ai-service`（回复/阶段/任务） | 🟡 35% | **无知识库、无检索、无工具调用、无成本计量、无评测** |
| **Data OS** 数据中心 | `dashboard-service`（902 行内存聚合）+ BOS Command Center | 🟡 40% | 内存聚合、无汇总层、无自定义报表、无漏斗转化率、无 cohort |
| **Workflow OS** 自动化 | `syncCustomerWorkflow`（3 条硬编码规则）+ `recordWorkflowEvent`（3 类节点）+ `automatedTask` 幂等 | 🟡 40% | **无事件总线、无 worker、无规则配置、无出站投递** |

**结论**：Customer OS 与 Sales OS 已是可用资产；其余 6 个 OS 中，**Product OS 完全空白是最大瓶颈**——它同时卡住 Order OS（订单行需要产品）、AI OS（知识库需要事实源）、Data OS（产品维度分析）和 Sales OS（报价单）。

---

## 4. 缺失模块清单

### 4.1 完全缺失（greenfield）

| 模块 | 为什么必须先有 |
|---|---|
| **Product / ProductVariant / ProductSpec** | 型号（Y-601…）、尺寸、材料、包装、**每柜装载量**是家具外贸的核心事实 |
| **ProductPrice** | 分层价格（币种 / 客户等级 / 数量区间 / 贸易条款）—— AI 报价与报价单的唯一价格来源 |
| **KnowledgeDocument + 向量索引** | 企业知识库的载体（产品资料、报价规则、DDP/FOB 政策、客户政策） |
| **Conversation / ConversationThread** | 当前一个客户 = 一条 WhatsApp 流；多渠道（邮件/FB/独立站/IG）无法归并到同一会话视图 |
| **Order / OrderItem / Payment / Shipment** | `Deal` 无法承载订单行、支付状态、发货跟踪、PI/合同 |
| **AIInvocation / AISuggestion** | AI 调用的成本、延迟、token、置信度、人工采纳率审计 |
| **DomainEvent（事件总线 / Outbox）** | 事件驱动自动化的唯一可靠载体 |
| **AuditLog** | 企业级要求：谁改了阶段/金额/报价/归属 |
| **Supplier / InventoryItem** | 采购与库存（V1.x，不阻塞 V1.0） |
| **ConnectorCredential** | 广告平台凭据的统一加密存储（复用 `WhatsAppIntegration` 模式） |

### 4.2 部分存在需升级

| 模块 | 现状 | 升级方向 |
|---|---|---|
| `Quotation` | 单行产品 | → 多行 `QuotationItem` + 关联 `ProductVariant` + incoterm + 有效期 + 版本 + PDF |
| `Deal` | 事实订单 | → 增量扩展为 Order（保留字段与口径），或建立 Order 并双向同步 |
| `Customer`（归因） | `source` / `sourceDetail` | → `campaignId` / `clickId` / UTM 全字段 / `firstTouchAt` / `lastTouchAt` |
| `MarketingMetric` | 表结构已对（日粒度唯一） | → 加连接器写入 + 归因串联 |
| `syncCustomerWorkflow` | 3 条规则硬编码 | → 规则表驱动 + 事件触发 + worker 执行 |
| 提醒 | 仅应用内展示 | → 出站投递（邮件/WhatsApp/Web Push）+ 投递状态 |
| AI 调用 | 提示词内联在 2 个 service | → `lib/ai/` 网关 + 模型路由 + 事实注入 + 工具层 |

### 4.3 横切能力缺失（企业级）

| 能力 | 现状 | 风险 |
|---|---|---|
| 事件总线 / 后台任务 | 前端轮询 `POST /api/workflows/sync` | 关闭网页即失效，无法支撑自动化承诺 |
| 审计日志 | 无 | 无法追责，无法满足企业合规 |
| 可观测性 | 仅 `console.error` | 线上故障不可见 |
| 备份与恢复 | 无计划 | 单点数据风险 |
| 多实例一致性 | 限速/去重为进程内 Map | 扩容即失效 |
| 权限模型 | 2 角色粗粒度 | 无法支持主管/财务/运营等岗位 |
| 员工生命周期 | 只能新增，不能停用 | 离职账号仍可登录 |
| 会话安全 | 无失效机制、无密码修改/找回 | 企业安全底线 |

---

## 5. 数据流

### 5.1 当前获客闭环（含断点）🟡

```
Facebook/TikTok/独立站/展会
        │
        ├──[断点 ①]── 独立站 InquiryForm 只发 mailto，不进系统
        │
        └──[断点 ②]── 广告平台无连接器，无花费数据、无点击标识
        │
        ▼
  POST /api/leads/webhook          Meta CSV 手动导入
  （共享密钥 + 去重）                 （预览→确认→幂等）
        │                                  │
        └──────────────┬───────────────────┘
                       ▼
              Customer（stage=NEW, ownerId=默认管理员）
                       │
                       │  ✗ 无自动分配规则
                       │  ✗ 无自动欢迎消息
                       ▼
              销售手动跟进（FollowUp）──► StageHistory 记录阶段时间戳
                       │
                       ▼
              Quotation（单行草稿）──► markQuoteSent ──► 自动任务：3 天未回复催办
                       │                                  （由前端轮询触发 ⚠️）
                       ▼
              Deal（成交，多笔=复购）──► 业绩指标（按 dealDate）
                       │
                       └──► 无订单行 / 无支付 / 无发货 / 无复购提醒
```

**断点清单**：① 独立站无接入；② 广告数据无来源；③ 无自动分配；④ 无自动欢迎；⑤ 自动化靠轮询；⑥ 订单无结构；⑦ 复购无触发。

### 5.2 当前 WhatsApp 流 ✅

```
客户发消息
    │
    ▼
Gupshup webhook  (/api/whatsapp/webhook?token=...)
    │
    ├─ 双重幂等（waMessageId / providerMessageId）
    ├─ 身份归一（waId / whatsappNormalized）→ 绑定 Customer
    ├─ 写 WhatsAppMessage + raw 原文
    └─ 更新 Customer.lastInboundAt / lastWhatsAppAt
    │
    ├──► 异步：updateWhatsAppStage()  → DeepSeek 分析意图
    │         └─ shouldApplyStage()（带原话证据 + 防覆盖人工编辑）
    │
    └──► syncCustomerWorkflow()
              └─ needsReply → 自动任务「24 小时内回复」（automationKey 去重）

销售侧：
  5s 轮询拉消息 → 30s 轮询提醒 → 60s 轮询同步
  AI 草稿（最近 20 条上下文，confidence≥80 + evidence 必须原文子串）
    └─ 人工点击发送（AI 绝不自动外发）→ Gupshup 发送 → lastOutboundAt
```

**评价**：入站链路（幂等、身份归一、阶段分类、证据约束）设计扎实，是未来"自动回复"的正确基础。**缺的是出站事件与服务端触发**，以及多渠道会话抽象。

### 5.3 当前自动化流（拉取式）🟡

```
前端挂载 / 每 60 秒
      ▼
POST /api/workflows/sync  （鉴权）
      ▼
syncWorkflows(user)  ← 进程内 Map 去重，60s 节流
      ▼
按 id 排序遍历客户（顺序执行，避免锁竞争）
      ▼
syncCustomerWorkflow(customerId)
   ├─ SELECT ... FOR UPDATE（Customer 行锁，跨进程串行化）
   ├─ 快照读取（lastInboundAt / lastOutboundAt / quotedAt / nextFollowUpAt）
   ├─ 规则判定（硬编码 3 条）
   │    reply:{id}:{ts}  入站 +24h
   │    quote:{id}:{ts}  报价 +3d
   │    follow:{id}:{ts} nextFollowUpAt
   ├─ resolveRule() 关闭已失效规则（Task→Reminder 加锁顺序）
   └─ automatedTask() upsert by automationKey（幂等）
```

**核心问题**：触发源是**浏览器**。用户关掉页面，自动化就停。无法兑现"自动欢迎、自动回复、到点催办"。这是 Workflow OS 必须替换的部分，但**其中的幂等键设计、加锁顺序、tombstone 语义必须原样保留**。

### 5.4 目标数据流（事件驱动）

```
                    ┌──────────────── 接入层 ────────────────┐
  独立站 / 广告 Lead │ 统一 LeadIngestionService              │
  WhatsApp 消息      │  · 幂等（eventKey / 消息 ID）          │
  Meta CSV           │  · 归因写入（campaignId / clickId/UTM）│
  广告指标 API       │  · 自动分配 owner（规则表）            │
                    └───────────────┬────────────────────────┘
                                    ▼
                    ┌──────── DomainEvent（Outbox 表）────────┐
                    │ 同一事务内写入事件，保证不丢            │
                    └───────────────┬────────────────────────┘
                                    ▼
                    ┌──────── Worker 进程（独立于 web）────────┐
                    │  · 消费事件，幂等处理（幂等键沿用现有）  │
                    │  · 规则引擎（DB 配置，替代硬编码）      │
                    │  · 出站投递：邮件 / WhatsApp / Web Push │
                    │  · 定时扫描：SLA 超时、复购窗口、日报   │
                    └───────────────┬────────────────────────┘
                                    ▼
        ┌───────────────┬───────────────┬───────────────┐
        ▼               ▼               ▼               ▼
   Customer OS     Sales OS        AI OS          Data OS
   阶段/评分       任务/报价/订单   建议/草稿/知识   日汇总/驾驶舱
        │               │               │               │
        └───────────────┴───────────────┴───────────────┘
                                    ▼
                    全链路归因：花费 → 询盘 → 有效 → 报价 → 成交 → 复购
```

### 5.5 归因流（当前 vs 目标）

| 环节 | 当前 | 目标 |
|---|---|---|
| 点击标识 | 🔴 无 | `clickId`（fbclid/gclid）、`utm_*`、`landingPage` |
| 广告系列 | 🔴 无（`sourceDetail` 是自由文本） | `campaignId` → `Campaign` → `LeadSource` |
| 触点记录 | 🟡 仅 `LeadSubmission`（Meta CSV 导入时） | `LeadTouch` 全渠道触点，支持首触/末触 |
| 花费 | 🟡 表存在，无数据 | 连接器日粒度 upsert |
| ROI | 🔴 无法计算 | 花费 ÷ 询盘 ÷ 有效 ÷ 成交，按币种隔离 |

> **业务规则**：归因模型（首触 / 末触 / 线性）必须由业务先定，且 ROI 口径要写进 `README.md` 的指标表。**不允许先算一个数再解释口径**。

---

## 6. AI 层设计

### 6.1 现状（必须诚实评估）

| 项 | 现状 |
|---|---|
| 调用入口 | `callDeepSeek(systemPrompt, context, parse, retry)` —— 单一函数，`services/deepseek-customer-service.ts` |
| 消费者 | ① `analyzeCustomerWithDeepSeek`（客户评分/意图/下一步）② `whatsapp-ai-service`（回复草稿/阶段/任务）③ `updateWhatsAppStage` 异步阶段分类 |
| 提示词 | **内联在 service 文件中**（含"Specialize in compressed sofa, quotation, MOQ, shipping, FOB/DDP"等硬编码业务知识） |
| 输出约束 | `response_format: json_object` + Zod 解析 + 失败重试 1 次，temperature 0.2 |
| 事实来源 | **无**。全部依赖模型内部知识与提示词内文本 |
| 护栏 | confidence ≥ 80 **且** evidence 必须是客户原话的精确子串，才创建任务/改阶段 |
| 人工确认 | ✅ AI 从不自动外发；草稿需人工点击发送 |
| 知识库 | 🔴 无 |
| 工具调用 | 🔴 无（AI 不能查产品、查价格、查客户） |
| 成本/可观测 | 🔴 无（无 token 计量、无调用日志、无失败率） |
| 评测 | 🔴 无（无回归用例验证 AI 输出质量） |

**配置小瑕疵**：`process.env.DEEPSEEK_MODEL || 'deepseek-flash'` 在文件内出现两处（第 103 行配置、第 368 行响应回显），且 `.env.example` 的 `deepseek-flash` 需确认是官方可用模型名。AI 网关建立时应统一。

### 6.2 目标：LVANJU AI Business Assistant 分层

```
┌──────────────────────────────────────────────────────────────┐
│ L4 · 交互层                                                   │
│   销售工作台 AI 面板 · 驾驶舱智能摘要 · 报价助手 · 跟进邮件     │
├──────────────────────────────────────────────────────────────┤
│ L3 · 编排层（Agent / Workflow）                               │
│   · 意图识别 → 选择能力                                       │
│   · 多步任务：先查客户 → 再查产品 → 再算价 → 再生成报价        │
│   · 置信度门控 + 人工确认（沿用现有 ≥80 + evidence 规则）      │
├──────────────────────────────────────────────────────────────┤
│ L2 · 能力层（Tool Layer）—— AI 只能通过这里访问业务            │
│   getCustomerContext()  searchProducts()   getPrice()         │
│   getShippingPolicy()   searchKnowledge()  draftQuotation()   │
│   createTaskSuggestion()  summarizeConversation()              │
│   ⚠️ 全部工具带 Actor 作用域，复用 services 层，禁止绕过        │
├──────────────────────────────────────────────────────────────┤
│ L1 · 知识与事实层                                             │
│   · 结构化事实（唯一权威）：Product / ProductPrice / 政策表     │
│   · 非结构化知识：KnowledgeDocument + 向量检索（RAG）          │
│   · 上下文：Conversation 历史 + Customer 画像 + 归因           │
├──────────────────────────────────────────────────────────────┤
│ L0 · 模型网关（lib/ai/）                                      │
│   供应商无关 · 模型路由 · 超时重试 · JSON/Zod 约束             │
│   · token 与成本计量 · 调用日志（AIInvocation）· 降级策略       │
└──────────────────────────────────────────────────────────────┘
```

### 6.3 知识与事实来源（防幻觉的核心）

**铁律：价格、MOQ、交期、包装、柜量必须来自数据库，不得来自模型记忆。**

| 问题类型 | 唯一事实来源 | 检索方式 |
|---|---|---|
| 产品型号/尺寸/材料/包装 | `Product` / `ProductVariant` / `ProductSpec` | 结构化查询（精确） |
| 价格 / 折扣 | `ProductPrice`（币种 + 客户等级 + 数量区间 + incoterm） | 结构化查询 + 确定性计算 |
| MOQ / 交期 | `Product` 字段 | 结构化查询 |
| 报价规则 / 贸易条款 / 客户政策 | `KnowledgeDocument`（业务文档） | 向量 + 关键词混合检索 |
| 产品卖点 / 话术 / 认证 | `KnowledgeDocument`（产品资料） | 向量检索 |

**检索策略**：先结构化（精确、可信），后向量（补充、需标注来源）。回答必须携带 `sourceId`，无来源时明确回答"需要确认"，**不允许编造**。这条与现有 `PROJECT_RULES.md` §3.5「不得伪造数据」一脉相承。

### 6.4 工具调用与权限

AI 的工具函数签名与 service 一致，**强制携带 `Actor`**：

```ts
// 目标形态（示意）
export async function getPrice(
  input: { variantId: string; quantity: number; currency: string; incoterm: string; customerId: string },
  user: Actor
): Promise<PriceResult>;
```

- AI **只能读**与**只能起草**；一切写操作（发送消息、登记报价、改阶段）必须由人确认后经正常 service 落库。
- 工具调用全程记录到 `AIInvocation`，包含入参、出参、耗时、token、是否被采纳。
- 禁止 AI 直接拼接 SQL 或访问 `db`。

### 6.5 置信度与人工确认策略（分级）

| 置信度 / 风险 | 行为 |
|---|---|
| ≥ 80 且 evidence 为原文子串 | 可创建**建议**（任务草稿、阶段建议），标注 `source='AI'` |
| 60–79 | 仅展示建议，不落库 |
| < 60 | 不展示，记录用于评测 |
| **任何涉及对外发送 / 价格承诺 / 交期承诺** | **永远人工确认**（现有规则，不可放宽） |

### 6.6 成本、可观测性与评测

- `AIInvocation` 表：`provider` / `model` / `purpose` / `promptTokens` / `completionTokens` / `latencyMs` / `cost` / `confidence` / `accepted` / `customerId` / `createdAt`。
- 按用途路由模型：分类/抽取用便宜快速模型，报价/邮件生成用强模型。
- 降级：模型不可用时，WhatsApp 草稿降级为模板回复（现状 `whatsapp-stage-service` 已在无 API Key 时静默返回，需补显式降级路径）。
- 评测：为"客户评分""阶段分类""报价生成"各建一组固定样本回归用例，纳入 `pnpm test`。

### 6.7 模型与供应商策略

- **网关抽象**，不把 DeepSeek 写死在业务代码里。当前 DeepSeek 作为主力（中文理解好、成本低）；网关需支持切换与 A/B。
- 向量化模型需固定并记录版本（换模型需重建索引）。
- 所有提示词从 service 内联迁出到集中管理（例如 `lib/ai/prompts/`），便于版本化与评测。

---

## 7. 目标架构

### 7.1 架构风格：模块化单体（Modular Monolith）

**明确不建议微服务化。** 理由：

1. **团队规模**：从代码库看是极小团队（2 个种子用户角色），微服务的运维成本远大于收益。
2. **事务一致性**：客户/订单/报价/任务/自动化高度耦合，跨服务分布式事务会带来大量复杂度，而现有 P2034 重试 + 行锁方案已在单库内正确解决。
3. **现有资产**：`services/` 分层已经是"逻辑上的模块边界"，只需**强化边界纪律**，无需拆进程。
4. **唯一需要独立进程的是 Worker**（长任务、定时、出站投递），这是**一个**进程，不是一套微服务。

**演进路径**：模块化单体（现在）→ 抽出 Worker（V1.0）→ 按需抽出连接器/数据管道（V1.x）→ 只有在出现明确的独立扩缩容需求时才考虑服务拆分。

### 7.2 模块边界与依赖规则

```
允许：page → service → lib → prisma
允许：service A → service B（单向，禁止循环）
允许：worker → service（同一套 service，不重复实现业务）
禁止：route → prisma
禁止：component → prisma / component → service（客户端组件）
禁止：service → route / service → Response
禁止：跨域直接访问其他域的表（必须经对方 service）
禁止：新功能写入 app/api/[...path]/route.ts
```

**域所有权**（每个域独占自己的表）：

| 域 | 独占表 | 对外接口 |
|---|---|---|
| customer | `Customer` `FollowUp` `StageHistory` `LeadSubmission` | `customer-service` |
| conversation | `WhatsAppMessage` `WhatsAppReadState` `Conversation` | `whatsapp-message-service` |
| product | `Product` `ProductVariant` `ProductPrice` `ProductSpec` | `product-service`（新） |
| order | `Deal` `Quotation` `Order` `OrderItem` `Payment` | `quotation-service` / `order-service`（新） |
| workflow | `Task` `Reminder` `WorkflowEvent` `DomainEvent` | `task-service` / `workflow-service` |
| marketing | `LeadSource` `Campaign` `MarketingMetric` | `marketing-service`（新） |
| ai | `CustomerIntelligence` `KnowledgeDocument` `AIInvocation` `AISuggestion` | `ai-*` services |
| platform | `User` `Setting` `AuditLog` | `auth` / `settings-service` |

### 7.3 目标目录结构（增量，不重写现有）

```
muyuan-crm/
├── app/
│   ├── (bos)/                      ← 新增，BOS 模块统一路由组
│   │   ├── command-center/         （搬迁自现有）
│   │   ├── sales/                  （搬迁自现有）
│   │   ├── marketing/              ← 营销驾驶舱（升级 /growth）
│   │   ├── products/               ← 新增
│   │   ├── orders/                 ← 新增
│   │   ├── data/                   ← 新增，数据中心
│   │   ├── ai/                     ← 新增，AI 助手 / 知识库
│   │   └── workflow/               ← 新增，自动化规则与运行日志
│   ├── api/                        ← 一律显式路由，禁止再扩 catch-all
│   └── (legacy)/                   ← 旧页面逐步退场区
├── components/
│   ├── bos/                        现有 BOS 模块
│   ├── workspace/                  现有 V3 工作台
│   └── ui/bos.tsx                  设计系统原语（唯一来源）
├── services/                       现有 + 新域 service
├── lib/
│   ├── ai/                         ← 新增：网关 / 提示词 / 工具 / 检索
│   ├── events/                     ← 新增：事件定义与发布
│   └── ...                         现有横切能力
├── worker/                         ← 新增：独立进程入口
│   ├── index.ts                    消费 DomainEvent
│   ├── rules/                      规则引擎
│   └── jobs/                       定时任务（SLA / 复购 / 日报 / 汇总）
└── prisma/                         schema + migrations（加性）
```

### 7.4 数据库战略（ADR-003 的核心）

**现状**：MySQL 8.4。**目标需求**：向量检索（知识库）、更强的分析聚合、JSON 支持。

| 方案 | 优势 | 劣势 | 评估 |
|---|---|---|---|
| **A. 保持 MySQL + 外部向量库** | 零迁移风险 | 两套存储、跨库一致性、运维复杂 | 可行但长期成本高 |
| **B. 迁移 PostgreSQL 16 + pgvector** | 单库解决向量 + 分析 + JSON；`README.md` 已有迁移程序设计 | 一次性迁移风险（L3） | **推荐** |
| C. MySQL 9 + VECTOR | 保留 MySQL | 版本跨度大、生态不如 pgvector | 次选 |

**推荐 B，且必须尽早做**：当前真实数据量小（种子 40 客户 / 12 订单），**现在是迁移成本最低的时刻**；一旦 Product OS + 知识库 + 订单数据积累，迁移代价成倍上升。

迁移必须遵守 `README.md` 与 `PROJECT_RULES.md` §1 的既有约定：为新库生成**全新初始迁移**（不复用 SQLite/MySQL 迁移 SQL）、专门脚本导出/导入保留 id 与关系、Decimal 明确 `@db.Decimal` 精度、完成后跑同一套指标与接口回归。

### 7.5 运行时拓扑（V1.0）

```
┌─────────────────────┐        ┌──────────────────────────┐
│  web (next start)   │        │  worker (node)           │
│  · 页面 / Server     │        │  · 消费 DomainEvent      │
│    Component 取数    │        │  · 规则引擎 + 出站投递    │
│  · API 路由（薄）    │        │  · 定时任务（SLA/复购/   │
│  · 保留轮询兜底      │        │    日报/汇总）           │
└──────────┬──────────┘        └────────────┬─────────────┘
           │                                 │
           └────────────┬────────────────────┘
                        ▼
              PostgreSQL 16 + pgvector
              （唯一数据库，Outbox 表保证事件不丢）
```

**关键约束**：worker 与 web **共用同一套 `services/`**，不重复实现业务逻辑；worker 同样遵守作用域与事务规范。单进程内的限速/去重（登录限速、工作流合并）需替换为数据库或 Redis 实现，以支持多实例。

---

## 8. 必须先做的架构决策（ADR 清单）

> 以下决策**必须在 V1.0 编码前确认**，否则会在后期造成大范围返工。每项都需要业务方拍板。

| ID | 决策 | 选项 | 影响面 | 建议 |
|---|---|---|---|---|
| **ADR-001** | 是否引入独立 `Lead` 实体 | A. 维持现状（Customer 自首次触达即为 canonical，`stage=NEW`）<br>B. 引入 `Lead`，合格后转 `Customer` | 数据模型、询盘入口、报表口径 | **A 维持**，但增加 `LeadTouch` 记录触点。理由：现有设计与 `docs/bos/ARCHITECTURE.md` 明确"Customer 是规范记录"，B 会割裂历史数据且无业务必要性 |
| **ADR-002** | 是否引入 `Conversation` 实体 | A. 保持"一客户一会话"<br>B. 引入 `Conversation`，支持多渠道多线程 | 会话模型、WhatsApp/邮件/独立站统一 | **B**，但**延后到接入第二个渠道时**再做，避免过早抽象 |
| **ADR-003** | 数据库目标 | A. MySQL + 外部向量库<br>B. PostgreSQL 16 + pgvector | 全库迁移（L3） | **B，且放在 M1 尽早执行** |
| **ADR-004** | 三套 UI 如何收敛 | A. 维持并存<br>B. BOS 为唯一入口，旧页面退场 | 前端结构、路由、导航 | **B**，在 M2 前定退场路线，避免再叠 5 个新模块 |
| **ADR-005** | 事件总线实现 | A. Outbox 表 + 自建 worker<br>B. 引入 BullMQ/Redis<br>C. 云队列 | 自动化能力、运维复杂度 | **A 起步**（与现有 Prisma/MySQL 一致），出现吞吐瓶颈再换 B |
| **ADR-006** | WhatsApp 双通道收敛 | A. Gupshup 为唯一发送通道，Meta 仅用于注册<br>B. 逐步迁移到 Meta Cloud API 直连<br>C. 双通道并行 | 消息可靠性、成本、迁移风险 | **A 短期稳定**，M6 后评估 B；无论选哪条，**发送必须经统一出口**（现状 Gupshup 是唯一发送路径，需固化为抽象） |
| **ADR-007** | 归因模型 | 首触 / 末触 / 线性 | ROI 口径、营销决策 | 需业务定；建议**先落首触与末触两个字段**，口径后置可切换 |
| **ADR-008** | 产品定价模型 | 单一价格 / 分层（币种×客户等级×数量区间×incoterm） | Product OS、报价、AI 报价 | **分层**，家具外贸必须有数量区间价 |

---

## 9. 未来扩展路线（四阶段全景）

| 阶段 | 主题 | 覆盖 OS | 关键成果 |
|---|---|---|---|
| **V1.0** | 地基与闭环 | Customer / Sales / Product / Order / AI / Data / Workflow（基础版） | 询盘→成交闭环打通；产品事实层建立；事件驱动自动化；AI 分层可扩展 |
| **V1.x** | 深化与规模化 | + Marketing 完整 / 供应链 | 广告平台全接入、ROI 驾驶舱、库存采购、财务对账 |
| **V2.0** | 智能化 | AI OS 全面 | 自主 Agent（多步任务）、预测性评分、自动报价、智能选品建议 |
| **V3.0** | 平台化 | 全 | 对外开放 API、多组织/多品牌、移动端、生态集成 |

---

## 10. LVANJU BOS V1.0 开发路线图

### 10.1 V1.0 的定义与范围边界

**V1.0 = "闭环 + 地基"**，不是"8 个 OS 全部建成"。

判定标准（全部满足才算 V1.0 完成）：

1. 询盘可从**至少 3 个来源**（独立站 / Webhook / Meta CSV）自动进入系统，且**可归因到广告系列**
2. **产品与价格是数据库中的结构化事实**，报价单由产品明细生成，不再手写
3. 报价 → 订单 → 支付 → 发货有**结构化记录与状态**
4. 自动化由**服务端事件驱动**，关闭浏览器仍能产生提醒与任务
5. AI 具备**知识库 + 事实检索 + 工具调用**能力，报价数字全部来自数据库，且**不自动对外发送**
6. 所有新模块符合 **LVANJU BOS Design System**
7. 具备**审计日志、备份、可观测性**三项企业底线能力

### 10.2 V1.0 非目标（明确不做）

- ❌ 不拆微服务、不引入消息队列中间件、不做多租户
- ❌ 不做库存/采购/财务总账（V1.x）
- ❌ 不做 AI 自动对外发送消息（永久性业务红线，非版本限制）
- ❌ 不做移动 App（响应式已满足）
- ❌ 不做 TikTok / Google 连接器（V1.0 只接 Meta Ads，验证模式后再复制）
- ❌ 不重写现有 Customer/Sales 模块（只做增量扩展）

### 10.3 里程碑总览

| # | 里程碑 | 目标 | 预估 | 依赖 |
|---|---|---|---|---|
| **M0** | 架构决策与工程地基 | ADR 全部拍板；修 CI 触发；建 `main`；worker 骨架 | 1 周 | — |
| **M1** | 数据库战略落地 + 归因地基 | PostgreSQL + pgvector 迁移；Customer 归因字段 | 1–2 周 | M0 |
| **M2** | 闭环入口 + UI 收敛 | 统一 `LeadIngestionService`；独立站接入；旧 UI 退场路线 | 1–2 周 | M1 |
| **M3** | Product OS 基础 | 产品/型号/规格/分层价格 | 2–3 周 | M1 |
| **M4** | Order OS 基础 | Quotation 多行 → Order/OrderItem/Payment/Shipment | 3 周 | M3 |
| **M5** | AI OS 地基 + 知识库 v1 | `lib/ai/` 网关；RAG；工具层；调用审计 | 2–3 周 | M3 |
| **M6** | Workflow OS 出站化 | DomainEvent + worker + 规则表；出站提醒 | 2–3 周 | M1 |
| **M7** | Marketing OS 接入 + Data OS | Meta Ads 连接器；归因 ROI；日汇总驾驶舱 | 2–3 周 | M1 M6 |
| **M8** | 企业级治理与收口 | 审计日志；员工生命周期；备份；可观测性 | 1–2 周 | 全部 |

**关键路径**：`M0 → M1 → M3 → M4`（数据地基 → 产品 → 订单）。M5/M6/M7 可在 M3 之后部分并行。

---

### M0 · 架构决策与工程地基

**目标**：消除阻塞性工程问题，让后续每个里程碑都能安全交付。

| 项 | 内容 |
|---|---|
| **数据变化** | 无 |
| **API 变化** | 无 |
| **UI 变化** | 无 |
| **交付物** | ① ADR-001~008 结论写入 `docs/adr/`（含选项、理由、影响）② 建立 `main` 分支与合并流程 ③ 修正 `ci.yml` 触发分支（当前不监听 `feature/bos-core-v1`）④ `worker/` 骨架 + `pnpm worker` 脚本 ⑤ 确认 `DEEPSEEK_MODEL` 可用模型名 |
| **验收** | 所有分支 push 均触发 CI；worker 可空跑启动；ADR 文档齐备 |
| **风险** | ADR 决策拖延会阻塞 M1 —— 必须先拍板 |

### M1 · 数据库战略落地 + 归因地基

**目标**：把数据库换成能支撑 AI 与分析的地基，同时补上归因字段。

| 项 | 内容 |
|---|---|
| **数据变化** | ① 迁移到 PostgreSQL 16 + pgvector（**L3**，按 `README.md` 既有迁移程序：新库全新初始迁移 + 数据导出导入 + 逐字段比对）② `Customer` 加 `campaignId`、`clickId`、`utmSource/Medium/Campaign/Content/Term`、`landingPage`、`firstTouchAt`、`lastTouchAt`（**全部 nullable**）③ 新增 `LeadTouch` 触点表 ④ 新增 `AuditLog` 表 |
| **API 变化** | 无破坏性变更；`LeadIngestionService` 预留归因入参（可选字段） |
| **UI 变化** | 客户详情增加"来源与归因"区块（BOS 设计系统） |
| **验收** | 迁移后全部指标与迁移前逐项一致；`pnpm test` 全绿；CI 全绿；归因字段可通过 webhook 写入 |
| **风险** | 迁移是最高风险动作 —— 必须在数据库副本演练、必须有回滚方案、必须在业务低峰执行 |

### M2 · 闭环入口 + UI 收敛

**目标**：让询盘真正"自动进来"，并停止 UI 债务增长。

| 项 | 内容 |
|---|---|
| **数据变化** | 新增 `OwnerAssignmentRule`（分配规则表）；`LeadSubmission` 支持独立站来源 |
| **API 变化** | 新增 `POST /api/leads/site-inquiry`（签名校验 + 防刷 + UTM/clickId 透传）；新增 `POST /api/leads/ingest` 统一入口；现有 `/api/leads/webhook` 保持兼容 |
| **UI 变化** | 独立站 `InquiryForm` 改为真实提交（替换 `mailto:`）；BOS 导航重构（`components/ui/Sidebar.tsx` 的 core/tools 分组）；确定旧页面退场路线 |
| **交付物** | 统一 `services/lead-ingestion-service.ts`（所有来源走同一入口）；自动分配 owner；自动创建 NEW 客户 |
| **验收** | 独立站提交 → 系统内出现客户且带 UTM/点击标识；重复提交幂等；分配规则可配置 |
| **风险** | 独立站与 CRM 跨域 → 需定义 CORS / 签名策略 |

### M3 · Product OS 基础

**目标**：建立产品与价格的结构化事实层 —— 这是所有下游能力的前提。

| 项 | 内容 |
|---|---|
| **数据变化** | 新增 `Product`（名称/品类/材质/卖点）、`ProductVariant`（型号 Y-601、尺寸、包装、**每柜装载量**）、`ProductSpec`（规格键值）、`ProductPrice`（币种 × 客户等级 × 数量区间 × incoterm，`Decimal(14,2)`）、`ProductMedia`（复用 `MediaAsset` 模式） |
| **API 变化** | `GET/POST/PATCH /api/products`、`/api/product-variants`、`/api/product-prices` |
| **UI 变化** | 新增 `/products` 页面（列表 + 详情 + 价格矩阵），严格使用 `.bos` + `components/ui/bos.tsx` |
| **验收** | 可录入压缩沙发与智能床垫全型号；价格按数量区间/币种/条款可查；客户详情的 `productModel` 可关联到 `ProductVariant` |
| **风险** | 产品数据迁移（现有自由文本 → 结构化）需人工清洗，建议提供映射工具而非自动猜测 |

### M4 · Order OS 基础

**目标**：把报价单升级为正式单据，并建立订单与支付结构。

| 项 | 内容 |
|---|---|
| **数据变化** | ① `Quotation` 扩展：incoterm、有效期、版本、`QuotationItem` 多行（关联 `ProductVariant` + `ProductPrice`）② 新增 `Order` / `OrderItem` / `Payment` / `Shipment` ③ **`Deal` 保持不动**，通过 `OrderId` 关联；`Quotation → Order` 转化 ④ 产品单位成本接入 `Deal.productCost`（替代手工填） |
| **API 变化** | `POST /api/quotations`（多行）；`POST /api/quotations/:id/send`；`POST /api/orders`（含从报价转化）；`PATCH /api/orders/:id/payments` |
| **UI 变化** | 报价面板升级为多行明细 + PDF 导出；新增 `/orders` 订单列表与详情；客户工作台新增"订单"标签强化 |
| **验收** | 从产品生成多行报价 → 发送 → 转订单 → 登记定金/尾款 → 发货；**业绩指标口径不变**（回归测试必须通过） |
| **风险** | ⚠️ `Deal` 被全部业绩指标依赖，**必须增量扩展，禁止替换**；毛利率计算口径变化需同步 `README.md` |

### M5 · AI OS 地基 + 知识库 v1

**目标**：把"提示词直调"升级为可扩展、可审计、不幻觉的 AI 分层。

| 项 | 内容 |
|---|---|
| **数据变化** | 新增 `KnowledgeDocument`（+ 分块 + `vector` 列）、`AIInvocation`（成本/延迟/采纳审计）、`AISuggestion`（建议与人工确认状态） |
| **API 变化** | `POST /api/ai/ask`（知识问答）、`GET /api/ai/invocations`（用量）、`POST /api/knowledge/documents`（上传/索引） |
| **UI 变化** | 新增 `/ai` 助手页 + `/ai/knowledge` 知识库管理；销售工作台 AI 面板展示来源引用 |
| **交付物** | `lib/ai/` 网关（供应商无关、模型路由、超时重试、Zod 约束）；工具层（`getPrice`/`searchProducts`/`searchKnowledge`/`getCustomerContext`，全部带 `Actor`）；提示词移出 service 集中管理；评测用例纳入 `pnpm test` |
| **验收** | ① 询问"Y-601 到法国的 FOB 价"返回数据库真实价格并标注来源 ② 无知识时明确回答"需确认"，不编造 ③ AI 无法绕过 service 写数据 ④ 每次调用有成本记录 |
| **风险** | 幻觉风险最高 —— 必须坚持"结构化优先、无来源不回答、对外发送永远人工确认" |

### M6 · Workflow OS 出站化

**目标**：把自动化从"浏览器轮询"改为"服务端事件驱动"，兑现自动化承诺。

| 项 | 内容 |
|---|---|
| **数据变化** | 新增 `DomainEvent`（Outbox，含 `idempotencyKey`、`status`、`attempts`、`processedAt`）、`WorkflowRule`（规则表，替代硬编码）、`NotificationDelivery`（投递记录 + 渠道 + 状态）。⚠️ **`WorkflowEvent` 名称已被业务节点占用，事件总线必须用 `DomainEvent`** |
| **API 变化** | `GET/POST/PATCH /api/workflow-rules`；`GET /api/workflow-runs`（运行日志）；`GET /api/notifications/deliveries` |
| **UI 变化** | 新增 `/workflow` 规则配置与运行日志页（BOS 设计系统） |
| **交付物** | Outbox 写入（与业务同事务）；worker 消费（幂等沿用 `automationKey` 语义）；规则引擎（DB 配置）；出站投递（邮件 / WhatsApp / Web Push）；定时任务（SLA 超时、复购窗口、日报）；**保留现有轮询作为兜底** |
| **验收** | ① 关闭浏览器后到点仍收到提醒 ② 客户入站消息在规则时间内产生任务 ③ 事件重复投递不产生重复任务（重放测试）④ 事件不丢失（worker 崩溃恢复测试）⑤ **现有 3 条规则行为不变**（回归） |
| **风险** | ⚠️ 必须原样保留现有幂等键设计、Task→Reminder 加锁顺序、tombstone 语义，否则自动任务会重复或复活 |

### M7 · Marketing OS 接入 + Data OS

**目标**：让广告花费与成交金额真正对齐，形成 ROI。

| 项 | 内容 |
|---|---|
| **数据变化** | 新增 `ConnectorCredential`（加密存储，复用 `WhatsAppIntegration` 模式）、`DailyChannelMetric` / `DailyCustomerMetric`（汇总层）。`Campaign`/`MarketingMetric` 增加 `externalCampaignId` 稳定映射 |
| **API 变化** | `POST /api/connectors/meta-ads/sync`（手动/定时触发）；`GET /api/connectors`；`GET /api/data/overview`（汇总驾驶舱） |
| **UI 变化** | `/growth` 升级为 `/marketing` 驾驶舱（花费 → 询盘 → 有效 → 报价 → 成交 → ROI）；`/command-center` 增强；新增 `/data` 数据中心 |
| **交付物** | 连接器抽象（`MarketingConnector` 接口）+ **Meta Ads 实现**；按天 upsert（复用 `@@unique([campaignId, metricDate])`）；归因串联到 `Customer.campaignId`；日汇总任务 |
| **验收** | ① 广告花费与询盘可对齐到广告系列 ② CPL / CAC / ROI 可计算且**口径写入 `README.md`** ③ 渠道状态从 `NOT_CONNECTED` 变为真实状态 ④ 多币种不混算 |
| **风险** | 归因模型未定则 ROI 无意义（ADR-007）；Meta API 权限与汇率口径需业务确认 |

### M8 · 企业级治理与 V1.0 收口

| 项 | 内容 |
|---|---|
| **数据变化** | `User` 增加 `status` / `deactivatedAt`；`Session` 表（替代无状态 Cookie，支持强制失效）；`AuditLog` 落全量敏感操作 |
| **API 变化** | `POST /api/users/:id/deactivate`；`POST /api/auth/change-password`；`GET /api/audit-logs` |
| **UI 变化** | `/settings` 升级（员工生命周期、审计日志、集成管理） |
| **交付物** | 审计日志（阶段/金额/报价/归属变更）；员工停用与密码策略；每日自动备份 + 恢复演练；结构化日志 + 错误上报 + `/api/health`；分布式限速与幂等（替换进程内 Map） |
| **验收** | ① 敏感操作可追溯到人 ② 离职账号立即失效 ③ 备份可成功恢复 ④ 健康检查与错误上报可用 ⑤ 多实例下登录限速与去重仍生效 |
| **风险** | 备份恢复演练必须在隔离环境做，禁止在生产库试 |

### 10.4 依赖顺序

```
M0 决策
 └─► M1 数据库+归因
      ├─► M2 入口+UI收敛 ──────────────┐
      ├─► M3 Product OS ──┬─► M4 Order OS
      │                   └─► M5 AI OS + 知识库
      └─► M6 Workflow 出站化 ──► M7 Marketing + Data
                                        └─► M8 治理收口
```

### 10.5 V1.0 验收标准（DoD）

- [ ] 3 个以上询盘来源自动接入，且可归因到广告系列
- [ ] 产品与价格为结构化事实，报价单由产品生成
- [ ] 报价 → 订单 → 支付 → 发货全链路可追溯
- [ ] 关闭浏览器后自动化仍运行（提醒、任务、SLA）
- [ ] AI 报价数字 100% 来自数据库，且无来源时明确说"需确认"
- [ ] 新模块全部符合 BOS Design System（`.bos` 作用域 + `components/ui/bos.tsx`）
- [ ] 审计日志 / 备份 / 可观测性三项就绪
- [ ] `pnpm test`、`lint`、`tsc --noEmit`、`pnpm build` 全绿，CI 在真实 MySQL/PostgreSQL 上通过
- [ ] 全部迁移为加性且已在数据库副本演练
- [ ] 文档同步：`README.md` 指标口径、`docs/` 架构、`PROJECT_RULES.md` 规范

---

## 11. 风险登记册与技术债

| # | 风险 / 债务 | 等级 | 影响 | 应对 |
|---|---|---|---|---|
| R1 | **产品事实层缺失导致 AI 必然幻觉** | 🔴 高 | AI 报价错误 → 商业损失 | M3 先建产品与价格，M5 才开放 AI 报价；无来源不回答 |
| R2 | **`Deal` 被全部业绩指标依赖** | 🔴 高 | Order OS 改造会破坏报表 | 增量扩展 + 保留字段 + 回归测试锁定口径 |
| R3 | **数据库迁移（L3）** | 🔴 高 | 数据丢失 / 停机 | 副本演练 + 回滚方案 + 低峰执行 + 逐字段比对 |
| R4 | **自动化替换导致任务重复/复活** | 🔴 高 | 销售被重复任务淹没 | 保留 `automationKey` 幂等 + tombstone + 加锁顺序；重放测试 |
| R5 | **三套 UI 并存** | 🟡 中 | 维护成本指数增长 | M2 前定退场路线（ADR-004） |
| R6 | **无 `main` 分支、CI 不触发当前分支** | 🟡 中 | 缺陷可能未被发现 | M0 修复 |
| R7 | **`app/api/[...path]/route.ts` 单文件分发** | 🟡 中 | 随模块增加失控 | 禁止新增分支，新路由独立文件 |
| R8 | **`WorkflowEvent` 命名冲突** | 🟡 中 | 概念混淆导致误改 | 事件总线命名 `DomainEvent` |
| R9 | **限速/去重为进程内实现** | 🟡 中 | 多实例失效 | M8 替换为持久化实现 |
| R10 | **内存聚合（`dashboard-service` 902 行）** | 🟡 中 | 数据量增长后性能塌陷 | M7 建汇总层 + 数据库聚合 |
| R11 | **`DEEPSEEK_MODEL=deepseek-flash` 未验证** | 🟡 中 | 线上 AI 调用失败 | M0 确认；网关做模型校验与降级 |
| R12 | **无备份 / 无可观测性** | 🟡 中 | 故障不可恢复、不可见 | M8 |
| R13 | **产品数据需从自由文本清洗** | 🟡 中 | 迁移质量不可控 | 提供人工映射工具，禁止自动猜测 |
| R14 | **文档滞后**（`README.md` 仍描述 SQLite / V1 边界） | 🟢 低 | 误导后续开发 | 每里程碑同步文档 |

---

## 12. 附录

### 12.1 模块 → OS 归属总表

| OS | 现有表 | 新增表（V1.0） | 新增页面 |
|---|---|---|---|
| Customer OS | `Customer` `FollowUp` `StageHistory` `LeadSubmission` `CustomerIntelligence` | `LeadTouch` | 客户详情增强（归因区块） |
| Sales OS | `Task` `Reminder` `Quotation` `WorkflowEvent` `Deal` | `QuotationItem` | `/sales` 增强 |
| Marketing OS | `LeadSource` `Campaign` `MarketingMetric` | `ConnectorCredential` | `/marketing` |
| Product OS | — | `Product` `ProductVariant` `ProductSpec` `ProductPrice` `ProductMedia` | `/products` |
| Order OS | `Deal` `Quotation` | `Order` `OrderItem` `Payment` `Shipment` | `/orders` |
| AI OS | `CustomerIntelligence` | `KnowledgeDocument` `AIInvocation` `AISuggestion` | `/ai` `/ai/knowledge` |
| Data OS | — | `DailyChannelMetric` `DailyCustomerMetric` | `/data` |
| Workflow OS | `Task` `Reminder` `WorkflowEvent` | `DomainEvent` `WorkflowRule` `NotificationDelivery` | `/workflow` |
| 平台 | `User` `Setting` `WhatsAppIntegration` `TranslationSetting` | `AuditLog` `Session` | `/settings` 增强 |

### 12.2 环境变量盘点（V1.0 预计新增）

| 现状 | V1.0 新增（预计） |
|---|---|
| `DATABASE_URL` `AUTH_SECRET` `WEBHOOK_SECRET` `SEED_ADMIN_PASSWORD` `NEXT_PUBLIC_APP_NAME` `DEFAULT_TIMEZONE` `DEFAULT_CURRENCY` | `WORKER_CONCURRENCY` `WORKER_POLL_INTERVAL` |
| `DEEPSEEK_API_KEY` `DEEPSEEK_BASE_URL` `DEEPSEEK_MODEL` | `AI_CLASSIFY_MODEL` `AI_GENERATE_MODEL` `AI_EMBEDDING_MODEL` |
| `META_APP_ID` `META_APP_SECRET` `META_EMBEDDED_SIGNUP_CONFIG_ID` `META_GRAPH_VERSION` `WHATSAPP_VERIFY_TOKEN` `WHATSAPP_DEFAULT_OWNER_EMAIL` `WHATSAPP_PREFERRED_PHONE_NUMBER_ID` | `META_ADS_ACCESS_TOKEN`（或经 `ConnectorCredential` 存储） |
| `GUPSHUP_API_KEY` `GUPSHUP_SOURCE` `GUPSHUP_APP_NAME` `GUPSHUP_WEBHOOK_SECRET` | `SITE_INQUIRY_SECRET`（独立站签名） |
| `PUBLIC_APP_URL` `MEDIA_STORAGE_DIR` | `SMTP_*` 或邮件服务凭据；`SENTRY_DSN`（可观测性） |

### 12.3 下一步

本文档为第一阶段（系统规划）交付物。**在 ADR-001 ~ ADR-008 获得业务确认之前，不开始任何功能开发。**

确认后按 M0 起步，每个里程碑开工前须按 §0.2 的 7 段格式提交需求分析，并严格遵守 [PROJECT_RULES.md](../PROJECT_RULES.md)。
