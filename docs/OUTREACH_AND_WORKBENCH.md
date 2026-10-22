# 话术效果分析与工作日历 · 设计与实现说明

> 需求来源：《BOS工作台优化需求：话术效果分析与工作日历》（2026-10-21，@老大）；预置数据来自《绿安居 10–12月运营与转化规划》。
> 本文按 [PROJECT_RULES.md](../PROJECT_RULES.md) §0.5.2 的 7 段格式写成，先设计、后开发。末尾「需要确认的决定」列出了需求没写死、开发时按默认值处理的地方，改起来都只动参数或一处规则。

---

## 1. 需求理解

广告线索在 WhatsApp 上回复率约 20%，但系统没有记录每条线索用了哪条破冰话术，所以说不清哪条话术有效。本次在工作台加两件事：

| 功能 | 解决的问题 | 上线后能直接回答 |
| --- | --- | --- |
| 话术效果分析 | 话术好坏靠感觉，改了也不知道有没有用 | 哪条破冰话术回复率最高？A、B、C 类客户各用哪条最好？ |
| 工作日历 | 一个人跟全流程，事情多、重点不清楚 | 今天最该做什么？这周、这个月的重心是什么？ |

拆成可落地的规则：

1. **每发一组主动消息都留一条「触达记录」**。10 分钟内连发的文字、图片、PDF、视频算一组，取第一条的时间。BOS 发的模板直接带话术编号；手机端发的由规则先比原文，比不上再交给 DeepSeek 认是哪条话术、改了多少。
2. **算 T 还是算 R 还是不算，看会话状态**（破冰期 → T0–T4；沉默期 → R1–R3；对话中 / 沉睡 / 停止联系 → 不算）。状态由消息事实和时间自动推算，不靠人标。
3. **每组客户回复由 DeepSeek 判质量和信号**；自动回复判「无效」，不算回复，24 小时计时继续。回复归属给回复前最后发出的那条话术。
4. **话术由系统轮流分配**：同一触达位置、同一等级、同一语言下有多条「测试中 / 胜出」话术时按 A1、A2、A1、A2 轮换，业务员只负责发送。
5. **看板按 24 小时回复率比较**，按客户等级分开算；每条话术在某等级下满 30 条才参与比较，用 Beta 抽样算胜出概率，给出「建议胜出 / 建议停用」，运营确认后才改状态。
6. **人工改判留痕**：改话术编号、匹配类型、回复质量、信号标签、等级建议都写一行修改记录，统计按改后结果，原值不删；看板显示每月 DeepSeek 改判率。
7. **工作日历**：月重心（3 条）→ 周重心（3 条，必须挂月重心）→ 今日三件事（自动生成、可手动调整）；重心信号按 BOS 数据自动亮灯；完成事项按 转化 / 前端 / 数据 统计精力占比，对照 60 / 20 / 20。

隐含假设与歧义（处理方式见第 8 节）：客户等级已存在（`Customer.leadGrade`）且上周刚按「身份优先」调过，与需求里的等级条件不完全一致；「对话中 → 沉默期」的 72 小时从谁的消息算起；唤醒触达 R1–R3 的节奏需求没给；模板「最多 2 条」的计数范围；历史消息是否回填。

---

## 2. 对 LVANJU BOS 整体的影响

| OS | 影响 |
| --- | --- |
| Sales OS（消息中心、今日跟进） | 新增「下一条触达 + 系统分配话术」提示；BOS 发送前多一道频率 / 停止联系检查；自动生成 T1–T4、R1–R3 跟进任务 |
| Data / Analytics | 新增话术效果看板、每周一结论、改判率、非标准话术占比 |
| Workflow OS | 复用 `Task` + `automationKey` 去重 + `Reminder`；新键前缀 `outreach:`，不改既有四类规则 |
| AI 层 | 新增两个 DeepSeek 调用（手机端触达识别、回复质量判定），沿用 `callDeepSeek` 与「规则兜底、AI 稍后补判」的模式 |
| 管理工作空间 | 新增「工作台」分区放在第一位，管理员登录后的首页改为工作日历的今天视图；经营驾驶舱仍在「经营总览」 |

不改变其他 OS 的边界：WhatsApp 收发、身份链、线索分配、评级流程照旧，只在入库和发送之后多调用一次话术引擎。

---

## 3. 涉及模块

**新增**

| 文件 | 职责 |
| --- | --- |
| `lib/outreach.ts` | 纯函数：消息分组、会话状态机、触达序号、回复归属、文本归一化与原样比对、Beta 胜出概率、指标与建议、重心信号判定、精力分配 |
| `services/outreach-script-service.ts` | 话术库增改查、内容锁定、状态变更、参数设置 |
| `services/outreach-engine-service.ts` | 按客户推算触达记录与回复判定、轮流分配、跟进任务、停止联系；BOS 发送前检查 |
| `services/outreach-ai-service.ts` | 两段 DeepSeek 提示词与调用、规则兜底 |
| `services/outreach-review-service.ts` | 人工复核列表、改判与修改记录、等级建议确认、手动改等级 |
| `services/outreach-analytics-service.ts` | 看板数据、等级矩阵、每周一结论、改判率、非标准话术占比 |
| `services/workbench-service.ts` | 工作日历：三层重心、今日事项生成与顺延、时间块、重心信号、精力分配、预置数据（2026-10-22 起周 / 月视图改为每日复盘，见 §11） |
| `services/daily-review-service.ts` | 每日复盘、明日安排、复盘记录、21:30 复盘提醒（§11） |
| `app/api/outreach/**`、`app/api/workbench/**` | 路由（只鉴权 + 转发） |
| `app/workbench/`、`app/outreach/`（含 `library`、`review`） | 页面 |
| `components/workbench/*`、`components/outreach/*` | 界面 |

**修改（加性，逐一列出调用方）**

| 文件 | 改动 | 受影响入口 |
| --- | --- | --- |
| `prisma/schema.prisma` + 新迁移 | 见第 4 节 | 全部（迁移） |
| `services/whatsapp-message-service.ts` | 发送前调用 `outreachSendGuard`；记录 `sentById`；发送成功后跑话术引擎（不等 AI） | 消息中心发送 `POST /api/whatsapp/send`、`/api/inbox/*` |
| `services/whatsapp-template-service.ts` | 同上；模板列表带出系统分配的话术并优先推荐 | `GET/POST /api/whatsapp/templates` |
| `services/whatsapp-webhook-service.ts` | 结果里多带「本次有消息入库的客户」（含手机端发出的回显），供话术引擎使用 | Gupshup / Cloud API webhook |
| `services/webhook-receipt-service.ts` | 入库后对这些客户跑话术引擎（含 AI） | 同上 |
| `services/whatsapp-web-sync-service.ts` | 本机同步后对匹配到的客户跑话术引擎 | `/api/whatsapp/web-sync` |
| `services/workflow-service.ts` | 导出 `resolveRule` 供话术跟进任务复用（不改逻辑） | — |
| `services/lead-grade-service.ts`、`lib/lead-grade.ts` | 业务员手改的等级（`HUMAN`）不再被自动评级覆盖；会来广交会 → A；按「套」填写的数量 ≥ 6 套算有体量 | 新线索评级、定时重评 |
| `services/bos-sales-service.ts` | 今日跟进排序：最高回复质量为「高意向」与 AI 高意向同权 | `/sales` |
| `app/api/cron/workflows`、`app/api/cron/meta-leads` | 加话术引擎兜底扫描、每周一结论 | 定时任务 |
| `lib/role-workspace.ts`、`components/ui/Sidebar.tsx`、`app/login/page.tsx` | 新分区与图标；管理员首页 `/workbench` | 侧边栏、登录跳转 |
| `components/messages/ChatThread.tsx` | 「下一条触达」提示条、系统分配话术、复制话术、改等级 / 确认等级建议 | `/messages` |

---

## 4. 数据变化

一条加性迁移 `20261021090000_outreach_and_workbench`：只新建表、只给既有表加可空列或带默认值的列，不改列、不删列、不动受保护语义（§1.1 逐条核对见下）。

### 4.1 话术库 `OutreachScript`（一条话术一行）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| code | VarChar(32) UNIQUE | 话术编号，触达位置 + 版本：`T0-A1`；模板用 `M`：`T1-M1` |
| position | VarChar(4) | T0 首回 / T1–T4 第 1–4 次跟进 / R1–R3 唤醒 |
| grades | VarChar(8) | 适用等级，多选，存 `A,B` |
| language | VarChar(4) | `en` 英语 / `fr` 法语 / `ar` 阿拉伯语 |
| content | Text | 原文，支持 `{客户名}` `{国家}` `{产品}` `{业务员}` 变量 |
| versionNote | VarChar(300) | 和上一版相比改了什么 |
| status | VarChar(16) | `TESTING` 测试中 / `WINNER` 胜出 / `RETIRED` 停用 |
| templateName | VarChar(200)? | 登记的已审核模板名（Gupshup elementName）；BOS 发这个模板时直接带编号，不调用 DeepSeek |
| buttonQualities | Json? | 模板快捷按钮 → 回复质量，如 `{"Get a quote":"HIGH","Not interested":"REJECT"}` |
| firstSentAt | DateTime? | 第一次发出的时间；有值后内容锁定 |
| createdBy / createdAt / updatedAt | | 自动 |

规则：`firstSentAt` 有值后，改 `content` 返回 409「话术已发出过，内容已锁定，请新建版本（如 T0-A1 → T0-A2）」；版本说明、状态、适用等级仍可改。「新建版本」按钮预填下一个编号和原文。

### 4.2 触达记录 `OutreachTouch`（每发一组主动消息一行）

| 字段 | 说明 |
| --- | --- |
| groupKey UNIQUE | 组内第一条消息的 id，幂等键 |
| customerId | 关联线索 |
| kind / code / cycle | `ICEBREAK` 破冰 / `REVIVE` 唤醒；`T0`–`T4` / `R1`–`R3`；第几轮唤醒 |
| scriptId | 话术编号（BOS 模板带出；手机端规则或 DeepSeek 匹配） |
| matchType | `EXACT` 原样 / `LIGHT` 轻改 / `HEAVY` 大幅改写 / `FREE` 自由发挥 |
| confidence | 0–1，DeepSeek 给出；规则判定为 1 |
| intent | 消息意图 7 类 |
| judgeStatus / judgedBy / judgeReason | `PENDING` 待判 / `DONE` / `REVIEW` 待人工复核；`RULE` `AI` `HUMAN` |
| senderId | 发送人：BOS 为登录人；本机同步为授权该号码的业务员；公司号手机端（共存模式）为客户负责人 |
| sentAt | 组内第一条的时间 |
| channel | `BOS_FREE` / `BOS_TEMPLATE` / `PHONE` |
| windowOpen | 发送时距客户上一条消息是否在 24 小时内 |
| grade / language | 发送时客户等级与话术语言（快照，按它分组统计） |
| tooSoon | 距上一次主动触达不足 24 小时 |
| replyId / repliedAt / replied24h / lateReply / replyQuality / replySignals | 计入统计的那组回复（冗余存一份，统计不用再联表）；`replied24h` 为空表示还没满 24 小时 |
| text / contentHash / messageCount | 合并后的文本，供复核；内容变了（10 分钟内又补发）会重判 |
| humanEdited | 人工改过 |

### 4.3 回复判定 `OutreachReply`（每组客户回复一行）

`groupKey` UNIQUE、`customerId`、`touchId`（计入哪条触达，只有破冰 / 唤醒后的第一组有效回复才有）、`receivedAt`、`quality`（`HIGH` 高意向 / `ENGAGED` 有效互动 / `LOW` 低意向 / `REJECT` 拒绝 / `INVALID` 无效）、`signals`、`needsHuman`（含图片或语音）、`gradeSuggestion` + `gradeSuggestionStatus`（`PENDING` / `ACCEPTED` / `DISMISSED`）、`nextStep`、`reason`、`judgeStatus` / `judgedBy`、`text` / `contentHash`、`humanEdited`。

### 4.4 判定修改记录 `OutreachOverride`（人工改一次记一行）

`touchId` 或 `replyId`、`field`（`SCRIPT` 话术编号 / `MATCH_TYPE` 匹配类型 / `QUALITY` 回复质量 / `SIGNALS` 信号标签 / `GRADE` 等级建议）、`oldValue`（DeepSeek 或上一次的结果）、`newValue`（必填）、`reason`（必填：`VOICE_IMAGE` 语音或图片人工判定 / `AI_WRONG` AI 判错 / `CONTEXT` 补充了上下文 / `OTHER` 其他）、`note`、`actorId`、`createdAt`。

### 4.5 系统分配 `OutreachAssignment`

`customerId` + `position` + `cycle` UNIQUE、`scriptId`、`grade`、`language`、`assignedAt`、`touchId`（发出后回填）。轮流分配的依据，也是「业务员不能自己挑」的留痕。

### 4.6 线索表新增字段（`Customer`）

| 字段 | 默认 | 用途 |
| --- | --- | --- |
| outreachState VarChar(12) | `''` | 会话状态：`ICEBREAK` 破冰期 / `CONVERSING` 对话中 / `SILENT` 沉默期 / `DORMANT` 沉睡 / `STOPPED` 停止联系；空表示还没推算 |
| outreachNext VarChar(4) | `''` | 下一条该发 T 几或 R 几 |
| outreachDueAt DateTime? | null | 下一次「到时间就变状态」的时刻，定时任务只扫到期的客户 |
| replyScriptCode VarChar(32) | `''` | 客户首次回复前最后发出的那条话术 |
| bestReplyQuality VarChar(12) | `''` | 出现过的最高回复等级，用于排优先级 |

复用：来源平台 `source`、国家 `country`、表单答案（`LeadSubmission` / `CustomerLeadAttribution.answers`）、客户等级 `leadGrade`（A/B/C，另有既有的 D 无效）、跟进阶段 `stage`。

### 4.7 其他加性列

- `WhatsAppMessage.sentById String?`：BOS 发送人。历史消息为空，不回填。
- `Setting.outreachConfig Json?`：可调参数（见 4.9），为空时用代码默认值。
- `Setting.outreachStartedAt DateTime?`：话术记录的起点。第一次运行引擎时写入；之前的历史消息只用来推算会话状态，不生成触达记录、不调用 DeepSeek、不生成跟进任务。

### 4.8 工作日历

| 表 | 说明 |
| --- | --- |
| `FocusGoal` | 月重心 / 周重心：`level`（MONTH / WEEK）、`periodKey`（`2026-10` / 周一日期 `2026-10-19`）、`title`、`target`（目标值文字）、`progress`（0–100）、`parentId`（周重心必填，关联月重心）、`status`（周重心完成情况：未开始 / 进行中 / 已完成）、`category`、`sort`。每层每期最多 3 条（服务层校验）。全公司共用，管理员编辑 |
| `WorkItem` | 日历事项：`userId`、`date`、`title`、`detail`、`kind`（`MANUAL` / `FOCUS` 周重心任务 / `FIXED` 固定事项 / `TIMEBLOCK` 时间块 / `EVENT` 重点事件）、`category`（`CONVERT` 转化 / `FRONTEND` 前端 / `DATA` 数据）、`focusId`、`startTime` / `endTime`、`endDate`（多日事件）、`pin`（1 放进三件事 / -1 移出 / 0 自动）、`status`、`doneAt`、`carryCount`、`originalDate`、`sourceKey`（固定事项、时间块去重：`@@unique([userId, date, sourceKey])`） |
| `TimeBlock` | 每日时间块模板：`userId`、`startTime`、`endTime`、`title`、`category`、`weekdays`、`sort`、`active` |

每日复盘新增的表和列见 §11.4（迁移 `20261022090000_daily_review`）。
| `OutreachReport` | 每周一话术结论：`weekStart` UNIQUE、`lines` Json、`generatedAt` |

### 4.9 可调参数（`Setting.outreachConfig`，代码默认值）

| 参数 | 默认 | 来源 |
| --- | --- | --- |
| 消息合并窗口 | 10 分钟 | 需求 |
| 对话中 → 沉默期 | 72 小时 | 需求「默认值，做成可调参数」 |
| T4 / R3 后转沉睡 | 7 天 | 同上 |
| 跟进节奏 T1–T4 | 第 1 / 3 / 7 / 14 天（从 T0 算） | 流程图、规划文档 |
| 唤醒节奏 R1–R3 | 进入沉默期后第 0 / 3 / 7 天 | 需求未给，默认值 |
| 两次主动触达最短间隔 | 24 小时 | 需求 |
| 同一线索模板上限 | 2 条 | 需求 |
| 复核置信度 | 0.7 | 需求 |
| 比较门槛 | 30 条 | 需求 |
| 建议胜出 / 停用 | ≥ 90% / < 10% | 需求 |
| 非标准话术提醒 | 30% | 需求 |
| 改判率提醒 | 15% | 需求 |
| 首回超时 / A 类与高意向回复超时 | 5 分钟 / 2 小时 | 需求 |
| 重心信号阈值 | 回复率低 5 个百分点、企业线索占比低 10 个百分点、高意向 24 小时、报价 7 天 ≥ 3 个、首回超 5 分钟 ≥ 3 条、精力偏离 15 个百分点 | 需求 |
| 精力目标 | 转化 60 / 前端 20 / 数据 20 | 需求、规划文档 |

### 4.10 受保护语义核对（§1.1）

- 幂等键：未改动。新表各自有幂等键（`groupKey`、`[customerId, position, cycle]`、`[userId, date, sourceKey]`、`weekStart`）。
- 单例行：`Setting.id='system'` 只加列。
- 软删除：所有查询按 `Customer.deletedAt = null` 过滤。
- 口径字段：不碰 `inquiryAt` / `dealDate`。
- 枚举值域：新状态都是 String + 应用层 `z.enum`，中文标签集中在 `lib/outreach.ts`。
- `automationKey`：新任务键 `outreach:<客户>:<轮次>:<序号>`，与既有四类前缀不冲突。

---

## 5. API 变化

全部新增，返回 `{success, data}` 信封，入参在 service 内 `zod.parse()`，越权返回 404。

| 端点 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/outreach/scripts` · `POST` | 读：全员；写：管理员 | 话术库列表 / 新建 |
| `PATCH /api/outreach/scripts/[id]` | 管理员 | 改版本说明、状态、等级、模板绑定；已发出后改内容返回 409 |
| `GET/PUT /api/outreach/settings` | 读：全员；写：管理员 | 可调参数 |
| `POST /api/outreach/next` | 客户可见者 | 推算该客户的会话状态，确保下一条触达已分配话术，返回状态、序号、话术、发送限制（有写入，所以用 POST） |
| `GET /api/outreach/dashboard` | 全员 | 看板：筛选（触达位置、等级、语言、时间、发送方式）同时作用于指标卡、排名、等级矩阵 |
| `GET /api/outreach/scripts/[id]/touches` | 全员（销售只看自己客户的明细） | 展开话术原文与触达记录 |
| `GET /api/outreach/review` | 销售看自己的，管理员看全部 | 人工复核列表 |
| `POST /api/outreach/review/touch/[id]` · `.../reply/[id]` | 同上 | 改判，必填原因，写修改记录 |
| `POST /api/outreach/grade` | 同上 | 确认 / 忽略等级建议、手动改等级 |
| `GET /api/workbench` | 管理员 | 今天的数据（2026-10-22 起只有今天；复盘与记录的接口见 §11.5） |
| `POST /api/workbench/plan` | 管理员 | 生成当天计划（固定事项、时间块、顺延，幂等），页面打开时调用 |
| `POST /api/workbench/items` · `PATCH/DELETE /api/workbench/items/[id]` | 管理员 | 事项增改、完成、放进 / 移出三件事 |
| `POST /api/workbench/focus` · `PATCH/DELETE /api/workbench/focus/[id]` | 管理员 | 月 / 周重心 |
| `GET/POST /api/workbench/time-blocks` · `PATCH /api/workbench/time-blocks/[id]` | 管理员 | 时间块 |

既有接口只加不减：`GET /api/whatsapp/templates` 多返回 `outreach`（系统分配的话术）；发送接口多一种 409（停止联系、间隔不足 24 小时、模板超过 2 条），文案中文、面向用户。

---

## 6. UI 变化

全部用 `.bos` 作用域与 `components/ui/bos.tsx` 原语，复用既有 token，不新增颜色变量；桌面 1600 / 手机 390 无横向溢出。

**导航**

- 管理员：新分区「工作台」放第一位，页签：工作日历 `/workbench` · 话术效果 `/outreach` · 话术库 `/outreach/library` · 人工复核 `/outreach/review`。登录后进入 `/workbench`。
- 销售：新分区「话术」，页签：人工复核 · 话术效果 · 话术库（只读）。

**工作日历 · 今天（首页）**

```
┌ 工作日历                                          [日][周][月]  ‹ 10月21日 周三 › ┐
│ 本月重心  ① 广交会客户邀约到厂 ▓▓▓▓░ 60%  ② 线索分级与跟进节奏 ▓▓░ 40%  ③ … │
│ 本周重心  ① 广交会邀约全部发出 · 进行中   ② 定好接送和到厂路线 · 已完成   ③ …  │
├──────────────────────── 2/3 ───────────────────────┬──────── 1/3 ─────────┤
│ 今日三件事                                          │ 重心信号（有才显示）    │
│ 1 ● 3 条新线索超过 5 分钟未首回（红，置顶）          │  ▲ 高意向积压 2 位     │
│ 2   高意向积压：2 位客户的高意向回复超过 24 小时      │  → 转化：今天先处理    │
│ 3   本周重心：广交会邀约全部发出 · 发完剩下 12 位     │                        │
│ ▸ 其他事项（8）  时间块 · 业务员任务 · 顺延事项       │ 本周精力分配           │
│   [+ 添加事项]                                       │ 转化 ▓▓▓▓▓▓ 55% / 60   │
│                                                     │ 前端 ▓▓ 25% / 20       │
│                                                     │ 数据 ▓▓ 20% / 20       │
└─────────────────────────────────────────────────────┴────────────────────────┘
```

- 今日三件事的顺序：紧急事项（新线索超过 5 分钟未首回；A 类或高意向回复超过 2 小时未处理）→ 重心信号触发的事项 → 本周重心下当天的任务 → 固定事项（周一广告检查、周三查看话术测试进度、周五漏斗复盘与定下周重心、每月最后一个周五定下月重心）。可手动「放进三件事 / 移出」。
- 没做完的事项第二天自动出现，显示「顺延 n 次」。
- 周视图：周一到周日 7 列事项 + 本周重心 + 精力分配；月视图：日历格子，每格显示当天的重点事件（如广交会二期）与固定事项。
- **2026-10-22 改版**：周 / 月视图换成「今天 · 复盘 · 记录」三页，见 §11。

**话术效果看板**（按需求线框图）

筛选（触达位置 T0 · 客户等级 · 语言 · 时间 · 发送方式）→ 指标卡（发送数 · 24 小时回复率 · 有效回复率 · 测试中话术）→ 排名表（话术编号 · 发送数 · 24h 回复率 · 有效回复率 · 胜出概率 · 系统建议）+ 本周结论卡 → 话术 × 客户等级矩阵（蓝底 = 该等级推荐；不满 30 条显示「数据不足」；用 A+B 合并数据时标注）→ 底部：迟到回复数、非标准话术占比（按业务员，超过 30% 提醒）、本月 DeepSeek 改判率（超过 15% 提示校准提示词）。点话术编号展开原文和全部触达记录。

**话术库**：按触达位置分组的表格；新建 / 新建版本 / 改状态（测试中 → 胜出 / 停用）；已发出的话术显示锁形标记，内容不可编辑；模板绑定与按钮对应的回复质量；参数设置（管理员）。

**人工复核**：三个页签——待复核触达（置信度 < 0.7、序号对不上、DeepSeek 未判出）、需人工查看的回复（语音 / 图片）、等级建议。每行显示消息原文与 AI 结果，改判时选原因。

**消息中心**：聊天窗口底部提示条「下一条：T0 首回 · 系统分配 T0-A1（测试中）」，模板话术一键带入模板面板（其他模板折叠在「改用其他模板」后，并提示不计入轮换）；非模板话术可「复制话术」到手机发送。客户资料栏显示会话状态、回复话术、最高回复质量、等级建议（一键确认）和手动改等级。

---

## 7. 实施计划

**话术引擎（核心）**：每次有消息入库或发出，对该客户「从头推算」：读消息 → 按 10 分钟分组 → 用会话状态机逐组判断 T / R / 不算 → 写触达记录与回复判定（按 `groupKey` 幂等）→ 回复归属 → 更新线索字段 → 确保下一条已分配话术 → 同步跟进任务。规则能算的先写进去（状态、序号、窗口、模板编号、原文一致），DeepSeek 只做两件事：认手机端话术、判回复质量；判完再推算一次（状态可能因「拒绝 / 要求停止联系」改变）。

触发点：webhook 入库后（含手机端回显）、本机同步后、BOS 发送成功后（先不等 AI，AI 放到响应之后）、打开聊天窗口时（`POST /api/outreach/next`）、每 5 分钟的线索定时任务（扫到期状态、待判定、新线索）。满足「消息同步后 5 分钟内生成判定」。

会话状态机（按状态图，72 小时、7 天可调）：

| 当前 | 事件 | 结果 |
| --- | --- | --- |
| 破冰期 | 我方发出一组 | 记 T0…T4；T4 之后再发不记 |
| 破冰期 | 客户回复（非无效、非拒绝） | → 对话中；回复归属最后一条 T |
| 破冰期 | 拒绝 | → 沉睡；回复同样归属 |
| 破冰期 | T4 后 7 天无回复 | → 沉睡 |
| 对话中 | 客户最后一条有效消息后 72 小时 | → 沉默期 |
| 沉默期 | 我方发出一组 | 记 R1…R3 |
| 沉默期 | 客户回复 | → 对话中 |
| 沉默期 | R3 后 7 天无回复 | → 沉睡 |
| 沉睡 | 客户主动来消息 | → 对话中 |
| 任意 | 要求停止联系 | → 停止联系（同时退订，BOS 禁发） |
| 任意 | 回复判为无效 | 不变 |

**步骤与验证**

1. 迁移 + `lib/outreach.ts` 纯函数与单元测试（分组、状态机、归属、Beta 胜出概率与精确积分对比在 2 个百分点内）。
2. 话术库 + 引擎 + DeepSeek 两段调用 + 发送检查 + 跟进任务；MySQL 集成测试覆盖第一期验收项。
3. 人工复核与修改记录；等级建议与手动改等级。
4. 看板、每周一结论、改判率、非标准话术占比。
5. 工作日历（日 / 周 / 月）、预置数据、重心信号、精力分配；重心信号用历史数据回放测试（满足条件当天出现、解除后消失）。
6. `prisma validate` · `pnpm test` · `pnpm lint` · `tsc --noEmit` · `pnpm build`；CI 增加新迁移的升级校验。

**风险与回滚**：迁移只加表加列，回滚应用版本时保留新表新列即可；话术引擎任何异常只记日志，不影响消息入库和发送（发送检查除外，它就是要拦）。DeepSeek 未配置时规则照常运行：手机端触达标「待判定」进复核列表，回复按规则给出临时等级，配置后自动补判。

---

## 8. 需要确认的决定（已按默认值开发）

| # | 问题 | 默认做法 | 为什么 |
| --- | --- | --- | --- |
| 1 | 客户等级规则与上周调好的评级不完全一致 | 复用现有 `leadGrade`（身份优先、个人自用为 C、AI 最多升一级），只补需求里新增的两条：**表单选了会来广交会 → A**（个人自用除外），**数量按「套」填写时 ≥ 6 套算有体量**。没有改成「100 件以上且采购时间选最近一档」 | 改门槛会让现有一批 A 降为 B；需要的话只改 `lib/lead-grade.ts` 一处 |
| 2 | 管理员首页 | 改为工作日历今天视图 `/workbench` | 需求「工作台首页就是日历的今天视图」 |
| 3 | 破冰期什么算「客户有效回复」 | 除「无效」外都算；其中「拒绝」进沉睡、「要求停止联系」进停止联系 | 状态图与「无效不触发任何状态变化」 |
| 4 | 对话中 72 小时无消息从谁算起 | 客户最后一条有效消息 | 唤醒的是客户 |
| 5 | 24 小时回复率的分母 | 已满 24 小时或已回复的触达；未满 24 小时的显示为「待满 24 小时」，不进分母 | 刚发出的话术不应拉低回复率 |
| 6 | 「同一线索模板最多 2 条」 | 从客户上一次有效回复之后算起（从未回复过 = 全程最多 2 条） | 长期客户重新唤醒时仍可用模板 |
| 7 | 唤醒节奏 | 进入沉默期后第 0 / 3 / 7 天，可调 | 需求未给 |
| 8 | 公司号在手机上发的消息（共存模式）发送人 | 记为客户负责人 | 公司号多人共用，系统无法区分是谁按的发送 |
| 9 | 历史消息 | 不回填触达记录，只用来推算当前状态 | 「数据晚一天开始记」，回填会让非标准话术占比失真 |
| 10 | DeepSeek 提示词 | 需求提到的「DeepSeek 提示词」标签页不在 Word 里；按需求的判定标准写了两段提示词，放在 `services/outreach-ai-service.ts` 顶部，可直接替换 | — |
| 11 | 重心信号最小样本 | 回复率下滑需要本周至少 10 条已满 24 小时的 T0 触达才判断 | 样本太少时信号会乱闪 |

## 9. 验收项对照

| 验收项 | 实现 | 测试 |
| --- | --- | --- |
| 发出 T0 后自动生成触达记录，编号、发送人、时间正确 | 引擎在 BOS 发送成功后立即推算；模板带编号 | `tests/outreach-engine.test.ts`（规则路径与 DeepSeek 路径各一组） |
| 24 小时内回复标「是」，超过标「迟到回复」 | `replied24h` / `lateReply` | 同上 |
| 发出过的话术无法改内容，只能新建版本 | `firstSentAt` 锁定 + 409 | 同上 |
| 两条测试话术，连续 10 条新线索约 5:5 | 最少分配者优先、编号次序打破平局 → 严格交替 | 同上 |
| 首页能看到本月重心、本周重心和今日任务 | `/workbench` | `tests/workbench.test.ts` |
| 新线索超过 5 分钟未首回，今日任务标红置顶 | 紧急事项排第一 | 同上 |
| 未完成任务次日自动出现并显示顺延次数 | `planDay` 顺延 + `carryCount` | 同上 |
| DeepSeek 话术匹配一致率 ≥ 90%、回复质量 ≥ 85%、自动回复全判无效 | 提示词 + 自动回复规则兜底；上线前用 50 + 50 组人工标注验收（需真实数据，不能用测试数据冒充） | 规则部分有测试 |
| 停止联系后 BOS 无法发送 | 发送前检查 + 退订 | 同上 |
| 同步后 5 分钟内出判定 | 入库后立即跑；5 分钟定时任务兜底 | — |
| 语音、图片回复进人工查看 | `needsHuman` | 同上 |
| 人工改判生成修改记录，统计按改后 | `OutreachOverride` + 重新推算 | 同上 |
| 模板按钮按登记的对应关系判定，不调用 DeepSeek | `buttonQualities` | 同上 |
| 不足 30 条显示「数据不足」 | 看板 | `tests/outreach-engine.test.ts` |
| 胜出概率与手工计算误差 ≤ 2 个百分点 | 固定种子 Beta 抽样 10000 次 | `tests/outreach-unit.test.ts`，与数值积分对比 |
| 每周一 9 点前生成上周结论 | 定时任务每 5 分钟检查，周一 8 点后生成 | 同上 |
| 重心信号满足条件当天出现、解除后消失 | `focusSignals(asOf)` 纯推算 | 历史回放测试 |

---

## 10. 实现说明与上线步骤（2026-10-21）

**已实现**：第一期与第二期全部内容；第三期中「T1–T4、R1–R3 的轮换与统计」系统已支持（登记对应位置的话术即可开始测试），看板的触达位置筛选可以直接看。**未实现（第三期）**：推进率、按国家拆分的分析。

| 页面 | 地址 | 谁用 |
| --- | --- | --- |
| 工作日历（管理员首页） | `/workbench` 今天 · `/workbench/review` 复盘 · `/workbench/history` 记录（§11） | 管理员 |
| 话术效果 | `/outreach` | 全员（话术明细里销售只看到自己的客户） |
| 话术库 | `/outreach/library` | 全员查看，管理员维护与调参数 |
| 人工复核 | `/outreach/review` | 销售看自己的客户，管理员看全部 |
| 消息中心「下一条触达」 | `/messages` 聊天窗口底部与客户资料栏 | 全员 |

**上线步骤**

1. 部署即可：`pnpm build` / `pnpm start` 会执行新增的加性迁移 `20261021090000_outreach_and_workbench`，不需要手工步骤。回滚应用版本时保留新表与新列即可。
2. 定时任务沿用现有的 `/api/cron/meta-leads`（每 5 分钟）与 `/api/cron/workflows`（每小时），两者都会顺带跑话术引擎兜底扫描与周一结论，不需要新增定时任务。
3. 第一次有消息入库、打开聊天窗口或定时任务运行时写入 `Setting.outreachStartedAt`，从这一刻起记录触达；之前的历史消息只用来推算当前会话状态。
4. 在话术库登记第一轮 T0 两版话术。BOS 发的首回是模板，所以 T0 话术要填「登记的模板名」（Gupshup 里的 elementName，如 `lvanju_hi_fb_en`），否则 BOS 发出的模板会归入非标准话术；有快捷按钮的模板同时登记按钮对应的回复质量。
5. 配置 DeepSeek（已有的 `DEEPSEEK_API_KEY`）后，手机端消息与客户回复在入库后几秒内判定；未配置时规则照常运行，手机端触达进人工复核，回复用规则临时判定。
6. 第一期验收里「抽 50 组手机端消息、50 组客户回复人工标注」需要真实数据，上线跑一段后做；提示词在 `services/outreach-ai-service.ts` 顶部，按修改记录调整。

**已知限制**

- 话术变量 `{国家}` 取客户档案里的国家字段，档案写的是中文时会带出中文国名，发送前请核对（复制话术时可见）。
- 公司业务号在手机上（共存模式）发出的消息，系统分不出是谁按的发送，发送人记为客户负责人；本机同步（WhatsApp Web）按授权号码对应到业务员。
- 「同一线索模板最多 2 条」从客户上一次有效回复之后计算；对话中、沉睡状态下发模板不算触达，不受这条限制。

---

## 11. 工作日历改版：每日复盘与明日安排（2026-10-22）

> 需求来源：@老大 看了 `/workbench` 月视图后提出「太呆板，主要想做每日复盘和明日的工作安排，填写过的都要留痕，以便于效率和进步」。先出设计图审核，确认后开发。确认时补充的三条决定：**周末也计入完成率**（不定期单休）；**每晚 21:30 推送复盘提醒**；**复盘内容和明日规划都要留记录，只有自己能看**。

### 11.1 需求理解

每天形成一个闭环：早上打开工作台看到今天的三件事 → 白天勾选完成 → 晚上复盘（每件事完成 / 顺延 / 不做了及原因，复盘三问，精力和专注评分）并排好明天的三件事 → 第二天早上直接出现在首页。所有填写都留痕：复盘提交后仍可修改，但每次修改都记下改了什么、改之前、改之后；没复盘的日子由系统第二天按勾选记录；重心进度每次变化都记一笔。记录页按月回看每天做了什么、完成率、没做完的原因、改进有没有做到。

### 11.2 对 LVANJU BOS 整体的影响

只在管理工作空间的「工作台 · 工作日历」内部改动，不影响其他 OS 的边界。原来的日 / 周 / 月三视图换成今天 / 复盘 / 记录三页；三层重心、固定节奏、时间块、重心信号、预置数据全部保留并接到新页面。复盘属于个人数据：作用域固定为本人，其他管理员也看不到。

### 11.3 涉及模块

| 文件 | 变化 |
| --- | --- |
| `services/workbench-service.ts` | 今天的数据改为固定的三件事（`topOrder`）、紧急事项与重心信号单独返回、复盘状态和统计；`planDay` 先记下没复盘的日子，再顺延、排固定事项与时间块、定今天三件事；重心支持数字目标与进度记录；`stepFocus` |
| `services/daily-review-service.ts`（新） | 复盘页数据、草稿 / 提交 / 提交后修改（留痕）、补写、休息、记录页、21:30 提醒 |
| `lib/workbench.ts` | 复盘规则（连续复盘、完成率、修改对比、结果与原因、提醒时间），纯函数可测 |
| `app/workbench/{page,review/page,history/page}.tsx` | 三个页面 |
| `components/workbench/{WorkbenchToday,DailyReview,ReviewHistory,shared}.tsx` | 界面；删除 `WorkbenchCalendar.tsx` |
| `app/api/workbench/{review,review/rest,history,focus/[id]/progress}` | 新接口（只鉴权 + 转发） |
| `app/api/cron/{meta-leads,workflows}`、`app/api/workflows/sync` | 顺带发 21:30 复盘提醒 |
| `app/workbench.css` | 新样式（`.bos-wb-*` / `.bos-dr-*` / `.bos-rec-*`），移除日历格子样式 |

### 11.4 数据变化（迁移 `20261022090000_daily_review`，只加不改）

| 表 / 列 | 说明 |
| --- | --- |
| `DailyReview`（新） | 每人每天一条，`@@unique([userId, date])`。`status`：`DRAFT` 草稿 / `SUBMITTED` 已提交 / `REST` 休息 / `MISSED` 没复盘（第二天开工时按勾选记下）。`items`（当天三件事和结果快照：完成 / 顺延 / 不做了、原因、补充）、`done` / `planned` / `carried` / `dropped`、`wins` / `problems` / `improvement`（复盘三问）、`lastImprovement`（上次的改进做到了吗：`YES` / `PARTLY` / `NO`）、`energy` / `focusLevel`（1–5）、`plan`（排好的明天）、`metrics`（当天数据存档）、`submittedAt`、`remindedAt` |
| `DailyReviewRevision`（新） | 每次提交、修改、标为休息一行，只增不改：`kind`（`SUBMIT` / `EDIT` / `REST`）、`changes`（`[{ field, label, before, after }]`） |
| `FocusProgressLog`（新） | 重心进度每次变化一行，只增不改：`focusId`、`userId`、`date`、`fromValue`、`toValue`、`target` |
| `WorkItem.topOrder`（可空） | 当天三件事的位置 1–3；做完仍留在三件事里 |
| `FocusGoal.targetValue`（可空）· `currentValue`（默认 0）· `unit`（默认空） | 数字目标，如「10 位」；填了目标数时进度 = 当前数 ÷ 目标数 |

**同时修正的问题**：`WorkItem.status` 是 `VarChar(8)`，原代码删除系统排的事项（固定事项、时间块）时写入 9 个字符的 `DISMISSED`，MySQL 会报「值太长」导致删除失败（所以库里不存在这个值）。改为 `DROPPED`（不做了 / 已移除），不改列。

受保护语义核对：不触碰 §1.1 任何约束；`WorkItem` 的 `@@unique([userId, date, sourceKey])` 去重保持；`Setting` 单例不新增列。

### 11.5 API 变化

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/workbench` | 管理员 | 今天：重心、三件事、紧急事项、重心信号、时间块、其他事项、复盘状态、昨天完成、连续复盘、本周完成率。不再接受 `view` / `date`（只有本页面调用） |
| `GET /api/workbench/review?date=` | 管理员（本人） | 某天的复盘（默认今天，可补写 30 天内） |
| `POST /api/workbench/review` | 管理员（本人） | `{ date, submit, items[], lastImprovement, wins, problems, improvement, energy, focusLevel, plan[] }`：草稿 / 提交 / 提交后修改 |
| `POST /api/workbench/review/rest` | 管理员（本人） | `{ date }` 标为休息 |
| `GET /api/workbench/history?month=&q=` | 管理员（本人） | 复盘记录 |
| `POST /api/workbench/focus/[id]/progress` | 管理员 | `{ delta: 1 | -1 }` 重心进度加一 / 减一 |
| `POST /api/workbench/items`、`PATCH /api/workbench/items/[id]` | 管理员 | `pin: 1` 放进当天三件事（满 3 件返回 409），`pin: -1` 移出；改日期即移出原来那天的三件事 |
| `PATCH /api/workbench/focus/[id]` | 管理员 | 新增可选 `targetValue` / `currentValue` / `unit`；进度变化写进度记录 |

全部保持 `{success, data}` 信封；新增入参均可选。

### 11.6 规则

- **今天的三件事**：头天晚上复盘排好的（第 1–3 件）；没排的话，开工时按原来的顺序（重心任务 → 固定事项 → 手动，顺延多的优先）定下 3 件。紧急事项（新线索超时、高意向等回复）在三件事上方红色置顶，处理完自动消失；重心信号放在右侧「数据提醒」。
- **复盘**：完成的默认「完成」，没做完的默认「顺延到明天」，可改「不做了」，并可选原因（时间不够 / 被打断 / 优先级变了 / 卡住了 / 其他）。同一件事顺延到第 2 次时提示拆小或放上午。顺延的事自动排进明天；明天前 3 件是三件事，其余进「其他事项」。草稿在停止输入 1.5 秒后自动保存。
- **提交与留痕**：提交时把结果写回事项（完成留在今天；不做了标 `DROPPED`；顺延移到明天、顺延次数 +1），创建明天的新事项；当晚修改会重新套用并记录改动。过了当天，结果和明日安排锁定，原因、补充、复盘三问和评分仍可改，同样留痕。
- **没复盘的日子**：第二天开工时系统把那天的三件事按勾选记为 `MISSED`（完成 / 不做了 / 顺延），记录页用虚线标出，30 天内可补写（结果保持系统记录）。
- **完成率**：三件事完成数 ÷ 件数，统计已提交和系统记下的日子；**周末照常计入**；标为休息的日子不计入。
- **连续复盘**：提交了复盘的日子连续计数；休息日不打断也不增加；没复盘（系统记下或草稿没提交）中断；什么都没有的一天（没标休息的单休）允许 1 天，连续 2 天中断。
- **21:30 提醒**：每天 21:30 起（周末也发），给近 14 天用过工作台、当天还没提交也没标休息的管理员推一条手机通知，一天一次（`DailyReview.remindedAt` 记录已发），点开进复盘页。由每 5 分钟的 `/api/cron/meta-leads`、每小时的 `/api/cron/workflows` 和 CRM 打开时的同步顺带发出，不需要新增定时任务。手机需要在 CRM 里开启过通知。
- **只有自己能看**：复盘、修改记录、复盘记录的所有查询都按当前登录人过滤，其他管理员（包括老板账号）看不到；销售角色无权访问工作日历。

### 11.7 实施与验证

- 测试：`tests/workbench.test.ts`（规则：连续复盘、完成率、修改对比；今天视图、开工排三件事、没复盘的日子被记下、删除系统事项）、`tests/daily-review.test.ts`（草稿、提交、明日安排、当晚修改留痕、第二天首页、补写、搜索、他人不可见、休息日、21:30 提醒只发一次、周末也发）。
- 上线：部署即执行加性迁移 `20261022090000_daily_review`，无手工步骤；回滚应用版本时保留新表与新列即可。
- 设计图与实现的差异：页头标题按 BOS 规范用页签名「工作日历」，日期与「昨天完成 · 连续复盘 · 本周完成率」放在描述里；记录页的时间范围用按月翻页（含与上月对比）代替「本周 / 本月 / 近 90 天 / 全部」切换，搜索覆盖全部时间；「今天的数据」只放 BOS 有数据来源的 4 项（新线索、平均首回、客户回复、发出报价），设计图里的「确认到厂」暂无数据来源，未做。

