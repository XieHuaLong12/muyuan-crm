> 当前 LVANJU BOS 使用 Next.js 15.5 / React 19 / Prisma 6.19 / MySQL。下面的 V1 SQLite 说明保留作历史参考，当前部署请以 [身份链实现与部署报告](docs/IDENTITY_CHAIN.md) 和 `.env.example` 为准；给新客户从零搭一套，按 [搭建流程](docs/SETUP_GUIDE.md) 走。

**进线时间 · 需求画像 · 国家作战卡 · AI 计划**（2026-11-02）。客户中心每位客户标出进线时间（北京 + 客户当地时间，工作时间外单独标出、可筛选），预览和档案里能看到从进线到现在每一步用了多久；聊天右侧新增需求画像（AI 和规则从客户原话里摘尺寸、数量、目的港等，人确认后才算，缺的项给一句问法放进输入框），改为已流失时按聊天预选原因并可填别家价格；经营总览新增「国家作战卡」（按进线时间看一个国家：什么时候进线的 A / B 多、什么时候发首条回复率高、首联速度、跟进到第几次该停、素材和投放时段的成本、客户要什么、成交周期、流失原因、节假日）和「AI 计划」（按客户在线时间排好今天、周报、广告建议采纳 / 忽略并 7 天后复盘）。AI 只给建议和草稿，不自动发消息、不自动改广告。口径见 [指标口径](docs/METRICS.md)。

**客户分析、消息分析：只看有效客户 + 广告效果**（2026-10-31）。有效客户改为「A / B 级，且我们发出第一条后客户回复了」；客户分析只有「新增线索」是全部线索，其余（有效率、报价、成交、来源、国家、负责人、名单）都只看有效客户，并新增广告效果：按广告系列看花费占比对比有效客户占比、每个有效客户花多少钱（Meta 同步的花费，广告账户币种）。消息分析只看和有效客户的聊天，最上面是谁在等我们回复、等了多久。口径见 [指标口径](docs/METRICS.md#客户分析2026-10-31-起只看有效客户servicescustomer-analytics-servicetslibanalyticsts)。

**消息页：优化话术**（2026-10-30）。输入框写一句后点「优化话术」，按客户语言给 3 条不同方向的写法（带中文和改了什么），点「用这条」才填进输入框，可换一批、可还原；不加原话里没有的数字和价格，客户问价时提醒用报价单。详见 [消息中心](docs/MESSAGE_CENTER.md#优化话术2026-10-30)。

**消息页：等级头像、可调输入框、自动翻译、产品资料、常用回复**（2026-10-30）。头像就是客户等级（A 橙、B 蓝、C 浅绿、D 灰、未评虚线），点聊天顶部头像一键改等级、可撤销，AI 的等级建议直接接受或不改，列表可按等级筛选；输入框打字自动变高、可拖动调高度、可放大写长消息；客户的外语消息自动带中文并保存，我们发出的消息保留当时写的中文，可按客户关掉；「产品资料」一次勾选目录、规格表、产品图一起发（资料库在「产品库 · 资料文件」）；「常用回复」或输入框打「/」搜索，点了只填进输入框，按客户语言填好、不放价格。详见 [消息中心](docs/MESSAGE_CENTER.md#客户等级可调输入框自动翻译产品资料常用回复2026-10-30)。

**工作日历改版：每日复盘与明日安排**（2026-10-22）。工作日历换成「今天 · 复盘 · 记录」三页：首页只看本月 / 本周重心、今日三件事（头天晚上排好，做完打勾留在列表里）、今晚复盘入口和今天的时间块；晚上复盘逐件选完成 / 顺延 / 不做了并写原因，回答复盘三问、给精力和专注打分，排好明天三件事；提交后仍可修改，每次修改都留下改前改后的记录，没复盘的日子系统按勾选记下。每晚 21:30（周末也发）推送复盘提醒。复盘只有本人能看。详见 [话术效果分析与工作日历 §11](docs/OUTREACH_AND_WORKBENCH.md#11-工作日历改版每日复盘与明日安排2026-10-22)，口径见 [指标口径](docs/METRICS.md#每日复盘2026-10-22-起servicesdaily-review-servicetslibworkbenchts)。

**工作台：话术效果分析与工作日历**（2026-10-21）。每发一组主动消息都记一条触达记录（T0–T4 破冰、R1–R3 唤醒，按会话状态自动判定），BOS 模板直接带话术编号，手机端消息由规则比对原文、比不上再交给 DeepSeek；客户回复由 DeepSeek 判质量与信号，自动回复不算回复。话术按同等级轮流分配，看板按 24 小时回复率、分等级、胜出概率给出建议，每周一自动出结论；人工改判留修改记录。管理员登录后首页是工作日历：本月重心、本周重心、今日三件事（新线索超 5 分钟未首回标红置顶）、重心信号与本周精力分配。设计、规则与验收见 [话术效果分析与工作日历](docs/OUTREACH_AND_WORKBENCH.md)，口径见 [指标口径](docs/METRICS.md#话术效果2026-10-21-起servicesoutreach-analytics-servicets)。

CRM 可以**安装到手机桌面当 App 用**（PWA）：安卓点页面顶部的「安装」，iPhone 用 Safari「分享 → 添加到主屏幕」；全屏打开，提醒以系统通知弹出，断网时显示离线页，不在手机上缓存客户数据。详见 [手机 App](docs/MOBILE_APP.md)。

产品库新增**报价单与运费库**：选客户和型号，单价按「该客户上次报价 → 价格表 → 汇率折算」自动带出、可逐行修改与整体调价；运费按目的国运价（按公斤含计泡 / 按立方 / 整柜 / 按票）自动计算；人民币自动出中文单据、外币出英文单据（可选法文），一键导出图片与 PDF；每份报价挂在客户档案下并列出报过的价格。详见 [报价单与运费库](docs/QUOTATION_SYSTEM.md)。

Meta 广告表单线索通过 Webhook 实时入库，并由每 5 分钟的定时补拉兜底；管理员与销售在页面内和浏览器桌面实时收到新线索、新分配与首联超时提醒，广告线索分配后须在 5 分钟内联系，见 [Meta Lead Ads 接入说明](docs/META_LEAD_ADS.md)。

客户列表支持**定制列**：每个人在「定制列」里按分组勾选、拖动排序自己要看的列（33 列可选，只影响本人）；点客户名字进入档案，点客户这一列的其他位置在右侧打开客户预览（关键信息、快捷操作、最近跟进），不用离开列表。列表按广告表单自动评级分出 A 级 / B 级 / C 级页签，「有效性」可在列表里直接点选。详见 [角色工作空间](docs/ROLE_WORKSPACES.md#客户列表定制列与客户预览2026-10-15)。

客户分**新客户**和**旧客户**两页：2026 年 10 月 1 日之前询盘的是旧客户，照常聊天、报价、下单，但不参与话术测试，也不进今日工作，话术效果只用新客户的数据。详见 [话术效果分析与工作日历](docs/OUTREACH_AND_WORKBENCH.md#12-新客户--旧客户分开2026-10-29)。

自动进入的线索先进入待分配池（或按设置轮流分给销售），管理员在客户列表批量分配 / 转交；成交与跟进录错可由管理员更正或作废。详见 [角色工作空间](docs/ROLE_WORKSPACES.md) 的「客户分配、更正与性能修订」。

管理员与销售现使用两套工作空间：管理员管理团队业绩、个人月目标、首联时效和销售账号；销售处理自己的客户、任务和业绩。新分配客户有首联任务，停用/密码重置撤销旧登录。入口、增量迁移和统计口径见 [角色工作空间](docs/ROLE_WORKSPACES.md)。

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
  workspace.tsx         旧版界面：客户、目标、公司设置、集成与线索接入页面
  customer-table.tsx    列表、阶段标签、跟进提醒
  customer-detail.tsx   详情、跟进时间线、订单、阶段历史
  forms.tsx             客户、跟进、成交表单
  management.tsx        目标与设置
  ui/dialog.tsx         Radix 可访问对话框封装
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

侧边栏按「分区」组织：相关页面是同一分区里的标签，侧边栏只保留常用入口。

| 角色 | 分区 | 分区内的页面 |
| --- | --- | --- |
| 管理员 | 经营总览 | 经营驾驶舱 `/command-center` · 来源与国家 `/command-center/analysis` · 财务 `/finance` · 客户分析 `/command-center/customers` · 消息分析 `/command-center/messages` · 国家作战卡 `/command-center/countries` · AI 计划 `/command-center/plan` |
| 管理员 | 客户 | 客户列表与档案 `/customers`（含待分配、回收站、智能导入）· 跟进队列 `/sales` · 销售看板 `/crm` |
| 管理员 | 消息 | WhatsApp 消息中心 `/messages`（全部客户，可按负责人、标签筛选；待处理；在聊天里点改销售阶段、贴标签；处理未关联号码） |
| 管理员 | 任务 | 团队任务 `/tasks` |
| 管理员 | 订单 | 订单 `/orders` · 产品库 `/products` · 报价单 `/products/quotes`（含报价设置）· 运费库 `/products/freight` · 资料文件 `/products/materials` · 利润 `/products/margin` |
| 管理员 | 广告与线索 | 广告效果 `/analytics/ads` · 会话质量 · 丢单原因 · 数据质量 · 线索接入 `/growth/intake` |
| 管理员 | 团队 | 销售业绩与账号 `/team` · 目标 `/targets` · 沟通监督 `/communication` |
| 管理员 | 设置 | 公司设置 `/settings` · 集成与接入 `/settings/integrations`（表单询盘、Meta、WhatsApp 与排查工具） |
| 销售 | 今日工作 | 今日跟进 `/sales`（待首联、到期跟进与到期待办，按截止时间排序）· 全部待办 `/tasks` |
| 销售 | 消息 | WhatsApp 消息中心 `/messages`（自己负责的客户；「待处理」列出该先处理的客户；「待首联」列出分配后还没联系的客户，点开即发首条模板；可在聊天里改销售阶段、贴标签） |
| 销售 | 我的客户 | 客户列表与档案 `/customers` · 销售看板 `/crm` |
| 销售 | 产品与报价 | 产品库 `/products` · 报价单 `/products/quotes` · 运费库 `/products/freight`（只读）· 资料文件 `/products/materials`（只读） |
| 销售 | 我的订单 / 我的业绩 | `/orders` · `/sales/performance` |

各页面的指标口径统一定义在 `lib/metrics.ts`，见 [指标口径](docs/METRICS.md)。

旧地址会自动跳转到合并后的页面（保留查询参数）：`/command-center/legacy`、`/analytics`、`/funnel` → 来源与国家；`/growth` → 广告效果；`/orders/list` → 订单；`/customer-directory` → 客户；`/whatsapp`、`/whatsapp/inbox` → 沟通监督；`/today` → 角色首页。跳转统一配置在 `next.config.ts`。

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


## Gupshup CTWA 实时身份链（第一生产里程碑）

Gupshup V2 与 Meta 格式 V3 通过带 `x-webhook-secret` 的回调进入已有 CRM。客户发来消息时按号码在客户中心查找（带不带 `+`、空格或横线都算同一号码，回收站里的客户不算）：找到一位就归入，找不到就自动建客，对应多位客户时进入消息中心「未关联」由管理员选择（2026-10-14 起，见 [消息中心](docs/MESSAGE_CENTER.md)）。CTWA referral 存入统一归因账本，`source_type=post` 不冒充广告，已获取的名称保留快照。旧 Lead Form、Cloud API、Local Sync 均保留。

普通发送按当前 provider/business account 的已验证客户入站时间计算 24 小时窗口；历史同步与另一业务号码的聊天不能开放该窗口。缺少时间为 UNKNOWN，过期为 CLOSED。发送 API 接受只记录 ENQUEUED；sent/delivered/read 依真实回执推进。回执可先于发送落库，持久化后补齐，状态不倒退。客户 STOP/UNSUBSCRIBE/不要联系会退订，主动 CTWA 咨询不自动授予营销同意。

接入检查：`/settings/integrations/whatsapp`；管理员按号码/客户/消息查看 `/admin/integration-debug`；`/whatsapp/inbox` 跳转到销售沟通监督。Token 与原始 webhook 不在默认前端投影中。`GUPSHUP_SOURCE_NUMBER` 兼容现有 `GUPSHUP_SOURCE`；可选 `GUPSHUP_APP_ID` 核验 V3 应用。Webhook 必须有服务器 `GUPSHUP_WEBHOOK_SECRET`。第一阶段 CAPI 默认关闭。

模板中心、营销同意管理、召回队列和召回订单归因按 [实施计划](docs/GUPSHUP_CTWA_IMPLEMENTATION.md) 接续开发：先验收一条真实 CTWA 入站，不能用本地 fixture 宣称已接通生产。升级仅追加 `20261004023000_gupshup_live_identity`；回滚应用时保留新增列和回执表。

销售使用待跟进客户清单，在档案登记跟进、报价与成交；与客户的 WhatsApp 沟通在消息中心 `/messages`，通过公司 Gupshup 业务号收发，销售看自己的客户、管理员看全部。客户发来的图片、语音、视频和文件会保存到 `MEDIA_STORAGE_DIR`。见 [消息中心](docs/MESSAGE_CENTER.md) 与 [角色工作空间](docs/ROLE_WORKSPACES.md)。
