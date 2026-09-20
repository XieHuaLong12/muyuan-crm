# Sales Workspace V3

## 每天怎么用

1. 打开 Today，看待回复、未读、今日任务、待发送报价与逾期待办。优先客户结合 AI 评分、采购意向、消息时间、逾期和预估金额排序。
2. 点击客户进入固定工作区。桌面左侧 35% 客户列表、右侧 65% 工作台；聊天、资料、跟进、报价、订单和任务使用页内标签。
3. 右侧 AI Reply Assistant 生成最近 20 条对话的建议，可复制、编辑或明确点击发送。AI 不自动对外发送，也不编造价格、MOQ 或交期。
4. 在任务中心添加截止时间和提前提醒，勾选即完成，保存失败自动回滚。可切换今天、逾期、已完成，修改任务状态或删除任务。
5. 订单标签内记录“样品已寄出”“开始生产”“付款安排”，自动生成签收回访、生产进度、出货前质检、发货追踪或付款待办。
6. 客户列表右上角“…”打开原客户表格，批量操作、导入、回收站仍可用。漏斗、目标、分析、设置继续使用已有业务逻辑。

## 自动提醒的边界

- 未处理的客户入站消息：在入站时间 + 24 小时到期；成功回复后完成这条自动任务。
- 已登记发送的报价：发送时间 + 3 天到期；收到之后的客户消息会关闭报价催办。
- 提前提醒默认 30 分钟，支持到期时、15 分钟、30 分钟、1 小时、1 天。
- 完成任务关闭提醒；重新打开会重新安排。已删除的自动任务保留去重键，不会在下一次同步时重新出现。
- 通知每 30 秒同步、首页每 60 秒同步、聊天每 5 秒同步。切换后台时聊天暂停请求；新消息只更新消息区。
- 提醒时间保存在数据库中，CRM 打开时显示通知与首页提示。当前版本不发送浏览器系统推送、邮件或 WhatsApp 催办；关掉 CRM 后不会弹出系统通知。
- DeepSeek 只有在置信度达到 80 且有客户原话证据时创建下一步任务；同一事件以及已有同类型未完成 AI 任务会去重。实际报价、付款、生产和发货节点由业务人员确认。
- Gupshup 不提供这里需要的真实在线状态，因此显示“在线状态未知”，不伪造在线标记。

## 技术结构

Server Components 为首页、客户详情、任务中心和 WhatsApp 路由加载初始数据；客户端负责局部搜索、选中态、轮询和操作。客户详情缓存仅在当前工作区有效。任务更新携带 updatedAt，冲突返回 409，不覆盖他人的更改。

UI 位于 components/workspace：SalesDashboard、TaskCenter、CustomerWorkbench、WhatsAppWorkspace、AIReplyPanel、WorkspaceShell、QuotationPanel。app/workspace-v3.css 统一 #F7F8F6 背景、深绿主色、16px 卡片和轻阴影，支持 prefers-reduced-motion。Inter 从字体作者 rsms.me 加载，失败立即使用系统字体，不阻塞页面。

Task / Reminder 是核心持久化模型。Quotation、WorkflowEvent、MediaAsset、WhatsAppReadState 支撑真实报价、节点自动化、附件和每用户未读状态。自动化使用唯一 automationKey 防止重复；自动任务删除采用 tombstone。所有业务接口使用现有登录及客户归属检查。

新增接口：

| 接口 | 功能 |
| --- | --- |
| GET /api/tasks | 状态/日期/客户过滤及游标分页 |
| POST /api/tasks | 新建任务 |
| PATCH 或 PUT /api/tasks/:id | 编辑与状态变更 |
| POST /api/tasks/:id/complete | 完成任务 |
| DELETE /api/tasks/:id | 删除任务 |
| GET /api/reminders | 当前用户到期提醒 |
| PATCH /api/reminders/:id | 忽略同任务已到期的提醒 |
| GET /api/sales-workspace | 首页局部同步 |
| GET /api/workspace-customers | 客户摘要局部同步 |
| POST /api/workflow-events | 记录业务节点并创建任务 |
| GET/POST /api/quotations | 查询/保存报价草稿 |
| PATCH /api/quotations/:id | 登记报价已发送 |
| POST /api/whatsapp/media | 鉴权附件上传 |
| GET /api/whatsapp/media/:id | 鉴权或带签名的附件访问 |
| POST /api/whatsapp/read | 每用户已读游标 |

## 合并和部署

合并 feature/apple-sales-workbench-v3 到 main 后，由现有部署流程构建。`npm run build` 和启动脚本继续运行 production-init：自动执行 Prisma migrate deploy。新增迁移为 `20260920090000_sales_workbench_v3`，只增加表和可空媒体字段；不清空现有客户、消息或订单。旧 V1 MySQL 和已迁移 V2 数据库均沿用已有升级入口。

继续保留已部署 V2 的环境变量：

- DATABASE_URL：MySQL 连接。
- AUTH_SECRET、SEED_ADMIN_PASSWORD：原有登录/初始化配置，不在升级时换值。
- DEEPSEEK_API_KEY；可选 DEEPSEEK_BASE_URL、DEEPSEEK_MODEL。
- GUPSHUP_API_KEY、GUPSHUP_SOURCE、GUPSHUP_APP_NAME，以及已启用的 GUPSHUP_WEBHOOK_SECRET。
- WEBHOOK_SECRET、WHATSAPP_DEFAULT_OWNER_EMAIL、DEFAULT_TIMEZONE、DEFAULT_CURRENCY 按现有配置保留。
- 若使用 Meta 共存连接，保留现有 META_* 与 WHATSAPP_VERIFY_TOKEN 等设置。

V3 附件新增配置：

| 环境变量 | 配置 |
| --- | --- |
| PUBLIC_APP_URL | CRM 对外 HTTPS 源地址，例如 https://crm.example.com，不带路径；代理环境建议明确填写 |
| MEDIA_STORAGE_DIR | 可写、持久化的绝对目录，必须在部署版本目录之外，避免重新部署丢失附件；多实例须共享此目录 |

未配置 MEDIA_STORAGE_DIR 时使用项目下 uploads/whatsapp，适用于本机开发；生产环境不要依赖临时构建目录。附件签名沿用 AUTH_SECRET，有效期 7 天，仅为供应商抓取文件提供访问；普通工作台访问仍验证登录和客户归属。

PNG/JPEG 图片最多 5 MB，支持的音频和 MP4 最多 16 MB，普通文件最多 20 MB。WebP/GIF/WAV/未明确 Opus 的 OGG 作为普通文件发送。音频不能附带文本说明，需单独发送文字。PDF 支持文件卡片查看/下载；报价可使用浏览器打印另存为 PDF。音频支持播放与附件上传，没有麦克风录音功能。Gupshup 入站媒体链接可能过期，本版不永久归档供应商附件。

供应商格式依据：[Gupshup 发送消息](https://docs.gupshup.io/reference/msg)、[入站媒体](https://docs.gupshup.io/docs/media)。

## 验证

CI 使用 MySQL 8.4 验证原有数据库自动升级、重复初始化不覆盖原有用户、全量迁移、单元及数据库集成测试、ESLint、严格 TypeScript、npm run build。新增覆盖任务权限、冲突保护、完成/重开提醒、自动化去重、删除后不重建、样品/生产节点、媒体签名和 AI 任务生成。

浏览器使用真实 React 组件和隔离模拟数据验证视觉及交互，不连接线上 CRM，不向客户发送测试消息。视觉验收记录见项目根目录 design-qa.md。CI 的数据库测试不使用 UI 模拟数据。

## 后续扩展接口

V3 保留清晰的服务边界：TaskService 负责任务状态与权限，WorkflowService 负责事件规则，WhatsApp services 负责消息与 AI。未来如需要关掉网页仍推送提醒，可在同一 Reminder 表上增加独立调度器与已投递状态；当前无需额外 cron 或队列服务。
