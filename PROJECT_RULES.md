# LVANJU CRM 开发规范 · PROJECT_RULES.md

> 适用对象：所有参与 `muyuan-crm`（LVANJU BUSINESS OS）开发的人与 AI Agent。
> 本规范不是通用建议，而是从当前代码库既有约定中提炼的**强制约束**。与既有代码冲突时，以本规范为准并同步修正代码。
>
> 前置阅读：[README.md](README.md) · [docs/bos/ARCHITECTURE.md](docs/bos/ARCHITECTURE.md) · [docs/SALES-WORKSPACE-V3.md](docs/SALES-WORKSPACE-V3.md) · [docs/PRISMA-DEADLOCK-FIX.md](docs/PRISMA-DEADLOCK-FIX.md)

---

## 0. 六条铁律速查

| # | 规则 | 一句话执行标准 |
|---|---|---|
| 1 | **不破坏现有数据库结构** | 只允许加性变更；不改列、不改类型、不删表、不删数据 |
| 2 | **新增功能必须走 Prisma migration** | 改 `schema.prisma` + `prisma migrate dev --name xxx`，禁止 `db push` |
| 3 | **保持 BOS Apple Design System** | 只用 `components/ui/bos.tsx` 原语与 `app/bos.css` 既有 token |
| 4 | **所有 API 必须经 Zod 验证** | 每个入参（body / query / params）都有 schema，在 service 内 `.parse()` |
| 5 | **业务逻辑必须放 services 层** | `route.ts` 只做鉴权 + 转发；禁止在路由或组件里写 Prisma 查询 |
| 6 | **改代码前先分析影响范围** | 先列出受影响的调用方/页面/测试，再动手（模板见附录 A） |

违反任一条的改动，一律视为未完成，不得提交。

---

## 0.5 需求受理流程（强制）

### 0.5.1 项目定位

`muyuan-crm` 是 **LVANJU BOS（Business Operating System）** 的内核，不是普通 CRM。任何需求都按"企业级运营操作系统"的标准评估，而不是"优化某个页面"。目标架构与路线图见 [docs/LVANJU_BOS_ARCHITECTURE.md](docs/LVANJU_BOS_ARCHITECTURE.md)。

### 0.5.2 先分析，后编码

**收到任何需求，不得立即写代码。** 必须先输出以下 7 段分析并获得确认：

| # | 段落 | 要求 |
|---|---|---|
| 1 | **需求理解** | 用业务语言复述；主动指出歧义与隐含假设，不自行脑补 |
| 2 | **对 LVANJU BOS 整体的影响** | 属于哪个 OS；是否改变其他 OS 的边界或契约 |
| 3 | **涉及模块** | 具体文件 / service / 页面清单（用 grep 实证，不凭印象） |
| 4 | **数据变化** | 新增或修改的表、字段、迁移；逐条核对 §1.1 受保护语义 |
| 5 | **API 变化** | 端点、入参出参、契约兼容性；是否破坏 `{success,data}` 信封 |
| 6 | **UI 变化** | 页面影响范围；是否符合 BOS Design System（§3） |
| 7 | **实施计划** | 步骤拆分、依赖顺序、验证方式、风险与回滚 |

确认后才能进入编码。**不确认就动手，等同于违反本规范。**

### 0.5.3 禁止事项

- ❌ 不分析就写代码，或"边写边想"
- ❌ 直接修改生产逻辑而不评估影响（见 §6 影响范围分级）
- ❌ 在需求不明确时自行假设业务规则（价格、MOQ、归因口径、权限边界等必须问清）
- ❌ 越过 §1–§5 的任何约束走"临时方案"，事后再补

### 0.5.4 业务红线（永久有效，不随版本放宽）

- **AI 绝不自动对外发送消息**；一切对外内容必须人工点击发送。
- **价格、MOQ、交期、包装、柜量必须来自数据库**，不得由模型生成或编造。
- **不得伪造数据**：未知值显示 `—`，未接入渠道标注 `NOT_CONNECTED`。
- **不得破坏业绩口径**：销售额与毛利按 `Deal.dealDate`，客户转化按询盘日期归属；口径变更必须同步文档。

---

## 1. 不破坏现有数据库结构

### 1.1 生产库现状（必须视为不可逆的事实）

- 数据库为 **MySQL**（`provider = "mysql"`），基线迁移 `20260918000000_mysql_baseline` 之前的历史在 `prisma/legacy-sqlite-migrations/`，**仅供存档，永不执行**。
- 生产启动链路 `scripts/production-init.mjs` 会自动探测无迁移历史的老库并登记 baseline，然后 `prisma migrate deploy`。**任何会让这一步失败的改动都是阻断级事故。**
- 已存在 22 张表，其中若干**单向语义**的约束被业务逻辑依赖，改动前必须逐一确认：

| 约束 / 字段 | 载荷语义，禁止破坏 |
|---|---|
| `automationKey` UNIQUE | 自动任务去重的唯一依据，重复即产生重复待办 |
| `waMessageId` / `requestId` / `providerMessageId` UNIQUE | WhatsApp 幂等键，破坏即重复入站 |
| `LeadSubmission.eventKey` UNIQUE、`@@unique([customerId, ordinal])` | Meta 导入幂等 + 留资次数编号 |
| `MarketingMetric @@unique([campaignId, metricDate])` | 日粒度 upsert 的唯一键 |
| `Reminder @@unique([taskId, kind])` | 同一任务 EARLY/OVERDUE 唯一 |
| `MediaAsset.storageKey` UNIQUE | 附件存储定位 |
| `Setting.id = 'system'`、`WhatsAppIntegration.id = 'primary'`、`TranslationSetting.id = 'meta'` | 单例行，**id 值不可更改** |
| `Customer.deletedAt` / `Task.deletedAt` | 软删除标记，业务列表默认过滤 |
| `Customer.inquiryAt` vs `Deal.dealDate` | 询盘日期用于归属统计，成交日期用于业绩统计，**不可混用** |
| `WhatsAppMessage.content` → `@map("text")` | 列名映射，改 schema 字段名时不要动 `@map` |
| `stage` / `source` / `purchaseType` 等 String 字段 | 值域由 `lib/constants.ts` 映射中文标签，**新增枚举值必须同步 UI 与指标口径** |

### 1.2 允许 / 禁止的操作

**允许（加性、向后兼容）**
- 新增表、新增列（**必须 nullable 或带 default**）
- 新增索引、新增外键、新增唯一约束（需先确认历史数据不冲突）
- 新增可选关系

**禁止**
- ❌ 修改已有列的类型、长度、字符集、是否可空
- ❌ 重命名或删除已有列 / 表
- ❌ 直接删除、覆盖、迁移生产数据；用 `deletedAt` 软删除代替
- ❌ 改写**已经执行过**的 `prisma/migrations/*/migration.sql`
- ❌ `prisma db push`、`prisma migrate reset`、`DROP` / `TRUNCATE` / 无条件 `UPDATE` 生产库
- ❌ 在没有备份确认的情况下运行 `scripts/smoke.ts` / `batch-smoke.ts` / `meta-smoke.ts`（这些会写入验收数据，**只能对数据库副本运行**）

### 1.3 必须做回填时的顺序

拆成**三个独立迁移**，每步都可单独回滚/验证，不允许一个迁移里既加列又改数据语义：

1. 迁移 A：加 nullable 新列（+ 索引）
2. 迁移 B：幂等回填（`scripts/` 下写一次性脚本，可重复执行）
3. 迁移 C：需要时再加约束/非空（确认 B 已全量成功后）

### 1.4 验证方式

```sh
# 结构变更必须在数据库副本上验证
export DATABASE_URL="mysql://.../<数据库副本>"
pnpm exec prisma migrate deploy && pnpm exec prisma generate
pnpm exec prisma validate
pnpm test
```

---

## 2. 所有新增功能必须使用 Prisma migration

### 2.1 标准流程

```sh
# 1) 先改 prisma/schema.prisma
# 2) 生成迁移（迁移名用 snake_case，描述业务含义）
pnpm exec prisma migrate dev --name add_customer_tag
# 3) 生成客户端
pnpm exec prisma generate
# 4) 跑测试
pnpm test
```

**命名约定**：与现有 4 个迁移保持同一风格 —— `20260921090000_bos_growth_foundation`，即 `功能域_用途`，禁止 `update` / `fix` / `changes` 这类无信息量命名。

### 2.2 硬性要求

- **每个改动 `schema.prisma` 的提交，必须同时包含对应的 `prisma/migrations/<时间戳>_<名称>/migration.sql`**。两者不一致视为未完成。
- 迁移文件**由 Prisma 生成**，可以人工审阅，但**不允许手写整份 SQL**（除一次性回填脚本）。
- 新增金额字段统一 `Decimal @db.Decimal(14, 2)`；**禁止用 Float 表示金额**。业务代码中用 `Prisma.Decimal` 运算（参考 `services/customer-service.ts` 的 `addDeal`）。
- 新增常用筛选字段必须建索引（参考 `Customer` 上的 `@@index` 清单）。
- 新增枚举语义优先用 `String` + 应用层 `z.enum`（与现状一致），**不要**引入数据库原生 enum，避免与既有 String 列风格分裂。
- 迁移必须**可在已有生产数据的库上直接 deploy**：不允许 `NOT NULL` 无默认值的新列、不允许依赖空表假设。

### 2.3 部署链路不变式

`pnpm build` / `pnpm start` 都会先跑 `scripts/production-init.mjs`（自动 baseline → `migrate deploy` → upsert admin/Setting）。新迁移必须能通过这条链路，**不要新增必须人工执行的手工步骤**；确实需要人工介入的，写进 `docs/` 并在提交说明中显著标注。

---

## 3. 保持 BOS Apple Design System 风格

### 3.1 两套作用域，不要串味

| 作用域 | 样式文件 | 用途 | 根 class |
|---|---|---|---|
| **BOS**（`/command-center`、`/growth`、`/sales`） | `app/bos.css` | 老板驾驶舱 / 运营中心 / 销售工作台 | `.bos` |
| **V3 Workspace**（`/`、客户详情、任务中心、WhatsApp） | `app/workspace-v3.css` | Sales Workspace V3 | `.v3-shell` |
| 旧版页面（漏斗/目标/分析/设置） | `app/globals.css` | 仅维护，不新增功能 | — |

**BOS 新模块必须使用 `.bos` 作用域**，不得引入 `.v3-*` class 作为新代码的基础（现有 `.bos-sales-*` 对 `.v3-*` 的复用是历史特例，不要扩大）。

### 3.2 BOS token（唯一可用色值来源）

```css
.bos{
  --bos-primary:#1d1d1f;  --bos-secondary:#86868b;
  --bos-bg:#f5f5f7;       --bos-card:#fff;
  --bos-green:#164b3a;    --bos-border:rgba(0,0,0,.08);
  --bos-radius:16px;      --bos-shadow:0 2px 12px rgba(0,0,0,.025);
}
```

- **禁止新增颜色变量**。需要状态色时复用既有语义：`.bos-badge-green`(#edf4ef/#164b3a)、`.bos-badge-warning`(#faf1e6/#85521b)、`.bos-sales-error`(#a44b36)。
- 卡片圆角 16px、控件圆角 12px、按钮 `min-height:40px`、卡片内边距 24px。
- 字体栈：`-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif`（V3 侧为 `Inter` + 系统回退）。
- 字号只用既有档位：**36 / 20 / 15 / 14 / 13 / 11(eyebrow)**，通过 `.bos-type-*` class 使用。
- 焦点态必须保留 `.bos :focus-visible{outline:3px solid #498b73;outline-offset:3px}`，**不得 `outline:none`**。
- 动效克制：`transition .16s`，点击 `scale(.98)`；`prefers-reduced-motion` 下必须失效（`bos.css` 已全局处理，新增动画要确认被覆盖）。

### 3.3 必须复用设计系统原语

新增界面一律从 `components/ui/bos.tsx` 取件，不要写裸标签 + 自定义 class：

```tsx
import { Header, Card, Table, Badge, Button, EmptyState, Skeleton, Typography } from '@/components/ui/bos';
```

| 原语 | 何时用 |
|---|---|
| `Header` | 每个页面顶部（eyebrow + display 标题 + 描述 + actions） |
| `Card` | 内容分区容器 |
| `Table` | 任何表格（自带 `bos-table-scroll` 横向滚动 + `caption` 无障碍） |
| `Badge` | 状态标记（`neutral` / `green` / `warning`） |
| `Button` | `primary` / `secondary` / `ghost` |
| `EmptyState` / `Skeleton` | 空态与加载态，**每个数据区块都要有**，加载态配 `app/*/loading.tsx` |

### 3.4 响应式与无障碍（不接受省略）

- 必须覆盖 `bos.css` 既有断点行为：`min-width:1600px`、`max-width:1250px`、`1200px`、`1100px`、`760px`、`600px`。
- 侧边栏宽度变化（208 / 224 / 176 / 全宽）与主区 padding 由既有媒体查询负责，新模块不要绕开。
- 图标统一 `lucide-react`，`size={18} strokeWidth={1.6}`（侧边栏规范）。
- 交互元素必须有可读的 `aria-label` / `aria-current="page"`；装饰性元素加 `aria-hidden`。
- 移动端 390px 宽**不得出现横向溢出**（这是既有验收标准）。

### 3.5 不得伪造数据（设计即产品诚信）

- 未知值 / 零分母显示 `—`，不显示 `0` 假装有数据。
- 未接入的渠道保持 `NOT_CONNECTED` 标注，不得展示编造的广告趋势。
- AI 生成内容必须标注来源与「建议」属性，**不得自动对外发送**。

---

## 4. 所有 API 必须经过 Zod 验证

### 4.1 路由模板（照抄即可）

`app/api/**/route.ts` **只有 6 行**：

```ts
import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { createTask,listTasks } from '@/services/task-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await listTasks(user,Object.fromEntries(req.nextUrl.searchParams)));});}
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await createTask(await req.json(),user),201);});}
```

规则：

- 每个方法体用 `handle(async () => ...)` 包裹，**自己不要写 `try/catch`**（`lib/http.ts` 已统一处理）。
- 成功一律 `ok(data, status?)`，返回信封 `{success:true,data}`；**信封结构不可更改**，前端全部依赖它。
- 错误一律 `throw new HttpError(status, '中文用户可读信息')`；`ZodError` 自动映射 400，`HttpError` 用其 status，其他错误统一 500 且**只返回通用文案**，真实错误进 `console.error`。
- **禁止把 Prisma 错误、堆栈、SQL、密钥回传给客户端。**
- `export const dynamic='force-dynamic'`（除确知可静态化的页面路由）。
- 鉴权：`await requireUser()`；仅管理员操作 `await requireUser(true)`。

### 4.2 Zod 放置位置与写法

| 场景 | 位置 |
|---|---|
| 领域共享 schema（客户/跟进/成交） | `lib/validation.ts` |
| 模块内 schema（任务、报价、webhook、导入） | 该 service 文件**顶部**，如 `services/task-service.ts` 的 `taskInput` / `patchInput` |

规则：

- **`.parse()` 必须在 service 内执行，不在 route 内。** route 把 `unknown` 原样传下去。
- schema 可以复用现有工具：`choice()`（由常量对象生成 enum）、`amount`（非负、最多两位小数、上限 1e12）、`date`。
- 字符串字段必须给出 `.trim()` 与 `.max(...)`；数量/金额用 `z.coerce`；可空用 `.nullable().default(null)`。
- Query 参数：route 用 `Object.fromEntries(req.nextUrl.searchParams)` 传入，service 内做 `z.enum(...).parse(query.status)`，并对**分页上限**做硬编码截断（参考 `listTasks` 的 `take:101` → `slice(0,100)`）。
- 跨字段约束用 `.superRefine()`（参考 `customerSchema` 的「无效客户必须填写原因」）。
- **解析失败信息必须中文且面向用户**，会直接显示在界面上。
- 时间参数统一 `z.string().datetime({ offset: true })`，在 service 内经 `lib/time` 转为业务时区。

### 4.3 兼容性

- 入参新增字段必须**可选 + 有默认值**，不得让旧版前端调用直接 400。
- 出参新增字段可以（前端忽略未知字段），但**不得删除或重命名**既有字段。

---

## 5. 所有业务逻辑必须放 services 层

### 5.1 职责边界

| 层 | 允许做 | 禁止做 |
|---|---|---|
| `app/**/page.tsx` | Server Component 取数（调用 service）、渲染 | 直接 `db.*`、业务判断 |
| `app/api/**/route.ts` | 鉴权、转发、包装响应 | 业务逻辑、`db.*`、Zod 解析 |
| `components/**` | 展示、局部状态、轮询、乐观更新 | 直接 `db.*`、绕过 API 改数据 |
| `services/**` | 全部业务规则、权限作用域、事务、Prisma 访问 | 返回 `Response`、读写 Cookie |
| `lib/**` | 跨模块纯能力（auth/db/http/time/validation/whatsapp…） | 具体业务流程 |

**判断标准**：如果一段逻辑涉及「谁能看/改」「数据一致性和事务」「业务口径与规则」，它属于 `services/`。

### 5.2 service 函数约定

```ts
// 一律显式接收 Actor，一律显式作用域隔离
export async function createTask(input: unknown, user: Actor) {
  const v = taskInput.parse(input);            // 1) 校验
  if (v.customerId) await accessible(v.customerId, user);  // 2) 权限
  return retryTransaction(() => db.$transaction(async tx => { // 3) 事务
    const task = await tx.task.create({ data: { ...v, createdBy: user.id } });
    await taskReminders(tx, task.id, task.dueDate, task.reminderMinutes);
    return tx.task.findUniqueOrThrow({ where: { id: task.id }, include: taskInclude });
  }));
}
```

- **每个 service 函数签名都带 `user: Actor`**，并强制作用域：
  - 通用：`scope(user)`（`lib/auth.ts`）
  - 自定义：如 `taskScope(user)`（`services/task-service.ts`）
  - 单条访问：`accessible(id, user)`（`services/customer-service.ts`）
- **越权访问返回 404 而不是 403**，避免泄漏资源是否存在。
- 销售角色（`SALES`）只能操作 `ownerId === user.id` 的客户；管理员看全量。新增实体必须实现同等级的隔离，并在测试中覆盖。
- **写操作必须走 `db.$transaction`**；凡是会触发工作流/任务/提醒的写路径，必须用 `retryTransaction` 包裹（P2034 重试 + 一致的加锁顺序：**先 Task 后 Reminder**，先用 Customer 主键行锁串行化同客户）。
- 并发更新必须带 `updatedAt` 条件并使用 `updateMany` 校验 `count`，冲突抛 `HttpError(409, ...)`（参考 `updateTask`）。
- 读取路径**严禁产生副作用**（GET 不得创建任务/提醒）。
- 金额用 `Prisma.Decimal`；日期用 `lib/time` 的 `localDate` / `dayKey` + `Setting.timezone`，**不要**直接 `new Date(str)` 处理业务日期。
- 删除采用软删除 / tombstone：`Task` 删除保留 `automationKey` 以防自动任务复活。
- 模块间复用 service 函数，**不要跨 service 直接访问对方的表**。

### 5.3 新增 service 检查清单

- [ ] 文件放 `services/<domain>-service.ts`，命名与既有文件一致（kebab-case + `-service`）
- [ ] 导出函数带 `Actor` 参数并做作用域过滤
- [ ] Zod schema 定义在本文件顶部或 `lib/validation.ts`
- [ ] 写路径有事务，涉及工作流的有 `retryTransaction`
- [ ] 领域错误用 `HttpError` + 中文文案
- [ ] 在 `tests/` 增加对应单元/集成测试

---

## 6. 修改代码前先分析影响范围

本项目存在**多入口共享同一 service** 的结构，改一处会同时影响旧版页面、V3 工作台和 BOS 三个模块。动手前必须完成以下分析并在提交说明中记录结论。

### 6.1 强制分析动作

1. **谁调用它**：`grep` 目标符号，列出全部调用点。
   ```sh
   grep -rn "syncCustomerWorkflow\|createTask\|scope(" app components services lib tests --include="*.ts" --include="*.tsx"
   ```
2. **哪些入口受影响**：逐一核对 5 类入口
   | 入口 | 路径 |
   |---|---|
   | 旧版统一 API | `app/api/[...path]/route.ts` |
   | 显式 REST 路由 | `app/api/{tasks,quotations,reminders,workflow-events,workflows,sales-workspace,workspace-customers}/` |
   | BOS 只读 API | `app/api/bos/{command-center,growth,sales}/` |
   | WhatsApp 路由 | `app/api/whatsapp/*` |
   | 页面 | `/`、`/customers`、`/command-center`、`/growth`、`/sales`、`/whatsapp`、`/tasks`、`/funnel`、`/targets`、`/analytics`、`/settings` |
3. **是否触碰受保护语义**：对照 §1.1 的约束表逐条确认（幂等键、单例行、软删除、口径字段、枚举值域）。
4. **是否影响指标口径**：销售额/毛利按 `Deal.dealDate`；转化率按「所选周期新建客户群体」；零分母返回 0。改动统计必须同步更新 `README.md` 的指标表与 `docs/`。
5. **是否影响自动化与提醒**：涉及 `WorkflowEvent` / `Task` / `Reminder` 的改动，必须验证去重键、tombstone、重开提醒、409 冲突四条路径。
6. **是否影响前端契约**：`{success,data}` 信封、字段名、分页游标（`nextCursor`）不可破坏。
7. **是否影响设计系统**：新样式是否限定在 `.bos` / `.v3-shell` 作用域内，是否影响旧页面。
8. **是否影响部署**：涉及迁移、环境变量、`production-init.mjs` 的改动必须单独说明升级步骤。

### 6.2 影响范围分级

| 级别 | 判定 | 必须做的事 |
|---|---|---|
| **L1 局部** | 单个组件/单个 service 内部，无 schema 变更 | 单测 + `tsc` + `lint` |
| **L2 跨模块** | 被多个入口调用的 service、共享 schema、设计系统 token | L1 + 列出全部受影响入口 + 回归测试 + 手动核对受影响页面 |
| **L3 数据/部署** | `schema.prisma`、迁移、`production-init`、环境变量、`lib/auth`、`lib/time` | L2 + **数据库副本演练** + 升级/回滚步骤写入 `docs/` + CI 全绿 |

**L3 必须在数据库副本上验证**，禁止在真实库直接试。

### 6.3 提交说明必须包含

```
影响范围：<L1/L2/L3>
受影响入口：<页面/API 列表>
数据库变更：<无 | 迁移名 + 是否加性>
指标口径变更：<无 | 说明 + 文档更新位置>
验证：<执行的命令与结果>
```

---

## 7. 提交前验证闸门（Definition of Done）

按顺序全部通过才算完成：

```sh
pnpm exec prisma validate        # schema 合法性
pnpm exec prisma generate        # 客户端同步（改了 schema 必跑）
pnpm test                        # 37+ 用例，0 失败
pnpm lint                        # ESLint
pnpm exec tsc --noEmit           # 严格 TypeScript
pnpm build                       # 生产构建（含 production-init + migrate deploy）
```

- 涉及数据库集成行为的改动，**必须在 MySQL 环境跑**（CI 使用 MySQL 8.4 service，见 `.github/workflows/ci.yml`）。
- 涉及 UI 的改动，需在 **1600px 桌面 + 390px 移动端**各核对一次，确认无横向溢出、无控制台错误。
- 新增能力必须同步文档：功能说明更新 `README.md` 对应章节，架构性变更写入 `docs/`。
- 提交信息沿用既有 Conventional Commits 风格：`feat:` / `fix:` / `docs:` / `test:` / `chore:`，中文或英文均可，需说明「为什么」。

### 分支与 CI 须知（当前状态）

- 仓库当前**没有 `main` 分支**，工作分支为 `feature/bos-core-v1`（历史分支：`feature/apple-sales-workbench-v3`、`fix/prisma-task-deadlock-retry`、`codex/whatsapp-crm-v2`）。
- `ci.yml` 目前只在 `pull_request → main` 和 `push → main | feature/whatsapp-webhook` 触发。**在当前分支 push 不会自动跑 CI**，因此上述闸门必须在本地完整执行，或先修正 CI 触发条件。

---

## 8. 代码风格约定（与现状一致）

- 单文件以**紧凑风格**为主（部分文件为单行函数），但**新增代码优先可读性**：一个函数一件事，长逻辑分行。
- 中文用于**用户可见文案**与**业务注释**；标识符、类型、字段名用英文。
- 共享常量集中在 `lib/constants.ts`（阶段/来源/采购类型/跟进方式），界面标签不要硬编码中文枚举。
- 类型集中 `lib/types.ts` / `lib/workspace-types.ts`；跨层传递用显式类型，避免 `any`。
- 组件文件 `kebab-case.tsx`，导出 `PascalCase` 组件；服务端组件默认，需要交互才加 `'use client'`。
- 轮询频率沿用既有约定：通知 30s、首页 60s、聊天 5s；**切到后台必须暂停请求**。

---

## 附录 A · 变更前影响分析模板（复制到 PR / 提交说明）

```markdown
## 影响分析

**变更目标**：

**影响级别**：L1 / L2 / L3

**调用方排查**（grep 结果）：
- 调用点 1：
- 调用点 2：

**受影响入口**：
- 页面：
- API：
- 其他：

**数据库变更**：无 / 迁移 `2026xxxx_xxx`
- [ ] schema.prisma 与 migration.sql 同时提交
- [ ] 加性变更（新增表/列/索引），无改列、无删列
- [ ] 已在数据库副本 deploy 通过

**受保护语义核对**（§1.1）：
- [ ] 幂等键未受影响
- [ ] 单例行 id 未变
- [ ] 软删除语义未变
- [ ] 业务口径字段未被混用

**指标口径变更**：无 / 说明 + README 更新位置

**自动化与提醒**：无 / 已验证去重、tombstone、重开、409

**前端契约**：未变 / 说明

**设计系统**：仅用 `.bos` 作用域与既有 token / 说明

**验证记录**：
- [ ] prisma validate + generate
- [ ] pnpm test
- [ ] pnpm lint
- [ ] tsc --noEmit
- [ ] pnpm build
- [ ] 桌面 1600 / 移动 390 视觉核对（如涉及 UI）
```

---

## 附录 B · 高频反例

| 反例 | 为什么错 | 正确做法 |
|---|---|---|
| 在 `route.ts` 里 `db.customer.findMany(...)` | 绕过作用域与校验 | 调用 `services/` 函数 |
| 在组件里 `fetch('/api/...')` 后直接改本地状态冒充成功 | 与服务端不一致 | 沿用乐观更新 + 失败回滚 + 409 处理（参考 `TaskCenter`） |
| `prisma db push` 快速同步 schema | 不生成迁移，生产无法升级 | `prisma migrate dev --name ...` |
| 把 `Customer.stage` 改成数据库 enum | 破坏既有 String 列与迁移基线 | 保持 String，用 `z.enum` 约束 |
| 直接删客户记录 | 丢失留资/订单/会话历史 | `deletedAt` 软删除 + 回收站 |
| 新增 `--color-brand-500` 之类的颜色变量 | 破坏 BOS 单一色源 | 复用 `--bos-green` 等既有 token |
| `outline:none` 去掉焦点框 | 破坏无障碍验收 | 保留 `:focus-visible` 3px `#498b73` |
| 未知广告数据填 0 | 伪造数据，误导决策 | 显示 `—`，渠道标 `NOT_CONNECTED` |
| 金额用 `number` 运算 | 精度丢失 | `Prisma.Decimal` |
| `new Date(query.date)` 当业务日期 | 时区错位（Asia/Shanghai） | `lib/time` 的 `localDate` / `dayKey` |
| GET 接口里顺手 `syncWorkflows` | 读路径产生副作用、可能死锁 | 走鉴权 `POST /api/workflows/sync` |

---

**规范维护**：本文件与代码同步演进。当实际约定发生变化时，先更新本文件再改代码，避免规范与实现漂移。
