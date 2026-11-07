# 给新客户搭建 BOS：整体流程骨架

这份文档是「把这套系统给另一家公司搭一套」的主线清单，按先后顺序排。每一步只写要做什么、做完怎么确认，细节链接到已有文档。

> 技术栈：Next.js 15 / React 19 / Prisma 6.19 / MySQL（或 MariaDB 11.8）/ Node.js 22 / pnpm 11。
> README 里 V1 的 SQLite 说明已过时，以本文档和 `.env.example` 为准。

---

## 总览：8 个阶段

| 阶段 | 做什么 | 谁来做 | 产出 |
| --- | --- | --- | --- |
| 0 | 和客户确认范围，收资料 | 你 + 客户 | 资料清单、账号清单 |
| 1 | 复制代码，换成客户的品牌和产品 | 你 | 客户专属代码仓库 |
| 2 | 准备服务器、数据库、域名 | 你（客户付费） | 一个 HTTPS 域名 + 一个空 MySQL 库 |
| 3 | 填环境变量 | 你 | 平台环境变量 / `.env` |
| 4 | 首次部署，建账号 | 你 | 能登录的系统 |
| 5 | 接外部渠道（WhatsApp、Meta、AI、推送） | 你 + 客户配合授权 | 线索和消息能自动进来 |
| 6 | 配定时任务 | 你 | 4 个 Cron |
| 7 | 验收、培训、交付 | 你 + 客户 | 验收清单、交接文档 |

之后是长期的「升级与运维」（见最后一节）。

---

## 阶段 0：确认范围，收集资料

先和客户确认要用哪些模块，没用到的渠道可以先不接，系统会显示「未连接」，不影响其他功能。

**必须拿到的：**

- [ ] 公司名（中文 / 英文）、品牌名、Logo（报价单抬头用）
- [ ] 联系方式：网站、邮箱、WhatsApp、地址（报价单页眉页脚）
- [ ] 默认货币、时区（默认 CNY、Asia/Shanghai）
- [ ] 管理员和销售名单（姓名、邮箱）
- [ ] 产品资料：型号、名称、规格、包装尺寸、CBM、毛重、价格、产品图
- [ ] 要使用的域名（如 `crm.客户域名.com`）

**按要接的渠道再拿：**

| 渠道 | 需要客户提供 / 授权 |
| --- | --- |
| WhatsApp（Gupshup，主用） | Gupshup 账号、App 名、API Key、业务号码、App ID，已审核的模板消息 |
| Meta 广告表单线索 | Meta 开发者 App（App ID / Secret）、Facebook 主页、Page Access Token |
| Meta 广告数据同步 | 广告账户 ID、System User Token（`ads_read`） |
| AI（翻译、草稿、分析） | DeepSeek API Key |
| 广告转化回传（可选，默认关） | Dataset ID、CAPI Token |

---

## 阶段 1：代码与品牌定制

### 1.1 复制代码

给每个客户单独一个仓库（或单独分支），不要和自己的生产仓库混用，后面升级时从主仓库合并过去。

### 1.2 必须替换的品牌和公司信息

下面这些是写死在代码里的，不改的话客户的报价单、AI 回复会出现 LVANJU / 木远：

| 位置 | 内容 |
| --- | --- |
| `app/layout.tsx`、`app/manifest.ts`、`app/login/page.tsx` | 网页标题、手机 App 名称、登录页品牌 |
| `components/ui/Sidebar.tsx`、`components/bos/BOSShell.tsx` | 侧边栏品牌 |
| `public/brand/lvanju-logo.jpg`、`components/bos/quote/QuoteDocument.tsx` | 报价单 Logo |
| `public/icons/*`、`app/icon.png`、`app/apple-icon.png` | 手机桌面图标 |
| `lib/quote-i18n.ts` | 报价单抬头公司名、联系方式、页脚（中 / 英 / 法三套） |
| `lib/quote-pdf.ts` | PDF 元数据里的 Producer |
| `services/whatsapp-ai-service.ts`、`services/reply-polish-service.ts`、`services/demand-profile-service.ts` | AI 提示词里的公司名和主营产品 |
| `services/whatsapp-template-service.ts`、`lib/constants.ts` | WhatsApp 模板名前缀（`lvanju_hi_*`、`lvanju_first_*`），要和客户在 Gupshup 审核的模板名一致 |
| `components/outreach/ScriptLibrary.tsx`、`components/bos/MaterialLibrary.tsx`、`lib/workbench.ts` | 话术、资料库、工作台里的品牌文字 |
| `scripts/production-init.mjs` | 首次建库时的公司名 `木远家具贸易`、管理员姓名 `Jason` |
| `prisma/seed.ts`、`scripts/setup-env.mjs`、`scripts/meta-lead-doctor.mjs` | 演示数据、初始化提示里的品牌 |

用这条命令找漏掉的：

```bash
grep -rn "木远\|LVANJU\|lvanju\|绿安居" app components lib services prisma scripts public --include=*.ts --include=*.tsx --include=*.mjs --include=*.json
```

### 1.3 产品库（重要）

部署脚本 `scripts/production-init.mjs` 每次 `build` / `start` 都会动产品库：

1. 产品库为空时，导入 `prisma/seed-product-os.ts` 里的 LVANJU 产品；
2. 每次部署都按 `prisma/catalog-2026.mjs` 校正 Y 系列；
3. 每次部署都按 `prisma/products-2026-run.ts` 补上缺的 2026 新品型号；
4. 按 `public/products/<型号>.jpg` 补登记主图。

给别的公司搭时，二选一：

- **换成客户的产品**：把这几个种子文件换成客户的产品数据，`public/products/` 换成客户的产品图；
- **产品库从空开始，让客户自己在页面录入**：在 `production-init.mjs` 里去掉第 1–3 步（否则删掉的 LVANJU 型号下次部署又会被补回来），并删掉 `public/products/` 里的图片。

### 1.4 其他业务口径（按需）

- 新 / 旧客户分界日期（现为 2026-10-01），见 [话术效果分析与工作日历 §12](OUTREACH_AND_WORKBENCH.md#12-新客户--旧客户分开2026-10-29)
- 节假日（`lib/holidays.ts`）、国家时区（`lib/country-timezone.ts`）
- 工作台月 / 周重心文字（`lib/workbench.ts`）

**确认：** 本地 `pnpm lint`、`pnpm build` 通过，页面上搜不到旧品牌。

---

## 阶段 2：服务器、数据库、域名

| 项 | 要求 |
| --- | --- |
| 运行环境 | Node.js ≥ 22、pnpm 11；Hostinger Node.js 托管（现有方案）或任意 VPS（用 pm2 / systemd 守护 + Nginx 反向代理） |
| 数据库 | 一个**空的** MySQL 8 或 MariaDB 11.8 库，字符集 utf8mb4；单独账号，只给这个库的权限 |
| 域名 | 必须 HTTPS。Meta / Gupshup 回调、手机 App 安装、浏览器推送、WhatsApp 本地同步扩展都要求 HTTPS |
| 附件目录 | 一个在部署目录之外、可写、会被备份的目录，给 `MEDIA_STORAGE_DIR`（客户发来的图片、语音、文件存这里，单个上限 32 MB） |
| 备份 | 数据库每日备份 + 附件目录备份，在上线前就配好 |

Hostinger 构建时有进程 / 线程数限制，`next.config.ts` 已默认只用 2 个构建进程；如果构建报 `os error 11`，不要调大 `NEXT_BUILD_CPUS`。

**确认：** 能用 `DATABASE_URL` 连上空库；域名打开是 HTTPS。

---

## 阶段 3：环境变量

完整说明见 `.env.example`。Hostinger 填在面板的 Environment variables；VPS 写在项目根目录 `.env`（不要提交到仓库）。

**第一组：不填就启动不了**

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | `mysql://用户:密码@主机:3306/库名` |
| `AUTH_SECRET` | 随机长字符串，登录签名和加密用；**上线后不要改**，改了已保存的加密数据会解不开 |
| `SEED_ADMIN_PASSWORD` | 首次部署创建管理员用的密码；之后部署不会重置 |
| `PUBLIC_APP_URL` | `https://客户域名`，不带结尾 `/` |
| `MEDIA_STORAGE_DIR` | 阶段 2 准备的附件目录 |
| `DEFAULT_TIMEZONE`、`DEFAULT_CURRENCY` | 首次建库时写入公司设置 |
| `COOKIE_SECURE` | 反向代理没传 `x-forwarded-proto` 时设 `true` |

**第二组：密钥，各自随机，不要互相复用**

| 变量 | 用途 |
| --- | --- |
| `WEBHOOK_SECRET` | 通用询盘接口 `/api/leads/webhook`（官网表单等） |
| `META_SYNC_SECRET` | 所有定时任务的密钥 |
| `GUPSHUP_WEBHOOK_SECRET` | Gupshup 回调密钥 |
| `META_LEAD_WEBHOOK_SECRET` | Meta 线索 Webhook 验证令牌 |
| `WHATSAPP_VERIFY_TOKEN` | 只在用 Meta 官方 WhatsApp Cloud API 时需要 |

生成随机串：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**第三组：按渠道填**（阶段 5 再填也可以，填完重新部署）

`GUPSHUP_*`、`META_*`、`DEEPSEEK_*`、`VAPID_*`、`WHATSAPP_DEFAULT_OWNER_EMAIL`，见阶段 5。

---

## 阶段 4：首次部署

### 4.1 构建和启动

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm build
```

```bash
pnpm start
```

Hostinger 上构建命令填 `pnpm build`，启动命令填 `pnpm start`。

`build` 和 `start` 都会先跑 `scripts/production-init.mjs`，它会：

1. 检查必填变量；
2. 有未解决的失败迁移就停止启动（不会自动修）；
3. `prisma migrate deploy` 建表 / 升级；
4. 首次创建管理员 `admin@example.com`（密码 = `SEED_ADMIN_PASSWORD`）和公司设置；
5. 产品库种子、产品图补登记、旧成交补订单、有效口径修正（见 1.3）；
6. 打印 Meta 相关变量是否配置（只说有没有，不打印值）。

**不要**在生产库跑 `pnpm db:seed`（演示数据）、`pnpm test`、`pnpm test:smoke`。

### 4.2 首次登录后

1. 用 `admin@example.com` 登录，立刻改密码；
2. 「设置 → 公司设置」：公司名、货币、时区；
3. 「团队」：给每个销售建账号；
4. 「团队」页选新线索分配方式（待分配池 / 轮流分配）；
5. 「目标」：设年度目标（月 / 周自动拆分）；
6. 「产品库」：核对或录入产品、价格、包装；「运费库」录目的国运价；「报价设置」核对报价单模板。

**确认：** 管理员、销售都能登录；销售只看得到自己的客户；能手工建客户、做一张报价单并导出 PDF。

---

## 阶段 5：接外部渠道

建议按这个顺序接，每接一个就验一个。

### 5.1 WhatsApp（Gupshup）

1. 填 `GUPSHUP_API_KEY`、`GUPSHUP_SOURCE`（业务号码，不带 `+`）、`GUPSHUP_APP_NAME`、`GUPSHUP_APP_ID`、`GUPSHUP_WEBHOOK_SECRET`、`WHATSAPP_DEFAULT_OWNER_EMAIL`；
2. Gupshup 后台 Callback URL：`https://客户域名/api/whatsapp/webhook?token=<GUPSHUP_WEBHOOK_SECRET>`，订阅 message 和 message-event；
3. 在 Gupshup 提交首联模板，模板名和 1.2 改过的前缀一致；
4. 重新部署。

**确认：** 用一部手机给业务号发消息 → 「消息」页出现、自动建客户；在 CRM 回复 → 手机收到；`/settings/integrations/whatsapp` 显示已连接。

详见 [WhatsApp V2 部署](whatsapp-v2-deployment.md)、[消息中心](MESSAGE_CENTER.md)、[Gupshup CTWA](GUPSHUP_CTWA_IMPLEMENTATION.md)。

### 5.2 Meta 广告表单线索

1. 填 `META_APP_ID`、`META_APP_SECRET`、`META_LEAD_WEBHOOK_SECRET`、`META_PAGE_ACCESS_TOKEN`、`META_PAGE_ID`；
2. Meta 开发者后台：App 切到 Live；Webhooks → Page 订阅 `leadgen`；回调 `https://客户域名/api/leads/webhook`，验证令牌 = `META_LEAD_WEBHOOK_SECRET`；
3. 在本机用客户的变量跑诊断：

```bash
pnpm meta:doctor
```

**确认：** 用 Meta 的 Lead Ads 测试工具提交一条 → 客户列表出现并分配。

详见 [Meta Lead Ads](META_LEAD_ADS.md)。

### 5.3 Meta 广告数据同步

填 `META_AD_ACCOUNT_ID`、`META_ADS_ACCESS_TOKEN`，在设置页点一次手动同步。

**确认：** 「广告效果」有花费、展示、点击。详见 [Meta 广告同步](META_ADS_SYNC.md)。

### 5.4 AI（DeepSeek）

填 `DEEPSEEK_API_KEY`（`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` 用默认值即可）。

**确认：** 消息页外语自动出中文，「优化话术」能出 3 条。

### 5.5 手机 App 与推送

`VAPID_*` 可以不填，首次使用自动生成。让每个销售用手机打开 HTTPS 域名 → 安装到桌面 → 点「开启通知」。详见 [手机 App](MOBILE_APP.md)。

### 5.6 可选

- WhatsApp Web 本地同步扩展（销售用个人号聊天也同步进来）：[本地同步](WHATSAPP_WEB_LOCAL_SYNC.md)
- 官网表单接入：`POST /api/leads/webhook` + 请求头 `x-webhook-secret`，见 README「Webhook 调用」
- 广告转化回传：确认 Dataset 权限后再开 `META_FEEDBACK_ENABLED=true`，见 [身份链](IDENTITY_CHAIN.md)

---

## 阶段 6：定时任务

所有定时任务都用 `META_SYNC_SECRET`。Hostinger 在面板 → 高级 → Cron Jobs 添加；VPS 用 crontab。

| 频率 | 命令 | 作用 |
| --- | --- | --- |
| 每 5 分钟 | `curl -fsS -X POST -H "x-cron-secret: <META_SYNC_SECRET>" https://客户域名/api/cron/meta-leads` | 补拉漏掉的 Meta 线索、补发提醒、重试 WhatsApp 回调、话术引擎、21:30 复盘提醒 |
| 每小时 | `curl -fsS -X POST -H "x-cron-secret: <META_SYNC_SECRET>" https://客户域名/api/cron/workflows` | 自动任务兜底、每周一话术结论 |
| 每 6 小时 | `curl -fsS "https://客户域名/api/cron/meta-sync?secret=<META_SYNC_SECRET>"` | 广告数据和表单目录同步 |
| 每 5–15 分钟 | `curl -fsS -X POST -H "x-cron-secret: <META_SYNC_SECRET>" -H "Content-Type: application/json" -d '{"kind":"leads"}' https://客户域名/api/cron/identity-chain` | 身份链后台处理；`kind` 可分别调度 leads / analysis / feedback，每天一次 daily；不要高频跑 `all` |

没接 Meta 的客户，`meta-sync` 可以不配，其余三个建议都配。

**确认：** 手动执行一次每条命令，返回 200。

---

## 阶段 7：验收与交付

### 7.1 上线验收清单

- [ ] 管理员、销售登录；销售只能看到自己的客户
- [ ] 手机发 WhatsApp → 自动建客户 → CRM 回复 → 手机收到 → 回执状态更新
- [ ] 客户发图片 / 语音 → CRM 能打开（附件目录可写）
- [ ] Meta 测试线索 → 进入客户列表 → 分配 → 销售手机收到推送
- [ ] 报价单：中文 / 英文 PDF 抬头是客户的公司和 Logo
- [ ] AI：翻译、优化话术可用，回复里公司名正确
- [ ] 4 个 Cron 返回 200
- [ ] 数据库备份已跑过一次，并试过恢复到一个副本
- [ ] 页面上找不到 LVANJU / 木远

### 7.2 交给客户的东西

1. 访问地址、管理员账号（让客户自己改密码）；
2. 各渠道账号的归属说明（Gupshup、Meta App、DeepSeek 都应在客户自己名下）；
3. 销售使用说明：消息页、待处理、报价单、手机安装与通知；
4. 管理员使用说明：分配线索、目标、经营总览各页口径（[指标口径](METRICS.md)）；
5. 一份本客户的配置记录（填了哪些变量、回调地址、Cron；**不写密钥值**）。

---

## 长期：升级与运维

**升级（从主仓库合并新版本）：**

1. 备份数据库和附件目录；
2. 主仓库的新提交合并到客户仓库，解决品牌文件的冲突（1.2 那张表的文件最容易冲突）；
3. 先用数据库副本跑一遍 `pnpm build`，确认迁移成功；
4. 正式部署：`pnpm build` → 重启。迁移都是只加不删，回滚代码时保留新增的表和列。

**出问题先看：**

| 现象 | 先查 |
| --- | --- |
| 启动停住，提示失败迁移 | 对照备份和实际表结构手工处理，不要直接删迁移记录 |
| Meta 线索不进来 | `pnpm meta:doctor`；平台日志搜 `[meta-lead]`；[Meta Lead Ads 排查](META_LEAD_ADS.md) |
| WhatsApp 收不到 | Gupshup Callback URL 和 token；`/admin/integration-debug`；[Gupshup 诊断](GUPSHUP_URL_DIAGNOSTIC.md) |
| 推送收不到 | 是否 HTTPS、手机是否点过「开启通知」 |
| 构建报 `os error 11` | Hostinger 线程限制，见阶段 2 |

---

## 下一步可以做的：减少每个客户的改码工作

现在给一家新公司搭，主要工作量在阶段 1（品牌、产品、AI 提示词、模板名都写死在代码里），而且每次升级都要重新合并这些改动。如果打算长期给多家公司搭，值得把它们挪到「公司设置」或环境变量里：品牌名 / Logo / 报价单抬头、AI 提示词里的公司介绍、模板名前缀、首个管理员邮箱，以及「产品种子要不要跑」的开关。改完后新客户只需要走阶段 2–7。
