# WhatsApp CRM V2 — Hostinger 部署

使用 Node.js 22+、MySQL 和持久运行的 Next.js 服务。客户详情桌面为 60% 资料 + 40% 聊天，小屏幕改为上下布局。消息每 5 秒同步，支持加载更早记录。API 无法获知客户在线状态，因此界面明确显示“在线状态未知”。AI 只生成可编辑建议，由销售点击发送。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | 必填，`mysql://用户:URL编码的密码@主机:3306/数据库` |
| `AUTH_SECRET` | 必填，保留现有登录签名密钥 |
| `SEED_ADMIN_PASSWORD` | 当前启动脚本必填；启动时会更新 admin@example.com 密码 |
| `GUPSHUP_API_KEY` | Gupshup 发送 API 密钥，仅服务端 |
| `GUPSHUP_SOURCE` | 已注册的商家 WhatsApp 号码，国家码 + 数字，不含 `+` |
| `GUPSHUP_APP_NAME` | Gupshup 应用名称，必须与 webhook 的 app 一致 |
| `GUPSHUP_WEBHOOK_SECRET` | 建议设置随机密钥；同步将 Gupshup Callback URL 设置为 `https://域名/api/whatsapp/webhook?token=该密钥`。也支持 `x-webhook-secret` 请求头。未设置时兼容原有回调 |
| `DEEPSEEK_API_KEY` | AI 回复和自动阶段判断必填 |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 延用项目默认 `deepseek-flash`；按账户可用模型配置 |
| `WHATSAPP_DEFAULT_OWNER_EMAIL` | 新客户默认负责人，未匹配时使用最早创建的管理员 |
| `DEFAULT_TIMEZONE` / `DEFAULT_CURRENCY` | 默认 `Asia/Shanghai` / `CNY` |

原有 `WEBHOOK_SECRET`、`META_APP_ID`、`META_APP_SECRET`、`META_EMBEDDED_SIGNUP_CONFIG_ID`、`META_GRAPH_VERSION`、`WHATSAPP_VERIFY_TOKEN` 等按原配置保留。仅使用 Gupshup 不要求新增 Meta 凭据。任何服务端密钥都不要加 `NEXT_PUBLIC_` 前缀。

## 数据库升级：保留现有数据

原仓库 schema 是 MySQL，但旧迁移仍是 SQLite。旧文件已原样移至 `prisma/legacy-sqlite-migrations/`，MySQL 使用新基线 + V2 增量迁移。历史消息 `text` 数据列保留，通过 Prisma 的 `content @map("text")` 读取；不会清空消息或客户。

先备份生产数据库。已有通过 `db push` 创建的 V1 MySQL 数据库，在首次部署此版本前运行：

```sh
pnpm install --no-frozen-lockfile
node scripts/baseline-mysql.mjs
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

基线脚本先对比现有库与旧版 schema，只有一致才登记基线，不执行创建或删除业务表。若检测到差异会停止，请根据差异核实；不要使用 `migrate reset` 或 `--accept-data-loss`。如果数据库已有非 MySQL 的迁移登记，需要先人工核实迁移历史，不要盲目登记。

全新空 MySQL 库无需基线登记，直接 `pnpm exec prisma migrate deploy` 即可。Hostinger 构建命令 `pnpm build`、启动命令 `pnpm start`；启动初始化现改用 `migrate deploy`，不再通过 `db push` 绕过迁移。

## 接入与验收

在 Gupshup 配置 Callback URL，订阅 message 和 message-event 回调。发送端使用官方 `POST https://api.gupshup.io/wa/api/v1/msg`；表单包含 channel/source/destination/src.name/message，密钥通过 apikey header 提交。仅支持会话内文本发送，客户最近入站消息超过 24 小时会提示使用审核模板；本版本未实现模板发送。

API：`GET /api/whatsapp/messages?customerId=...&before=...`；`POST /api/whatsapp/send` 接收 customerId/content/requestId（UUID）；`POST /api/whatsapp/ai-reply` 接收 customerId。全部复用 CRM 登录与负责人权限。

发送成功后记录 SENT，表示提供商已接受；后续回调更新 DELIVERED / READ / FAILED。网络超时记录 UNKNOWN，不自动重发。使用同一 requestId 查询/重试不会重复调用提供商。若提供商已接收但保存结果时数据库不可用，记录可能停在 PENDING；应人工核对提供商记录后处理，避免重复发送。

自动阶段支持 NEW、CONTACTED、QUOTED、FOLLOW_UP、ORDER、LOST。ORDER 是确认采购，WON 仍由真实成交订单驱动，不虚增营收。低置信度、缺少客户原话证据、阶段倒退、并发人工修改不会覆盖客户阶段；WON/INVALID/PAUSED/ORDER/LOST 保留，后续可以人工调整。保留原有 AI 客户分析功能。

入库成功后使用 Next.js after 执行阶段分析，不阻塞 webhook 响应。AI 失败不会影响已存消息；aiProcessedAt 保留为空，后续客户消息或重复 webhook 会重试。当前未增加独立定时重试任务。DeepSeek 未配置时仍可正常收发消息。

官方协议参考：[Gupshup 入站消息](https://docs.gupshup.io/docs/what-is-an-inbound-message)、[发送 API](https://docs.gupshup.io/reference/msg)、[消息回执](https://docs.gupshup.io/docs/message-events)。
