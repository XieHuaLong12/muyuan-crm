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
| `GET /api/whatsapp/templates?customerId=` · `POST {customerId,templateId,params,requestId}` | 已审核文字模板清单，`fills` 是每个模板按客户资料填好的变量（值、来源、为什么空着）；还没联系过的广告线索另带 `suggestion`（推荐的首条模板）/ 发送模板 | 客户负责人或管理员 |
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

### 模板变量自动填写（2026-10-17）

Gupshup 的变量只有编号，系统看变量前后的文字判断它是什么（`variableSources`），再从客户资料取值（`fillVariables`），所有模板、所有客户都适用：

| 模板里写的 | 认作 | 取自 |
| --- | --- | --- |
| `Hi / Hello / Dear / Bonjour ___` | 客户名 | 姓名的第一个词（全大写或全小写时改成首字母大写） |
| `it's ___ from`、`___ here`、`c'est ___` | 负责销售 | 负责人 |
| `ad for / about ___`、`publicité … pour ___`、`quotation for ___` | 产品线 | 广告名和表单答案（只给英文模板填） |
| `quotation ___` | 报价单号 | 最近一份已发出的报价单（草稿不算） |
| `your order ___` | 订单号 | 最近一笔未取消的订单 |
| `delivery date is ___`、`arrive on ___` | 预计送达日期 | 该订单的预计送达，按业务时区写成英文日期（November 20, 2026） |

每个变量标出来源：「自动 · 客户名」、资料里没有时说明缺什么（比如还没有订单）、认不出时显示「未识别」，销售改过的显示「已手动修改」并可「恢复自动」。模板列表显示每个模板是否已填好；打开模板面板时，右侧客户资料标出被用到的字段。有空变量仍不能发送，仍由销售点击发送。认不出的变量由销售填写；以后如需让管理员给变量指定来源，需要新增一张表（未做）。

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

### 销售阶段、客户标签与待处理（2026-10-30）

设计稿经确认后实现，三处都在消息页里完成，不用再跳回客户中心。

**销售阶段可以直接点**（`components/messages/StageControl.tsx`）。客户资料里的进度条，7 步（新线索 → 成交）每一步都是按钮，点哪步就改到哪步，往回点也可以；改完出现「撤销」，6 秒内可以改回去。「其他阶段」里是已发目录、已确认款式、确认采购，以及结束跟进的暂不需要、已流失、无效客户；后三个必须选原因（常用原因一点即选，可补一句），和看板同一规则。改阶段走看板的同一个接口（`PATCH /api/bos/crm-stage`，比较并替换，写阶段历史，进入已回复及之后的阶段自动标有效）。「成交」必须有成交记录，所以点它在面板里展开登记成交（金额、币种、日期、成本，`POST /api/customers/:id/deals`），保存后阶段由成交记录改为已成交；已成交的客户不能再点改。进度条下方显示最近一次是谁、什么时候改的（系统自动改的显示「系统」）。

**客户标签**（`services/customer-tag-service.ts`、`components/messages/Tags.tsx`）。全公司共用一套标签（`CustomerTag`），客户与标签的关系在 `CustomerTagLink`。颜色只能从 8 种里选（`lib/customer-tags.ts`，浅底深字，对比度都在 4.5:1 以上，有测试保证）。客户资料里「+ 标签」可以搜索已有标签、勾选或取消，也可以输入新名字、选颜色新建并贴上；同名只会有一个标签。会话列表每行在状态后面显示最多 2 个标签，多的显示「+n」；列表上方「全部标签」下拉只看贴了某个标签的客户（全部、待处理、待首联等每个筛选都生效）；搜索框也搜标签名。改名、换色、删除在「管理标签」里，只有管理员能做，改一次所有客户一起变，删除只是把标签从客户身上去掉。标签数量按各人能看到的客户统计。

**待处理**（`lib/todo.ts` 规则与理由，`services/todo-service.ts` 查询）。筛选第二个就是「待处理 N」，收这些客户：

1. A / B 线索首联已超时（和待首联同一个判断，只看 A / B）；
2. 客户在等你回复：最后一条是客户发的，且客户是 A / B 级或回复判为高意向（`bestReplyQuality = HIGH` 或 AI 判断高意向）；
3. 人约好的跟进（客户的「下次跟进」）或人建的任务今天到期或已过期；系统自动建的任务（回复提醒、话术跟进）不算，否则所有 C 类客户的例行提醒都会进来；
4. 报价发出超过 3 天客户没回音（和驾驶舱「报价超时」同一条规则 `staleQuotes`）；
5. 有人点了「标为待处理」的客户，到所选时间出现（`PendingMark`，每位客户一条）。

1–4 只算还在跟进的新客户（已成交、无效、已流失、暂不需要和旧客户不进来），和其他工作清单一致；手动标记对任何客户都有效。列表分三组：**已超时**（首联、约好的跟进或任务已过时间，或 A / B / 高意向客户等回复超过话术参数里的 `hotReplyHours`，默认 2 小时）、**今天要做**、**我标记的**；组内顺序和今日跟进同一套打分（`workPriority`）。每位客户下面写着进来的原因。自动进来的，条件没了就自动移出（回复了、改了跟进时间、完成了任务）；手动标的，点「处理完」移出（删除那条标记）。聊天顶部「标为待处理」可以写一句提醒、选现在 / 今天 18:00 / 明天 9:00 或任意时间；标好后聊天顶部一直显示这条提醒，带「改提醒」和「处理完」。按钮上的数字在每个筛选下都显示，按负责人筛选，不受标签和搜索影响。销售只看到自己的客户，管理员可按负责人筛选。`/messages?filter=todo` 直接打开待处理（`?filter=awaiting` 等同样可用）。

数据库：新增 `CustomerTag`、`CustomerTagLink`、`PendingMark` 三张表（迁移 `20261030090000_customer_tags_and_pending`，只加表）。接口：`GET /api/inbox/tags`，`PATCH|DELETE /api/inbox/tags/:id`（管理员），`POST|DELETE /api/inbox/customer-tags`，`POST|DELETE /api/inbox/todo-mark`；`GET /api/inbox/conversations` 增加 `filter=todo` 和 `tagId`，返回里多了 `todo`、`todoTotal` 和每行的 `tags`；`GET /api/inbox/thread` 多了 `tags`、`pendingMark`、阶段变化的 `by`。

### 客户等级、可调输入框、自动翻译、产品资料、常用回复（2026-10-30）

设计稿 ⑧–⑫ 经确认后一起实现。

**头像就是等级**（`components/messages/Grade.tsx`）。客户没有头像，会话列表、待首联、待处理、收起后的头像栏、聊天顶部和右侧资料里的头像都换成等级：A 橙、B 蓝（实心）、C 浅绿、D 灰，没评级是虚线「未评」（颜色核对过对比度）。鼠标停在列表头像上显示等级和依据（`leadGradeReason`），点头像仍然是打开聊天。待首联原来的「A 级」小标签去掉。聊天顶部名字后面加「B 类 · 优先跟进」。点顶部头像弹出：现在的等级、依据、谁定的（AI 判定 / 规则判定 / 人工调整 + 时间），A/B/C/D 点一下就改（记为人工调整，自动评级不再覆盖；可以改成 D），改完 6 秒内可以「撤销」，撤销把原等级、来源、理由、评级时间原样放回。AI 根据客户回复给出的等级建议（`OutreachReply.gradeSuggestion` 待处理）在头像右上角显示小圆点，弹层里直接「接受」或「不改」（不改记为 AI 判错，和人工复核页同一条记录）；接受和手动改都能撤销，撤销会把被处理掉的建议恢复成待处理。列表上方加「等级 A B C D 未评」筛选，可多选，和负责人、标签、待处理、待首联一起用。接口：`POST /api/outreach/grade` 的 `SET` 允许 D，`SET` / `ACCEPT` 返回 `undo`，新增 `UNDO`（只在这次改动仍是当前等级且 10 分钟内有效）；`GET /api/inbox/conversations` 增加 `grades=A,B,none`，每行多 `grade`、`gradeReason`；`GET /api/inbox/thread` 多 `gradeSuggestion` 和等级来源、时间。

**输入框可以调高度**（`components/messages/Composer.tsx`）。打字自动变高，最多约 8 行，再多在框里滚动，发出后回到原高度。输入框上沿有一条横杠，按住上下拖调高度（最矮两行，最高到聊天区一半多），也可以聚焦后用上下方向键调；高度记在这台电脑的浏览器里，双击横杠恢复默认。右上角「放大」占聊天区大半，适合写长消息：放大时 Enter 换行、⌘ / Ctrl + Enter 发送，再点一下还原。手机上不显示横杠（拖动容易和滚动冲突）。

**自动翻译**（`services/message-translation-service.ts`、`lib/message-translation.ts`）。聊天顶部「自动翻译」开关按客户保存（`Customer.autoTranslate`，默认开）。开着时，聊天里还没有中文的外语消息（每次最多 10 条，最新的先翻）自动翻成中文，显示在原文下面，标「机器翻译」；翻过的存进 `MessageTranslation`，换电脑、换同事打开都不再重新翻。中文、纯数字、表情、图片占位和文件名不翻。用「译成客户语言」或常用回复发出的消息，下面保存发送时的中文（标「你写的中文」，`POST /api/whatsapp/send` 新增可选 `original`）；手机上直接发的外语消息也会机器翻译。关掉开关后回到原来的样子：每条客户消息旁边一个「翻译」，点了才翻（结果同样保存）。翻译先用线索导入里配置的翻译服务，没有或失败时用 DeepSeek；两者都不可用时不再自动请求，显示「翻译」按钮。接口：`POST /api/inbox/translate-batch`、`PATCH /api/inbox/auto-translate`，`POST /api/inbox/translate` 改为先查已保存的译文。机器翻译只帮助看懂，报价、数量以原文为准。

**产品资料**（`services/sales-material-service.ts`、`components/messages/Materials.tsx`、`components/bos/MaterialLibrary.tsx`）。输入框上方「产品资料」打开面板，三栏：**目录与资料**（资料库文件，客户语言的排最前，然后是通用、英语，其余在后；客户语言按客户档案的语言，没有时按国家判断法语 / 阿语，否则英语）、**产品图**（产品库里已上传的产品图，按型号或名字搜）、**最近发过**（自己最近 60 天在 BOS 发过的文件和图片）。可以勾几个，附一句话，点「一起发送」：选中的文件先复制成这位客户的附件（`MediaAsset`），再按顺序一条条走正常发送（24 小时窗口、退订、话术限制、记录都照旧），那句话跟第一个文件一起发。窗口关闭时面板提示先发模板，不能发送。资料库在「产品库 · 资料文件」（`/products/materials`）：管理员上传 PDF、图片、Office 文档（最大 20 MB），填名称、分类（产品目录 / 规格表 / 工厂介绍 / 其他）、语言（英 / 法 / 阿 / 通用）、适用产品线；「换新版」替换文件后大家发的都是新版，删除只是从资料库移除（已发给客户的文件不受影响）。销售可以查看、下载。文件存在媒体目录（`MEDIA_STORAGE_DIR`）的 `materials/` 下。接口：`GET|POST /api/inbox/materials`，`GET|POST /api/materials`，`PATCH|PUT|DELETE /api/materials/:id`，`GET /api/materials/:id/file`。

**常用回复**（`services/quick-reply-service.ts`、`lib/quick-replies.ts`、`components/messages/QuickReplies.tsx`、`/messages/replies`）。输入框上方「常用回复」，或在输入框第一个字打「/」再打关键词（如 /交期、/运费）直接搜。分「公司共用」（管理员维护）和「我的」，按分类（交期、起订量、运费、付款、要资料、其他）筛选；用得最多的 3 条标「最常用」排在前面。每条显示客户语言的版本、下面一行中文意思；`{客户名}`、`{我的名字}` 自动换成客户名字（取名）和自己的名字。**点了（或 ↑↓ 选中按回车）只填进输入框，不会直接发**；打「/」搜索时回车只会选回复，永远不会把「/…」发出去。客户语言没有对应版本时填英语版并提示，连英语版也没有时填中文、提示先「译成客户语言」。填入的中文作为原文保存，发送后显示在消息下面。管理页里写中文后可以「AI 生成各语言初稿」（DeepSeek，只填空着的语言），人看过改好再保存。**常用回复里不能放价格**（带货币的金额，如 $120、80 元、EUR 50），保存时会被拒：价格、折扣一律用报价单。接口：`GET|POST /api/quick-replies`，`PATCH|DELETE /api/quick-replies/:id`，`POST /api/quick-replies/:id/use`，`POST /api/quick-replies/draft`。

数据库：迁移 `20261030120000_chat_translate_materials_replies` 新增 `MessageTranslation`、`SalesMaterial`、`QuickReply` 三张表和 `Customer.autoTranslate`（默认 true），只加不改。会话列表在聊天里改了东西后刷新时，总是按当前的筛选取数，且只采用最新一次请求的结果（以前先发出、后返回的刷新可能把筛选后的列表覆盖回去）。

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
