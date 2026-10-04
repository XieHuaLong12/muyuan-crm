> 当前 LVANJU BOS 使用 Next.js 15.5 / React 19 / Prisma 6.19 / MySQL。下面的 V1 SQLite 说明保留作历史参考，当前部署请以 [身份链实现与部署报告](docs/IDENTITY_CHAIN.md) 和 `.env.example` 为准。

当前已实现 Meta CSV / webhook → 统一 Lead 账本 → E.164 与历史号码别名 → CRM Customer → 分账号 WhatsApp Conversation → 真实 Quote / Deal / Order → 固定广告归因 → 可重试反馈台账。AI 是增量建议，人工修正独立保存，原始消息和订单来源保留。

新增入口：客户 / 销售 / 订单详情中的身份时间线，以及 `/analytics/ads`、`/analytics/conversations`、`/analytics/loss-reasons`、`/analytics/data-quality`。广告详情可双向追溯客户、会话与固定归因订单；缺少来源、成本或 API 配置时显示未知 / 未连接。

| 新分析口径 | 定义 |
| --- | --- |
| 客户群体 | 周期内首次 / 末次留资，每客户计一次；联系、回复、正式报价为截至当前的历史事实 |
| 成交 / 毛利 | Deal.dealDate 窗口，真实原币金额与已登记毛利；OrderAttribution 固定订单前末次有效 Meta 来源 |
| CPL | Meta 平台花费 / 平台 Leads；CRM 留资单独显示 |
| 每单成本 / ROAS | 花费 / 订单数、销售额 / 花费；同币种才计算，未知数据及零分母返回 null，不冒充首次获客 CAC |
| 素材 | 原 Lead 的 Creative 快照；历史素材版本没有可用费用分解时，素材成本保持未知 |

新增 3 条加性迁移；99 项隔离 MySQL 测试和旧库升级演练见 [验收记录](docs/identity-acceptance/README.md)。测试只允许本机 / CI 的 MySQL `*_test` 数据库。生产 `build` / `start` 会执行既有初始化和迁移，不是只读检查；先在副本演练。

Meta 回传默认 `META_FEEDBACK_ENABLED=false`；未设置 Dataset / CAPI token 不会外发。后台恢复 worker 为 POST `/api/cron/identity-chain`，需服务器私有 `x-cron-secret`；部署平台的定时任务需要另行配置。真实 Meta / WhatsApp / AI 授权与验收仍需服务器现有配置，本次未部署生产。

# 木远 CRM · 家具外贸轻量销售管理系统 V1

这是可运行的 Next.js 全栈项目，使用 Prisma + SQLite 持久化数据，界面中文，默认人民币与 Asia/Shanghai 时区。不是静态演示页面。

## 已安装的本机版本

双击 `start-crm.cmd`，保持运行窗口开启，然后访问 http://127.0.0.1:3000 。如果该地址已有 CRM 正在运行，直接打开即可，不必重复启动。

演示管理员：`admin@example.com` / `（从本地 .env 的 SEED_ADMIN_PASSWORD 获取）`，姓名 Jason。

演示销售：`sales@example.com` / `（从本地 .env 的 SEED_ADMIN_PASSWORD 获取）`，姓名 Sophie。销售只能查看及修改自己的客户，不能删除客户或修改目标、设置、用户。

密码经 scrypt 加盐哈希保存，前端没有预置密码。以上账号仅用于本地演示。首次初始化密码由 `SEED_ADMIN_PASSWORD` 指定；重复 Seed 不重置已有密码。

## 从源码安装

要求 Node.js 22 或更高版本、pnpm 11。仓库包含 pnpm 锁文件。

```sh
pnpm install
pnpm db:init
pnpm dev
```

`db:init` 会在不存在时生成本地 `.env`（随机认证密钥和 Webhook 密钥）、创建 SQLite 文件、执行迁移、生成 Prisma Client 并 Seed。已存在的 `.env`、用户密码和业务记录会保留。初始化默认演示密码见上文；如需更改，在初始化数据库前编辑 `.env`。

生产模式：

```sh
pnpm build
pnpm start
```

数据库：`prisma/dev.db`。SQLite 文件路径相对于 Prisma schema。仅监听 `127.0.0.1:3000`，本次未部署公网。

单独执行数据库和检查命令：

```sh
pnpm db:migrate --name your_change
pnpm db:seed
pnpm test
pnpm lint
pnpm build
# 应用已启动后执行：
pnpm test:smoke
```

`test:smoke` 用独立标识创建验收记录，并在结束后清理自己创建的记录以及 2099 年测试目标。仅在本地演示数据库运行，不要对真实生产库运行。测试可通过 `TEST_BASE_URL` 指向另一端口。

## 项目结构

```text
app/
  [[...path]]/page.tsx    受保护的工作台页面入口
  api/[...path]/route.ts  统一 API 路由、身份校验与响应
  login/page.tsx         登录
  globals.css           响应式界面样式
components/
  workspace.tsx         七个页面的导航与状态协调
  customer-table.tsx    列表、阶段标签、跟进提醒
  customer-detail.tsx   详情、跟进时间线、订单、阶段历史
  forms.tsx             客户、跟进、成交表单
  dashboard.tsx         KPI、趋势、漏斗、来源与国家分析
  management.tsx        目标与设置
  ui/dialog.tsx         Radix 可访问对话框封装
  agent-tools.tsx       可选的浏览器只读业绩工具
lib/                    类型、枚举、验证、时间、认证、数据库连接
services/               客户、业绩、目标、询盘导入业务服务
prisma/schema.prisma    数据模型
prisma/migrations/      已执行的初始化迁移
prisma/seed.ts           40 客户、12 订单、2 用户、年度/月/周目标
scripts/                环境初始化、数据库初始化、接口验收
tests/                  核心指标与边界单元测试
```

技术栈：Next.js 15 App Router、TypeScript、React、Tailwind CSS 4、Radix Dialog（shadcn 风格本地封装）、Prisma 6、SQLite、Recharts、React Hook Form、Zod、date-fns/date-fns-tz。表格与基础控件使用语义化 HTML，不依赖完整 shadcn 组件库。

## 页面与已完成功能

| 页面 | 路径 | 功能 |
| --- | --- | --- |
| 总览 | `/` | 周/月/年与日期切换、六项 KPI、周期目标、超额提醒、销售趋势、漏斗、今日跟进、最近成交、年度预测 |
| 客户 CRM | `/customers` | 新增、编辑、软删除；搜索姓名/公司/邮箱/电话/WhatsApp；国家/来源/负责人/产品/创建与成交时间筛选；排序、分页、快捷跟进 |
| 客户详情 | `/customers/:id` | 基础与采购资料、备注、有效性、阶段时间、跟进时间线、历史阶段、多笔成交订单 |
| 销售漏斗 | `/funnel` | 本期新增客户的阶段历史计数、相邻阶段转化、点击当前阶段筛选 |
| 跟进任务 | `/tasks` | 今日、超时、未来七天、全部；填写跟进即完成当前待办，可安排下一次 |
| 目标管理 | `/targets` | 年度平均分配、独立月/周目标编辑、月度目标与实际图表、保留手工目标 |
| 数据分析 | `/analytics` | 询盘、有效、报价、成交、销售与毛利趋势；来源和国家分布 |
| 设置 | `/settings` | 公司、默认货币、时区、Webhook 配置状态、添加员工与角色 |
| 登录 | `/login` | 哈希密码、签名 HttpOnly 会话、登录失败限速 |

国家、产品、型号允许自由输入，支持可选 countryCode。今日跟进排最前，然后超时，最后最近新增客户。跟进提醒按配置时区的日历日期计算。

进入已联系、已回复、已确认需求、已报价会在相应时间为空时写入时间戳，后续退回/暂停不清空历史事实。每次阶段变动保存 StageHistory。首次成交请点击“新增成交订单”，必须有金额、成本及成交日期；保存后自动进入“已成交”。已有订单的客户保持该阶段，复购继续新增订单。

## 数据库结构

| 表 | 主要用途与关系 |
| --- | --- |
| User | 姓名、邮箱、密码哈希、ADMIN/SALES；一对多客户 |
| Customer | 联系/采购/来源/负责人、有效性、销售阶段与行为时间、跟进时间、备注、deletedAt |
| FollowUp | 客户一对多；方式、内容、实际与下次跟进日期、记录人 |
| StageHistory | 客户一对多；原阶段、目标阶段、操作人、时间与说明 |
| Deal | 客户一对多；订单号、金额、成本、自动毛利、货币、产品、数量、成交日 |
| SalesTarget | YEAR/MONTH/WEEK、年份/月/ISO周、目标、manual 标记、货币、唯一周期键 |
| Setting | 公司名称、默认货币、默认时区 |

金额采用 Prisma Decimal，成交时服务端计算毛利。常用客户筛选字段、联系方式和订单日期/客户索引已建立。数据库逻辑集中在服务层；客户更新/历史记录、跟进/待办更新、成交/阶段更新均使用事务。

## 核心指标口径

销售额与毛利按**订单成交日期**筛选。客户转化指标按**所选周期新建客户这一群体**计算，统计其截至当前已有的历史联系、回复、报价与订单事实；因此后续成交可改变过去新增客户群体的转化率。上一周期使用同一口径。

| 指标 | 公式 |
| --- | --- |
| 新增询盘 | 本期新创建且未软删除客户数 |
| 有效率 | 本期有效客户数 ÷ 本期询盘数 × 100% |
| 回复率 | 已联系且已回复的有效客户数 ÷ 已联系有效客户数 × 100% |
| 报价率 | 曾报价有效客户数 ÷ 有效客户数 × 100% |
| 成交率 | 至少有一笔订单的有效客户数 ÷ 有效客户数 × 100% |
| 单笔毛利润 | 成交金额 − 产品成本 |
| 整体毛利率 | 总毛利润 ÷ 总成交销售额 × 100%，不平均单笔毛利率 |
| 目标完成率 | 本期实际成交销售额 ÷ 本期目标 × 100% |
| 年度预测 | 年内累计销售额 ÷ 已经过的日历天数 × 全年天数（包含闰年） |

所有零分母返回 0。销售额不包括预计金额、报价金额。多次复购累计销售额，成交率分子对客户去重。不同币种独立查看，不进行汇率换算。无效客户必须提供原因；业务员发消息本身不会标记“客户回复”。

时间在数据库保存 UTC，显示与统计按系统时区，默认 Asia/Shanghai；周一为周起点，周目标采用 ISO 周编号。漏斗展示实际历史行为，不伪造跳过的阶段；历史行为不是同一阶段当前库存，点击阶段后的列表展示当前处于该阶段的客户。

## 默认目标

当前年度：**¥1,000,000**；月目标 **¥83,333.33**；周目标 **¥19,230.77**。显示可取整，数据库保留两位小数。月目标独立舍入，所以十二个月合计可能有数分钱差额。

采用用户指定的全年 ÷52 周均公式。ISO 53 周年份也生成第 53 周，仍按 ÷52 的金额，这是周均参考目标，不保证所有周目标之和等于年度目标。年度重分配保留手动改过的月/周目标。每个年度当前只有一套目标币种；切换年度目标币种后，已手工调整的旧币种目标仍保留，需管理员自行核对。

## 环境变量

`.env` 不入库、不进入源码包；`.env.example` 提供字段说明。

| 变量 | 用途 |
| --- | --- |
| DATABASE_URL | 默认 `file:./dev.db` |
| WEBHOOK_SECRET | 外部写入密钥，不在页面显示 |
| AUTH_SECRET | 会话 HMAC 签名密钥，初始化随机生成 |
| NEXT_PUBLIC_APP_NAME | 预留应用名称配置，当前界面品牌为木远 CRM |
| DEFAULT_TIMEZONE | Seed 默认时区，之后在设置修改 |
| DEFAULT_CURRENCY | Seed 默认货币，之后在设置修改 |
| SEED_ADMIN_PASSWORD | 首次 Seed 管理员和演示销售的密码 |

## Webhook 调用

接口：`POST /api/leads/webhook`，请求头 `x-webhook-secret` 必须与服务器 `.env` 中的 WEBHOOK_SECRET 一致；错误返回 401。

把下面 JSON 保存为 `lead.json`：

```json
{
  "name": "John Smith",
  "companyName": "ABC Furniture",
  "country": "France",
  "email": "john@example.com",
  "whatsapp": "+33612345678",
  "source": "FACEBOOK",
  "sourceDetail": "France Sofa Campaign",
  "productInterest": "Compressed Sofa",
  "productModel": "Y-601",
  "purchaseType": "WHOLESALE",
  "quantity": 20,
  "notes": "Interested in 40HQ order"
}
```

PowerShell 示例（先从服务器配置安全取得密钥）：

```powershell
$headers = @{ 'x-webhook-secret' = $env:WEBHOOK_SECRET }
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/api/leads/webhook' -Headers $headers -ContentType 'application/json' -InFile '.\lead.json'
```

注意：PowerShell 不会自动读取项目 `.env`。示例中的 `$env:WEBHOOK_SECRET` 应由调用方预先设置，不要把密钥放进网址或前端代码。

新记录固定 NEW、isQualified=null，默认分给管理员。返回 `{success:true,data:{customerId,created:true,potentialDuplicate:false}}`。已存在相同 Email/Phone/WhatsApp 时返回 `created:false,potentialDuplicate:true,duplicateDetected:true`，不重复创建。邮箱忽略大小写，电话去除分隔符并统一 `00` 国际前缀；手工录入可查看重复提示并明确继续创建。

导入映射位于 `services/lead-import-service.ts`，可扩展 Facebook/TikTok/Website adapter。当前是通用 JSON 接口，尚未直接连接各广告平台。

## 验证范围与当前边界

已经执行 migration、Seed、TypeScript、Lint、单元测试、生产 Build 和真实 HTTP 接口验收。接口测试覆盖：权限、CRUD、阶段时间不丢失、跟进更新时间、多笔成交、业绩增量、Webhook 鉴权与去重、软删除、手动目标保留、七个页面路由。

浏览器已经验证登录、总览加载、新建客户和客户详情。最终检查明细见 `验收记录.md`。未覆盖的浏览器流程不会以接口验收冒充。

V1 当前边界：

- 仅本地运行，未配置公网域名、HTTPS、备份计划或广告平台真实接入。
- 用户可新增；暂未提供停用员工、密码找回、密码修改、订单修改/退款与订单撤销。
- 客户列表与分析适配轻量团队，采用少量查询后内存聚合/前端分页；更大数据量需改为数据库聚合和服务端分页。
- Webhook 顺序化去重与登录限速为单进程实现；多实例部署需共享锁、持久化幂等键及分布式限速。
- 手机和平板已配置响应式布局，宽表横向滚动；完整多设备视觉回归尚需进一步执行。
- 未做库存、采购、仓库、财务会计、OA、广告成本、AI跟进、报价单或 PI，符合 V1 范围。

## 迁移 PostgreSQL / Supabase

保留服务/API边界，将 Prisma datasource provider 改为 `postgresql`，设置 PostgreSQL DATABASE_URL。为 PostgreSQL 生成新的初始迁移（不要直接运行 SQLite 的迁移 SQL），再通过专门的数据迁移脚本导出/导入七张表，保留 id、关系、UTC 日期和 Decimal 金额。对 Decimal 增加明确的 `@db.Decimal` 精度，根据业务使用数据库原生 enum、幂等唯一约束与并发事务策略。执行同一套指标和接口回归测试后切换连接。

Supabase 可先作为托管 PostgreSQL 使用；Supabase Auth/RLS 不是自动获得的功能，若启用需单独设计认证与行权限。

## 下一步建议

先加入每日数据库备份、员工停用与密码修改、软删除恢复、订单更正审计，再接入实际 Facebook/官网询盘。数据量增长后升级 PostgreSQL 与服务端分页，最后考虑报价单/PI和自动提醒。

## 2026-09-26 更新：Meta 广告数据与表单目录同步

Growth Center 广告表现接入 Meta Marketing API（System User Token + ads_read）：广告系列与近 30 天按天花费/展示/点击/线索自动同步进 Campaign/MarketingMetric 表；Lead Ads 表单目录（leadgen_forms）同步进 MetaLeadForm；线索事件补记 adId/campaignId 归因。支持设置页手动同步与 Hostinger Cron 每 6 小时定时同步（`/api/cron/meta-sync`）。配置步骤与排查见 [docs/META_ADS_SYNC.md](docs/META_ADS_SYNC.md)。

## 2026-09-12 更新：批量客户管理

客户列表新增复选框、当前页全选、跨页选择、名单确认、批量软删除与回收站恢复。仅管理员可用，已成交客户受到批量删除保护。更换筛选条件清空选择。详见 `批量客户管理说明.md`。新增 HTTP 验收：`node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/batch-smoke.ts`。

## 2026-09-12 更新：询盘日期与 Meta 智能导入

客户表单仅选择客户实际产生询盘的日期，支持历史补录；新增客户、来源、国家与漏斗归属使用询盘日期，订单统计仍使用成交日期。后台保留创建审计时间，但客户界面不单独展示。

管理员可点击“新建客户”旁的“智能导入”上传 Meta CSV，先预览识别字段及查重结果，再确认写入。支持二次留资历史、同 Lead 跳过、疑似重复人工处理及翻译服务配置。详情与测试边界见 [智能导入说明](智能导入说明.md)。

更新已有安装时先备份数据库，再执行 `pnpm exec prisma migrate deploy`、`pnpm exec prisma generate`、`pnpm build` 并重新启动；不要对已有真实数据运行演示 Seed。所有回归测试应使用数据库副本：设置 `DATABASE_URL` 到副本，同时 HTTP 服务与测试程序使用相同的副本和 `TEST_BASE_URL`。
