# LVANJU BOS 移动端 · 第六步：Android / HarmonyOS 开发落地方案

> 状态：**方案，待确认**。按 PROJECT_RULES §0.5，以下涉及数据库与接口的改动都需要确认后再开发；本次没有改动任何生产代码。

## 1. 总体架构

```
┌────────────────────┐   ┌──────────────────────────┐   ┌──────────────────┐
│ Android App        │   │ HarmonyOS App（原生）     │   │ 现有 Web / PWA    │
│ Kotlin + Compose   │   │ ArkTS + ArkUI（Stage 模型）│   │ Next.js（不变）   │
└─────────┬──────────┘   └────────────┬─────────────┘   └────────┬─────────┘
          │  同一套 HTTPS JSON API（{success,data} 信封、Zod 校验、权限作用域）   │
          └──────────────────────┬───────────────────────────────┘
                     services/**（唯一的业务规则）→ Prisma → MySQL
                                 │
                  推送适配层（新增）：Web Push（现有）｜厂商通道 / FCM｜Push Kit
```

- **业务规则只在服务端**：阶段规则、首联时限、等级响铃、权限作用域、业绩口径都由现有 `services/` 计算，两个客户端只展示和提交。
- **两个原生客户端**：HarmonyOS 5/6（HarmonyOS NEXT 体系）不再运行 Android APK，必须单独开发 HAP 应用；Android 仍覆盖国内外其他品牌手机。
- **共享的不是代码，是契约**：OpenAPI 接口契约（由现有 Zod schema 生成）、设计令牌（`tokens.json`）、文案与图标、原型（交互基准）。
- 也评估过跨平台方案（Flutter / React Native 的 OpenHarmony 分支）：可以少写一套 UI，但 HarmonyOS 推送、通知渠道、侧滑返回等系统能力仍需原生桥接，且社区适配版本落后于官方 SDK。业务以销售高频操作和可靠推送为核心，建议两端原生。若团队只有一组移动端人力，可先做 Android（覆盖面更大），HarmonyOS 紧随。

## 2. 服务端需要新增的能力（全部为加性改动）

| # | 能力 | 改动 | 是否必须 |
| --- | --- | --- | --- |
| S1 | 只读数据接口 | 新增 `GET /api/mobile/home`（一次返回工作台所需数字，内部复用 `business-cockpit-service`、`todayWorkCounts`、订单提醒、任务）；`GET /api/finance`、`GET /api/command-center`（复用现有 service，目前只有页面直连）| 必须 |
| S2 | 设备令牌 | 新表 `DeviceToken(userId, platform ANDROID/HARMONY, provider FCM/HMS/HONOR/MI/OPPO/VIVO/HARMONY_PUSH, token, appVersion, lastSeenAt, failures)`；`POST/DELETE /api/devices`；退出登录时注销 | 必须 |
| S3 | 推送适配层 | `push-service.ts` 抽象 `PushProvider`：现有 Web Push 保持不变，增加原生通道；`LeadAlert` 发件箱、今日简报、首联超时、任务提醒都改为调用适配层（行为不变，只是多了收件设备） | 必须 |
| S4 | 通知已读 | 新表 `NotificationRead(userId, itemId, readAt)`（itemId 即 `notificationFeed` 现有的稳定 id）；`POST /api/notifications/read`（ids / all）；feed 返回 `read` 字段 | 必须（多设备同步已读） |
| S5 | 通知偏好 | 新表 `NotificationPreference(userId, category, enabled, mode, quietFrom, quietTo, exceptGradeA)`；服务端据此决定是否推送、推送优先级 | 必须 |
| S6 | 新通知种类 | 新订单（订单创建时）、定金 / 尾款到账（付款状态变化）、物流超期（已有计算，补推送）、系统公告（新表 `Announcement`，管理员发布） | 建议 |
| S7 | 审批流程 | 需先确认规则：哪些情况触发（低于价格表 x%、改付款条件、更正成交）、审批人、超时处理。新表 `Approval` + 状态机 | 待业务确认 |
| S8 | 收款记录 | 回款金额需要 `Payment(orderId, amount, currency, receivedAt, kind DEPOSIT/BALANCE)`；当前只有付款状态 | 待业务确认 |
| S9 | 设备管理 | 登录设备列表与单设备退出（会话表或在 `DeviceToken` 上记录会话） | 可后置 |
| S10 | 英文界面 | 客户端文案国际化；服务端错误信息目前是中文 | 可后置 |

所有新表按 PROJECT_RULES §2 走 Prisma migration，新列可空或有默认值；`{success,data}` 信封与现有字段不变。

## 3. 认证

- **V1 沿用现有 Cookie 会话**：`POST /api/auth/login` 返回 `Set-Cookie: crm_session`（HttpOnly、7 天）。Android 用 OkHttp 持久化 `CookieJar`（加密存储），HarmonyOS 用网络库的 Cookie 管理并把会话存入 Asset Store（安全存储）。不需要改接口。
- 联调验证项：原生请求不带 `Origin` 时 `middleware.ts` 放行；会话过期（401）统一跳登录页并保留当前页面以便登录后返回。
- 可选 V2：增加 Bearer Token（加性：同一会话签名，放在 `Authorization` 头），便于未来接入更多客户端。
- 生物识别解锁只在本机验证（Android BiometricPrompt / HarmonyOS 用户认证 Kit），不上传生物信息，不替代服务端会话。

## 4. 推送与通知（两端分别实现，不能用页面弹窗代替）

### 4.1 Android

| 项目 | 方案 |
| --- | --- |
| 通道 | 国内手机在 App 被杀后只能靠**厂商通道**送达：华为（HMS Push）、荣耀、小米、OPPO、vivo；有 GMS 的海外手机用 FCM。可直接对接各厂商，或用聚合推送服务（需评估数据合规与费用） |
| 权限 | Android 13+ 运行时申请 `POST_NOTIFICATIONS`；首次在「工作台」用说明页解释用途再申请，拒绝后在通知设置页引导去系统设置 |
| 渠道 | 每个通知分类一个 `NotificationChannel`：`inquiry_urgent`、`inquiry`、`order`、`followup`、`approval`、`exception`、`announcement`。**渠道创建后声音 / 振动由用户在系统里控制，App 不能再改**；App 内「提醒方式」通过切换到预先创建的不同渠道实现（如 `inquiry_ring` / `inquiry_vibrate` / `inquiry_silent`） |
| A/B 线索持续响铃 | 使用 `FLAG_INSISTENT`（声音循环直到用户处理）+ 高优先级渠道；全屏意图在 Android 14 起限制为通话 / 闹钟类应用，不使用 |
| 厂商消息分类 | 各厂商对营销类消息限量、静音，工作提醒需按厂商规则申请「服务与通讯」等类别，否则可能不响铃 |
| 后台限制 | 首次启动引导用户允许自启动、关闭电池优化（各品牌入口不同，提供图文说明） |
| 点击跳转 | 通知携带 `route`（例如 `customer/c123`），通过 Deep Link 进入对应页面并标记已读 |

### 4.2 HarmonyOS 5 / 6

| 项目 | 方案 |
| --- | --- |
| 通道 | Push Kit：App 启动获取 Push Token 上报 `POST /api/devices`；服务端调用华为推送服务端接口下发 |
| 权限 | `notificationManager.requestEnableNotification()` 申请通知权限 |
| 渠道 | 通知渠道（`SlotType`）：客户消息用社交通讯类、工作提醒用服务提醒类；用户可在系统设置单独调整 |
| 消息分类 | Push Kit 对通知消息分类管理：未申请分类权益的消息按资讯营销处理（静默、限量）。**需要在 AppGallery Connect 为工作提醒类消息申请对应分类权益**（以华为官方当期规则为准） |
| 持续响铃 | 需在真机验证系统是否允许循环提示音；若不允许，降级为「响铃一次 + 服务端每 1 分钟重推，最多 3 次，直到有人处理」 |
| 点击跳转 | 通知 `want` 参数携带路由，`UIAbility.onNewWant` 中跳转到对应 `NavDestination` |

### 4.3 两端共用的服务端规则

- 推送内容与现有 `notificationFeed` / `LeadAlert` 共用同一个稳定 id（`tag`），一个设备同一事件只显示一条；App 在前台时由 App 内横幅处理，不重复弹系统通知。
- 锁屏隐私：偏好为「隐藏客户姓名」时，推送正文只写「你有 1 条新询盘」。
- 免打扰：服务端按 `quietFrom/quietTo` 降为静默推送；A 级询盘可设为例外。
- Web Push（PWA）继续保留，电脑浏览器仍可收提醒。

## 5. Android 客户端

| 项目 | 选型 |
| --- | --- |
| 语言 / UI | Kotlin、Jetpack Compose、Material 3（主题由 `tokens.json` 生成 `LvColorScheme` / `LvTypography`） |
| 版本 | minSdk 26（Android 8.0，通知渠道起点），targetSdk 跟随应用市场要求 |
| 导航 | Navigation Compose，底部 5 个页签各自 back stack；支持预测性返回 |
| 网络 | Retrofit + OkHttp + kotlinx.serialization；统一解析 `{success,data,error}`；Cookie 持久化 + 加密存储 |
| 状态 | ViewModel + StateFlow；页面状态统一建模为 Loading / Empty / Error / Content |
| 图片 | Coil（产品图、附件） |
| 图表 | Compose Canvas 自绘（规则见设计系统 §7） |
| 安全 | 不缓存客户、订单、报价数据到磁盘（沿用 PWA 的数据政策）；截图敏感页可选 `FLAG_SECURE` |
| 模块 | `app`、`core:designsystem`、`core:network`、`core:push`、`feature:home/customers/orders/inbox/tasks/analytics/me` |

## 6. HarmonyOS 客户端

| 项目 | 选型 |
| --- | --- |
| 语言 / UI | ArkTS、ArkUI 声明式；颜色 / 尺寸放 `resources/base/element/*.json` 与 `resources/dark/element/color.json`（由 `tokens.json` 生成） |
| 版本 | HarmonyOS 5.0（API 12）起，适配 HarmonyOS 6 |
| 模型 | Stage 模型，单 `UIAbility` |
| 导航 | `Tabs` 承载 5 个页签，每个页签一个 `Navigation` + `NavPathStack`，系统侧滑返回由 `Navigation` 处理 |
| 网络 | `@kit.NetworkKit` http（或 Remote Communication Kit），同样解析信封；会话凭据存 Asset Store |
| 推送 / 通知 | `@kit.PushKit`、`@kit.NotificationKit` |
| 窗口 | 沉浸式布局 + 避让区，适配挖孔屏与底部手势条；折叠屏展开态先按单列居中，后续再做双栏 |
| 模块 | `entry`（HAP）+ `designsystem`、`network`、`push`、`features/*`（HAR） |
| 发布 | AppGallery Connect；企业内部分发需确认可用方式 |

## 7. 里程碑（建议）

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| M0 设计确认 | 评审本原型与本文；确认审批规则、回款记录、推送服务商、是否两端同时启动 | 确认记录 |
| M1 服务端基础 | S1–S5（只读接口、设备令牌、推送适配层、已读、偏好）+ OpenAPI 契约 | 接口 + 迁移 + 测试 |
| M2 Android 核心 | 登录、工作台、客户（列表 / 详情 / 新建 / 跟进 / 回访 / 阶段）、消息与推送 | 内测包 |
| M3 HarmonyOS 核心 | 同 M2 | 内测包 |
| M4 订单与数据 | 订单、报价查看、任务与日历、数据看板、通知设置 | 两端内测 |
| M5 扩展 | 新通知种类、系统公告、审批（若确认）、收款记录（若确认） | 正式版 |
| M6 上架 | 隐私政策、权限说明、各应用市场审核 | 上架 |

每个阶段结束都用原型作为验收基准：页面结构、文案、状态和交互一致。

## 8. 测试

- 服务端：沿用 `node:test` + CI（MySQL / MariaDB 双库），新增接口与迁移同 PR 带测试；推送适配层用假通道做单元测试。
- 客户端：Android Compose UI Test + 截图测试；HarmonyOS ArkTS 单元测试与 UI 测试。
- 真机矩阵：华为（HarmonyOS 5/6）、荣耀、小米、OPPO、vivo、三星 / Pixel；字号 100% / 最大；深色模式；360–430dp。
- 推送专项：App 前台 / 后台 / 被杀、锁屏、免打扰、通知权限拒绝、厂商消息分类是否响铃。

## 9. 待确认的决定

1. 两端同时启动，还是先 Android 后 HarmonyOS？
2. Android 推送：直接对接各厂商，还是用聚合推送服务？
3. 审批：是否需要？触发条件、审批人、金额阈值？
4. 回款：是否新增收款记录（金额、日期、定金 / 尾款）？
5. App 是否需要英文界面（销售团队是否有外籍成员）？
6. 分发方式：应用市场公开上架，还是企业内部分发？
7. 是否允许离线查看最近客户（当前 PWA 政策是不缓存任何客户数据）？
