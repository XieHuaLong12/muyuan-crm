# 消息中心（WhatsApp 聊天窗口）

入口：侧边栏「消息」`/messages`，客户档案顶部「WhatsApp 聊天」。效果图评审后按此实现（2026-10-14）。

## 1. 需求理解

- 在 CRM 里用公司 WhatsApp 业务号（Gupshup）和客户聊天，像 WhatsApp 一样：左侧会话列表、中间聊天、右侧客户资料。
- 销售和管理员都用这个窗口：销售只看自己负责的客户，管理员看全部并可按负责人筛选。
- 必须能收到客户发来的文字、图片、视频、文件和语音，并且以后还能打开（服务商的下载链接会过期）。
- 新消息要提醒：侧边栏未读数、站内提醒、提示音，以及允许后的桌面/手机通知。

## 2. 对 LVANJU BOS 的影响

- 属于 Sales OS 的沟通环节；客户身份、负责人、阶段和任务仍由原有 CRM 决定，消息中心只读写 WhatsApp 消息。
- 取代 2026-10-06「销售不提供聊天工作台」的约定（见 [角色工作空间](ROLE_WORKSPACES.md) 文末修订），管理员只读的「沟通监督」保留。
- 业务红线不变：AI 只生成草稿，必须人工点击发送；模板消息由人选择、预览后发送；客户退订后不再发送。

## 3. 涉及模块

| 层 | 文件 |
| --- | --- |
| 页面 | `app/messages/page.tsx`、`components/messages/*`、`app/messages.css` |
| 导航与提醒 | `lib/role-workspace.ts`、`components/ui/Sidebar.tsx`、`components/bos/BOSShell.tsx`、`components/live-notifications.tsx`、`services/notification-service.ts` |
| 服务 | 新增 `services/inbox-service.ts`、`services/whatsapp-template-service.ts`；修改 `services/whatsapp-media-service.ts`、`services/whatsapp-message-service.ts`、`services/whatsapp-webhook-service.ts`、`services/webhook-receipt-service.ts`、`lib/gupshup.ts` |
| 接口 | 新增 `/api/inbox/{conversations,thread,translate,link}`、`/api/whatsapp/templates`、`/api/whatsapp/messages/[id]/media`；修改 `/api/whatsapp/{send,messages,media,ai-reply}` 与 `/api/whatsapp/media/[id]` |
| 客户档案 | `components/customer-detail.tsx` 增加「WhatsApp 聊天」按钮 |

## 4. 数据变化

没有新表、新字段或迁移。

- 客户发来的媒体复制为 `MediaAsset`（`createdBy='SYSTEM'`，文件写入 `MEDIA_STORAGE_DIR`），并把该消息的 `mediaUrl` 改为 `/api/whatsapp/media/<assetId>`。服务商原始链接仍在 `raw` 里。
- 未读使用已有的 `WhatsAppReadState`（每人每客户一行），打开会话即写入。
- 模板清单每次从 Gupshup 读取（缓存 5 分钟），不在本地编造或保存。模板消息存为 `messageType='TEMPLATE'` 的出站消息，`raw` 只记模板 id、名称和语言。

## 5. 接口变化

返回结构仍为 `{success,data}`，入参都在 service 里经 Zod 校验。

| 接口 | 作用 | 权限 |
| --- | --- | --- |
| `GET /api/inbox/conversations?filter=all\|unread\|awaiting\|unmatched\|pending&q=&ownerId=&page=` | 会话列表（每页 30）；`pending` 是待首联客户，返回在 `pending` 里；每种筛选都带 `pendingTotal` | 登录；销售只看自己；`unmatched` 仅管理员 |
| `GET /api/inbox/thread?customerId=&before=` | 聊天记录（每页 50）、客户资料、下一步任务、阶段变化、能否发送 | 客户负责人或管理员 |
| `POST /api/inbox/translate {messageId}` | 按需把一条客户消息译成中文（使用线索导入里配置的翻译服务；没有配置时用 DeepSeek） | 同上 |
| `POST /api/inbox/translate-out {customerId,text}` | 把销售写的中文译成客户的语言，结果放回输入框，不发送（需要 DeepSeek） | 同上 |
| `GET/POST /api/inbox/link` | 未关联号码的候选客户 / 关联 | 管理员 |
| `GET /api/whatsapp/templates?customerId=` · `POST {customerId,templateId,params,requestId}` | 已审核文字模板清单（还没联系过的广告线索另带 `suggestion`：推荐的首条模板和已填好的变量）/ 发送模板 | 客户负责人或管理员 |
| `GET /api/whatsapp/messages/[id]/media` | 打开一条客户消息里的文件；未保存过就先从服务商下载 | 客户负责人或管理员 |
| `POST /api/whatsapp/send`、`GET /api/whatsapp/messages`、`POST /api/whatsapp/media`、`POST /api/whatsapp/ai-reply` | 原有接口，由“仅管理员”改为按客户负责人限制 | 客户负责人或管理员 |

`/api/whatsapp/media/[id]` 支持 `Range`（Safari 播放语音和视频需要），只有图片、音频、MP4/3GP 视频在页面内显示，其他类型（含 SVG、HTML、Office）一律作为下载，并加 `Content-Security-Policy: sandbox`。

## 6. 界面

按效果图实现：会话列表显示国家代码、公司、阶段或“首联超时 / 窗口剩 N 小时”、最后一条消息、已读勾、未读数；筛选「全部 / 未读 / 待我回复」，管理员另有负责人下拉和「未关联 N」。聊天区显示日期分隔、图片、视频、语音播放器、文件卡片、模板消息标记、按需翻译；顶部显示 24 小时窗口剩余时间。输入区有图片/文件、AI 草稿、模板消息、报价单、跟进任务；窗口关闭或客户从未通过业务号联系时，只能发送已审核模板。右侧客户资料显示阶段进度、意向产品、来源、负责人、下一步任务和阶段变化。2026-10-14 起加入聊天副驾：AI 草稿带产品库和中文意思、按对话生成报价单、译成客户语言、AI 摘要，见 [管理与销售工作空间](ROLE_WORKSPACES.md#聊天副驾消息中心)。

页面没有使用通用的大标题 `Header`：按评审通过的效果图，标题「消息」放在会话列表顶部，让聊天区占满屏幕高度。宽度不足 1400px 时客户资料改为右侧浮层；手机宽度（≤760px）列表和聊天单栏切换，带返回按钮。在消息中心页面里，新消息不再弹出站内提醒卡片（列表已经显示），但仍有提示音；页面在后台时照常发桌面通知。

### 待首联与首条模板（2026-10-17）

筛选里加了「待首联 N」：分配给自己、还没联系过的客户，和「今日工作 · 新分配 · 待首联」、顶部「待首联」用同一个判断（`queueFilters().new`），三处数字一致；待分配池里的客户不在其中。这些客户大多还没有任何聊天记录，所以这个筛选直接查客户表，而不是会话表。排序和今日工作相同：已超时的在前，再按表单等级和首联期限。每行显示国家、来源、表单等级、首联剩余或超时时间、意向产品和客户类型；管理员看到全部销售的客户并显示负责人，可以用负责人下拉筛选。

从待首联点开客户，如果只能发模板，模板面板自动展开并选好首条模板：来源 Facebook 用 `lvanju_hi_fb_*`、Instagram 用 `lvanju_hi_ig_*`，还没审核通过时退回 `lvanju_first_fb_*` / `lvanju_first_ig_*`，按客户语言优先（`FIRST_TOUCH_TEMPLATES`）。三个变量按客户资料填好：`{{1}}` 姓名的第一个词，`{{2}}` 负责人，`{{3}}` 按广告名和表单答案判断的产品线（压缩沙发 / 真空压缩床垫 / 智能电动床垫，见 `FIRST_TOUCH_PRODUCT_LINES`）。判断不出产品线时留空，销售点下面的产品线按钮选一个；有空变量时不能发送。只有英文模板会自动填产品线。

模板仍由销售核对后点「发送模板」，系统不会自动发出（业务红线不变）。发出后记为首次联系，客户离开待首联，列表自动打开下一位。

### 全屏聊天（2026-10-17）

聊天区标题栏的全屏按钮让整个消息中心（会话列表、聊天、客户资料）铺满窗口，工作台的侧边栏和顶栏让开；再点一次、按 Esc，或在没有打开会话时点「退出全屏」退出。新线索提醒仍显示在最上层。

会话列表标题旁的折叠按钮把列表收成一列头像（未读数、首联超时的红点照常显示），点头像切换会话，点展开按钮恢复；全屏和普通模式都能用，浏览器会记住上次的选择。手机宽度不收起。

### 客户发来消息时怎样找到客户（2026-10-14 修订）

1. 按号码在客户中心查找：电话、WhatsApp 字段里带 `+`、不带 `+`、带 `00`、有空格或横线都算同一个号码，比较的是完整的国际号码数字，不按尾号或猜测国家。
2. 回收站里（已删除）的客户不算。号码只属于已删除客户时，当作新号码处理。
3. 找到一位客户：消息直接归入。找不到：自动新建客户，负责人按「新线索分配方式」决定。找到多位客户：进入「未关联」，由管理员选择。
4. 修订前已经卡在「未关联」的消息，管理员在消息中心「未关联」里点「重新匹配」即可按新规则处理：新号码建客户，唯一匹配的直接归入，并打开 24 小时回复窗口。

上线时发现的问题：测试号码之前对应的客户已被删除，旧规则把它当成“号码冲突”，消息停在待认领，既没有归入也没有新建客户；另外电话字段里没写 `+` 的号码匹配不到。

### 未读规则

一条客户消息在以下条件都满足时算未读：来自实时渠道（Gupshup 或 Cloud API；本地同步的历史记录只是存档，永远不算未读），晚于自己最后一次打开这个会话，并且晚于我方最后一次回复（回复过就说明已经看过）。管理员打开会话不会清掉销售的未读。侧边栏数字与新消息提醒只统计自己负责的客户，管理员也一样。

### 收到的媒体

| 来源 | 文件位置 | 处理 |
| --- | --- | --- |
| Gupshup V2 回调 | `payload.url`（附 `contentType`、`urlExpiry`） | Webhook 处理完立即下载保存 |
| Gupshup V3（Meta 格式）回调 | `<type>.url`，旁边是 Meta 的媒体 id | 同上 |
| Meta Cloud API 直连 | 只有媒体 id | 用已连接账号的令牌经 Graph API 取下载地址 |

后台下载失败时，有人打开这条消息会再试一次；仍然失败就显示“文件已过期或无法下载，请在手机 WhatsApp 中查看”。只从 Gupshup、Meta、WhatsApp 的域名下载，重定向必须保持 HTTPS 且不能指向 IP 地址；单个文件上限 32 MB。

## 7. 上线与验证

### 上线前需要的配置

| 变量 | 用途 |
| --- | --- |
| `GUPSHUP_API_KEY`、`GUPSHUP_APP_NAME`、`GUPSHUP_SOURCE_NUMBER`（或 `GUPSHUP_SOURCE`）、`GUPSHUP_WEBHOOK_SECRET` | 已有：收发消息。不配置时消息中心只能查看记录 |
| `GUPSHUP_APP_ID` | 新用途：读取已审核模板。它同时会用来核对 V3 回调的 `gs_app_id`，必须填 Gupshup 后台的真实 App ID |
| `MEDIA_STORAGE_DIR` | 已有：附件目录。现在也保存客户发来的文件，需放在部署目录之外并有足够空间 |
| `PUBLIC_APP_URL` | 已有：发送附件时给 Gupshup 的公开地址 |

Gupshup 后台需订阅入站消息和送达/已读回执，回调地址 `/api/whatsapp/webhook?token=<GUPSHUP_WEBHOOK_SECRET>`。模板要在 Gupshup 后台创建并等 Meta 审核通过；目前只支持纯文字模板（带图片头的模板需要审核时的那张图，后续再做）。

### 本次验证（本机隔离 `_test` 库：MariaDB 10.11、MariaDB 11.8、MySQL 8.4）

- 三种数据库上全部 159 项测试通过。会话列表与未读数的 SQL 只用 JOIN + GROUP BY：MariaDB 11 不接受引用派生表字段的相关子查询（错误 1054），不要改回子查询写法。
- 新增 `tests/message-center.test.ts` 6 项（媒体下载与去重、Range 播放、超大/过期/外部域名/不安全重定向被拒、V3 媒体链接、销售范围与未读规则、通知、管理员关联共用号码、模板清单与发送幂等、窗口外禁止自由文本、退订后禁止模板）。
- ESLint、`tsc --noEmit`、`next build` 通过。
- 用本地演示数据在浏览器检查销售与管理员视角：1440、1280 桌面和 390 手机宽度，无横向溢出；图片、语音播放器、过期文件提示、未读数和侧边栏角标正常。
- 未连接真实 Gupshup：真实入站媒体、模板清单接口返回格式与模板发送需要在生产号码上各验收一次（先发一张图片和一段语音给业务号，确认能在消息中心打开）。

### 回退

回退代码即可，没有迁移需要处理。已保存的媒体文件和 `MediaAsset` 记录保留，旧版本仍能通过 `/api/whatsapp/media/<id>` 打开。
