# LVANJU BOS 移动端 · 第六步：Android / HarmonyOS 开发落地方案

> 状态：**方案，部分已确认**。按 PROJECT_RULES §0.5，以下涉及数据库与接口的改动都需要确认后再开发；目前没有改动任何生产代码。

## 0. 已确认的决定（2026-11-11）

| 决定 | 影响 |
| --- | --- |
| **先做 HarmonyOS 7 版，Android 随后**（2026-11-11 调整，原为两端同时开发） | HarmonyOS 版先行，工程在 `mobile/harmony`；Android 版沿用同一套接口契约、设计令牌和原型，在 HarmonyOS 版跑通后启动（§7） |
| **不做审批流程** | 原型与本方案删除审批页面、审批通知和 `Approval` 表；报价低于价格表只作为信息展示（`QuotationItem.listPrice` 已有） |
| **企业内部分发，不上应用市场** | Android 用公司签名的安装包 + App 内更新；HarmonyOS 走华为企业内部应用分发；服务端新增版本接口；推送统一用华为，需实测内部分发安装的 App 能否正常收推送（§4.1、§5.1、§6.1） |
| **公司配发手机：1 款华为 HarmonyOS 7 + 1 款 Android** | HarmonyOS 版以 HarmonyOS 7 为目标与最低版本（§6）；用设备管理统一安装、强制锁屏、设置自启动与电池白名单、远程擦除 |
| **不加收款记录** | 删除 S8；回款按订单付款状态统计单数 |
| **不做英文界面** | 删除 S10；App 内去掉语言设置 |
| **允许离线查看最近客户** | 采用默认范围（30 天、最多 100 位、每位最近 20 条动态）；新增离线方案（§3.1）与两个服务端改动 S12、S13；替代原来「手机上不缓存客户数据」的 PWA 政策（PWA 本身不变） |
| **App 名称 LVANJUBOS** | Android 写在 `app_name` 字符串资源，HarmonyOS 写在 `app.json5` 与入口 Ability 的 `label`；桌面、通知、安装与更新提示都显示这个名字 |
| **包名：HarmonyOS `online.avenlee.bos`，Android `online.avenlee.bos.android`** | 由公司系统域名 `avenlee.online` 倒过来加 `.bos`。AppGallery Connect 规定 HarmonyOS 应用包名不能与 Android 应用包名相同，所以 Android 版加 `.android`；两个包名发布后都不能改。包名只是标识，App 连接的服务器地址（`https://avenlee.online`）单独配置 |
| **推送统一用华为** | Android 版用华为推送（HMS Push Kit），HarmonyOS 版用 Push Kit；一个华为企业账号、一个 AppGallery Connect 项目下建两个应用，不接其他厂商、不用聚合推送（§4.1）。**前提：那款 Android 手机是带华为移动服务（HMS）的华为手机**，待确认机型 |
| **每位销售接入自己的 WhatsApp 号码（后续）** | 公司手机上登录各自在 BOS 连接的号码；BOS 需要先做「多号码 WhatsApp」改造，是独立项目（§2 S14）；App 的会话页显示从哪个号码发送 |

开工前需要公司准备的账号、证书、手机和素材见 [PREPARATION.md](PREPARATION.md)。

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
                  推送适配层（新增）：Web Push（现有）｜华为推送 Android 版｜华为 Push Kit HarmonyOS 版
```

- **业务规则只在服务端**：阶段规则、首联时限、等级响铃、权限作用域、业绩口径都由现有 `services/` 计算，两个客户端只展示和提交。
- **两个原生客户端**：HarmonyOS 5 及以后的版本（公司手机为 HarmonyOS 7）不再运行 Android APK，必须单独开发 HAP 应用；Android 版用于另一款 Android 手机。
- **共享的不是代码，是契约**：OpenAPI 接口契约（由现有 Zod schema 生成）、设计令牌（`tokens.json`）、文案与图标、原型（交互基准）。
- 也评估过跨平台方案（Flutter / React Native 的 OpenHarmony 分支）：可以少写一套 UI，但 HarmonyOS 推送、通知渠道、侧滑返回等系统能力仍需原生桥接，且社区适配版本落后于官方 SDK。业务以销售高频操作和可靠推送为核心，两端原生开发。
- **并行开发的协作方式**（已确认两端同时启动）：
  - 契约先行：每个功能先在服务端定好接口与 OpenAPI 描述，两端按同一份契约开发，不各自猜字段；
  - 设计令牌由 `tokens.json` 一次生成两端主题，颜色、字号、间距只改一处；
  - 同一功能两端同一迭代交付，用原型做验收基准，每周一次两端并排走查（同一部真机型号以外，各取一台华为与一台其他品牌）；
  - 推送、通知渠道、深链路由的命名在两端保持一致（例如路由 `customer/{id}`、渠道 `inquiry_urgent`）。

## 2. 服务端需要新增的能力（全部为加性改动）

| # | 能力 | 改动 | 是否必须 |
| --- | --- | --- | --- |
| S1 | 只读数据接口 | 新增 `GET /api/mobile/home`（一次返回工作台所需数字，内部复用 `business-cockpit-service`、`todayWorkCounts`、订单提醒、任务）；`GET /api/finance`、`GET /api/command-center`（复用现有 service，目前只有页面直连）| 必须 |
| S2 | 设备令牌 | 新表 `DeviceToken(userId, platform ANDROID/HARMONY, provider HMS/HARMONY_PUSH，字段用字符串，以后换品牌可以加值, token, appVersion, lastSeenAt, failures)`；`POST/DELETE /api/devices`；退出登录时注销 | 必须 |
| S3 | 推送适配层 | `push-service.ts` 抽象 `PushProvider`：现有 Web Push 保持不变，增加原生通道；`LeadAlert` 发件箱、今日简报、首联超时、任务提醒都改为调用适配层（行为不变，只是多了收件设备） | 必须 |
| S4 | 通知已读 | 新表 `NotificationRead(userId, itemId, readAt)`（itemId 即 `notificationFeed` 现有的稳定 id）；`POST /api/notifications/read`（ids / all）；feed 返回 `read` 字段 | 必须（多设备同步已读） |
| S5 | 通知偏好 | 新表 `NotificationPreference(userId, category, enabled, mode, quietFrom, quietTo, exceptGradeA)`；服务端据此决定是否推送、推送优先级 | 必须 |
| S6 | 新通知种类 | 新订单（订单创建时）、定金 / 尾款到账（付款状态变化）、物流超期（已有计算，补推送）、系统公告（新表 `Announcement`，管理员发布） | 建议 |
| ~~S7~~ | ~~审批流程~~ | 已确认不做（2026-11-11） | — |
| ~~S8~~ | ~~收款记录~~ | 已确认不加（2026-11-11），回款按付款状态统计 | — |
| S9 | 设备管理 | 登录设备列表与单设备退出（会话表或在 `DeviceToken` 上记录会话） | 可后置 |
| ~~S10~~ | ~~英文界面~~ | 已确认不需要（2026-11-11） | — |
| S11 | 版本与分发 | 新增 `GET /api/app/version?platform=android\|harmony`：返回最新版本号、最低支持版本、更新说明、安装包地址与 SHA-256。安装包不放进 Git 仓库，存放在服务器上仓库以外的目录或对象存储，下载需要登录 | 必须（企业内部分发） |
| S12 | 离线客户包 | 新增 `GET /api/mobile/offline/customers?since=`：按 §3.1 的范围返回客户资料与最近 20 条动态，支持增量（`since` 之后变化的客户 + 已移出范围的客户 id，用于本机删除）；复用 `scope()` 权限 | 必须（离线） |
| S13 | 跟进防重复 | `FollowUp` 新增可空唯一列 `clientRequestId`；离线跟进联网补发时带上，同一条重发不会生成两条（与 WhatsApp 的 `requestId` 幂等同一做法）。`followSchema` 增加可选字段，旧调用不受影响 | 必须（离线） |
| S14 | 多号码 WhatsApp（BOS 独立项目，App 依赖） | 现状：连接配置是单例（`WhatsAppIntegration.id='primary'`，受保护语义，不能改 id），Gupshup 发送号码只有一个环境变量 `GUPSHUP_SOURCE`；但联系人、会话、消息已经按号码记录（`WhatsAppContact.accountId`、`WhatsAppMessage.providerAccountId`），身份链具备多号码的基础。改造思路（加性）：新增号码表（号码、服务商账号、负责人、加密令牌、状态），单例保留为默认号码；发送时按客户负责人选号码；收件按号码路由；会话页显示号码。**需要先确认的规则**：客户转交给别的销售后，用原号码继续聊还是换新号码（客户会看到号码变了）；广告「点击 WhatsApp」的线索进哪个号码、怎么分配；管理员能否看所有号码的会话；每个号码在服务商（Gupshup / Meta 共存）各自如何开通与计费 | 后续，单独设计 |

所有新表按 PROJECT_RULES §2 走 Prisma migration，新列可空或有默认值；`{success,data}` 信封与现有字段不变。

## 3. 认证

- **V1 沿用现有 Cookie 会话**：`POST /api/auth/login` 返回 `Set-Cookie: crm_session`（HttpOnly、7 天）。Android 用 OkHttp 持久化 `CookieJar`（加密存储），HarmonyOS 用网络库的 Cookie 管理并把会话存入 Asset Store（安全存储）。不需要改接口。
- 联调验证项：原生请求不带 `Origin` 时 `middleware.ts` 放行；会话过期（401）统一跳登录页并保留当前页面以便登录后返回。
- 可选 V2：增加 Bearer Token（加性：同一会话签名，放在 `Authorization` 头），便于未来接入更多客户端。
- 生物识别解锁只在本机验证（Android BiometricPrompt / HarmonyOS 用户认证 Kit），不上传生物信息，不替代服务端会话。

### 3.1 离线查看最近客户（2026-11-11 确认）

| 项目 | 规则 |
| --- | --- |
| 范围 | 销售：自己负责的客户；管理员：自己负责的 + 最近查看过的（不保存全公司）。其中最近 30 天联系过或有下次跟进的，最多 100 位 |
| 内容 | 客户资料、联系方式、阶段、标签、下次跟进、最近 20 条动态；不保存订单、报价、经营数据和完整聊天记录 |
| 同步 | 登录后、每次回到前台、下拉刷新时调用 S12 增量同步；页面顶部显示「离线 · 显示 HH:mm 保存的数据」 |
| 离线写入 | 只允许写跟进（只追加，不会和别人的修改冲突）：保存在本机，联网后带 `clientRequestId` 自动补发（S13）。改阶段、回访、标签、分配、新建客户都需要联网 |
| 加密 | Android：本地数据库加密（如 SQLCipher），密钥由 Android Keystore 保护，关闭系统备份；HarmonyOS：关系型数据库开启加密，密钥放 Asset Store |
| 清除 | 退出登录、会话失效（账号停用、修改密码）、设备管理远程擦除时清空；「我的 → 离线数据」可手动清除（有未同步跟进时先提醒） |

## 4. 推送与通知（两端分别实现，不能用页面弹窗代替）

### 4.1 Android

| 项目 | 方案 |
| --- | --- |
| 通道 | **华为推送（HMS Push Kit）**，直接对接，不用聚合推送。App 启动时取 Push Token 上报 `POST /api/devices`。HMS Push 只在带华为移动服务（HMS）的华为手机上可靠送达；如果那款 Android 手机不是华为，需要改接该品牌自己的推送（小米、OPPO、vivo、荣耀各有一套） |
| 权限 | Android 13+ 运行时申请 `POST_NOTIFICATIONS`；首次在「工作台」用说明页解释用途再申请，拒绝后在通知设置页引导去系统设置 |
| 渠道 | 每个通知分类一个 `NotificationChannel`：`inquiry_urgent`、`inquiry`、`order`、`followup`、`exception`、`announcement`。**渠道创建后声音 / 振动由用户在系统里控制，App 不能再改**；App 内「提醒方式」通过切换到预先创建的不同渠道实现（如 `inquiry_ring` / `inquiry_vibrate` / `inquiry_silent`） |
| A/B 线索持续响铃 | 使用 `FLAG_INSISTENT`（声音循环直到用户处理）+ 高优先级渠道；全屏意图在 Android 14 起限制为通话 / 闹钟类应用，不使用 |
| 消息分类 | 华为推送对营销类消息限量、静音；工作提醒要在 AppGallery Connect 申请对应的消息分类权益，否则可能不响铃（Android 与 HarmonyOS 两个应用分别申请） |
| 后台限制 | 公司手机由设备管理统一设置自启动与电池白名单；没有纳入设备管理的手机，首次启动时用图文说明引导设置 |
| 企业内部分发的影响 | 只接华为一家：在 AppGallery Connect 同一项目下登记 Android 应用（包名 `online.avenlee.bos.android` + 签名证书指纹）即可开通推送；M0 阶段用测试机实测内部分发安装的 App 能否拿到 Token、收到推送 |
| 点击跳转 | 通知携带 `route`（例如 `customer/c123`），通过 Deep Link 进入对应页面并标记已读 |

### 4.2 HarmonyOS 7

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
- 服务端推送适配层只需三个通道：Web Push（现有）、华为推送 Android 版、华为 Push Kit HarmonyOS 版。两个华为通道的服务端发送接口不同，在适配层里分开实现，共用同一个 AppGallery Connect 项目的凭据。

## 5. Android 客户端

| 项目 | 选型 |
| --- | --- |
| 语言 / UI | Kotlin、Jetpack Compose、Material 3（主题由 `tokens.json` 生成 `LvColorScheme` / `LvTypography`） |
| 版本 | minSdk 26（Android 8.0，通知渠道起点），targetSdk 跟随当前 Android 版本（内部分发不受应用市场限制，但新系统对低 targetSdk 应用有安装提示与行为限制） |
| 导航 | Navigation Compose，底部 5 个页签各自 back stack；支持预测性返回 |
| 网络 | Retrofit + OkHttp + kotlinx.serialization；统一解析 `{success,data,error}`；Cookie 持久化 + 加密存储 |
| 状态 | ViewModel + StateFlow；页面状态统一建模为 Loading / Empty / Error / Content |
| 图片 | Coil（产品图、附件） |
| 图表 | Compose Canvas 自绘（规则见设计系统 §7） |
| 安全 | 只按 §3.1 离线保存最近客户（加密），订单、报价不落盘；截图敏感页可选 `FLAG_SECURE` |
| 模块 | `app`、`core:designsystem`、`core:network`、`core:push`、`core:update`、`core:offline`、`feature:home/customers/orders/inbox/tasks/analytics/me` |

### 5.1 Android 企业内部分发

| 项目 | 方案 |
| --- | --- |
| 签名 | 公司专用签名密钥（keystore）由管理员保管，不进仓库、不放在开发电脑上；CI 打包时从密钥管理处读取。密钥丢失后已安装的 App 无法覆盖升级，必须离线备份 |
| 首次安装 | 管理员把下载页地址发给员工 → 手机浏览器打开 → 下载安装包 → 系统提示允许「安装未知应用」→ 安装。下载页需要登录 BOS 账号，防止安装包外流 |
| App 内更新 | 启动和每天首次回到前台时调用 `GET /api/app/version`；有新版本时提示（原型「我的 → 关于 → 检查更新」）；下载后校验 SHA-256，再交给系统安装程序；需要 `REQUEST_INSTALL_PACKAGES` 权限 |
| 强制更新 | 低于服务端返回的最低支持版本时，打开 App 只显示更新页（接口有不兼容变更时使用） |
| 国内手机安装拦截 | 部分品牌会对非应用市场来源的安装包弹出风险提示或「纯净模式」拦截，安装说明里附各品牌关闭方法 |

## 6. HarmonyOS 客户端

| 项目 | 选型 |
| --- | --- |
| 语言 / UI | ArkTS、ArkUI 声明式；颜色 / 尺寸放 `resources/base/element/*.json` 与 `resources/dark/element/color.json`（由 `tokens.json` 生成） |
| 版本 | 公司手机为 **HarmonyOS 7（API 26）**，用 DevEco Studio 26 开发；`compatibleSdkVersion` 设为 `5.0.0(12)`，代码只用 API 12 已有的能力，HarmonyOS 7 手机正常安装，只在 HarmonyOS 7 上测试和保证 |
| 模型 | Stage 模型，单 `UIAbility` |
| 导航 | 根部一个 `Navigation` + `NavPathStack`，五个页签（`Tabs`）在它的根内容里，详情页压在上面并盖住底栏；切回页签时位置保留，系统侧滑返回由 `Navigation` 处理（与「每个页签一个栈」效果相同，但更简单） |
| 网络 | `@kit.NetworkKit` http（或 Remote Communication Kit），同样解析信封；会话凭据存 Asset Store |
| 推送 / 通知 | `@kit.PushKit`、`@kit.NotificationKit` |
| 窗口 | 沉浸式布局 + 避让区，适配挖孔屏与底部手势条；折叠屏展开态先按单列居中，后续再做双栏 |
| 本地存储 | 离线客户用关系型数据库（开启加密），设置项用 Preferences |
| 模块 | `entry`（HAP）+ `designsystem`、`network`、`push`、`offline`、`features/*`（HAR） |

### 6.1 HarmonyOS 企业内部分发

HarmonyOS 5 及以后的版本（包括公司手机的 HarmonyOS 7）不能像 Android 一样直接安装任意安装包，内部分发要走华为提供的企业方式。以下为规划，**具体资格、证书类型与安装方式以华为当期规则为准，M0 阶段先办理并实测**：

| 项目 | 方案 |
| --- | --- |
| 账号与资格 | 公司注册华为开发者联盟**企业账号**，在 AppGallery Connect 创建项目；申请企业内部应用分发相关资格 |
| 证书 | 使用对应的企业分发证书与 Profile 签名 HAP；证书和私钥同样由管理员保管 |
| 安装与更新 | 通过华为支持的企业内部分发渠道（例如企业设备管理 / 内部分发链接）安装；App 内「检查更新」读取 `GET /api/app/version`，引导到对应安装页 |
| 试点期 | 正式资格办下来之前，可用 AppGallery Connect 的测试分发方式给少量员工安装（有人数和有效期限制） |
| 推送 | Push Kit 绑定同一 AppGallery Connect 项目；需实测企业分发安装的 App 能正常获取 Push Token 并收到通知，并按 §4.2 申请消息分类 |

## 7. 里程碑（建议）

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| M0 准备 | 剩余决定（§9）；华为企业开发者账号与内部分发资格、Android 签名密钥；用测试机实测华为推送在内部分发下可用（两端）；两端工程骨架与令牌生成 | 账号、证书、核实结论 |
| M1 服务端基础 | S1–S5、S11–S13（只读接口、设备令牌、推送适配层、已读、偏好、版本与分发、离线客户包、跟进防重复）+ OpenAPI 契约 | 接口 + 迁移 + 测试 |
| M2 HarmonyOS 核心（0.1 已建立，见 §10） | 登录、工作台、客户（列表 / 详情 / 新建 / 跟进 / 回访 / 阶段）、离线客户与跟进补发、消息、WhatsApp 会话、推送与通知渠道、App 内更新 | HarmonyOS 内测包 |
| M3 HarmonyOS 业务功能；Android 版启动并追平 M2 | 订单、报价查看、任务与日历、数据看板、通知设置、账号与安全 | 两端内测 |
| M4 扩展 | 新通知种类（新订单、到账、物流超期、系统公告） | 两端候选版 |
| M5 内部推广 | 隐私与权限说明；先给 3–5 名销售和管理员试用一到两周，修完问题后全员安装 | 正式版 |

每个阶段结束都用原型作为验收基准：页面结构、文案、状态和交互一致。

## 8. 测试

- 服务端：沿用 `node:test` + CI（MySQL / MariaDB 双库），新增接口与迁移同 PR 带测试；推送适配层用假通道做单元测试。
- 客户端：Android Compose UI Test + 截图测试；HarmonyOS ArkTS 单元测试与 UI 测试。
- 真机矩阵：公司选定的华为 HarmonyOS 7 机型、Android 机型各 2 台，另加 1 台小屏手机；字号 100% / 最大；深色模式；360–430dp。
- 分发专项：首次安装（各品牌安装拦截提示）、覆盖升级、强制更新、签名不一致时的提示。
- 离线专项：飞行模式查看、离线写跟进后联网补发（含网络时断时续时不重复）、离线期间被停用账号、清除离线数据。
- 推送专项：App 前台 / 后台 / 被杀、锁屏、免打扰、通知权限拒绝、华为消息分类权益是否生效（会不会响铃）。

## 9. 待确认的决定

已确认：先做 HarmonyOS 7 版、Android 随后；不做审批；企业内部分发；公司配发手机（华为 HarmonyOS 7 + 1 款 Android）；不加收款记录；不做英文界面；允许离线查看最近客户（默认范围）；App 名称 LVANJUBOS；包名 HarmonyOS `online.avenlee.bos` / Android `online.avenlee.bos.android`；推送统一用华为；后续每位销售接入自己的 WhatsApp 号码（见 §0）。

仍需确认：

1. **Android 那款手机的具体型号**：需要确认是带华为移动服务（HMS）、能安装 Android 应用的华为手机；不是的话推送要改接该品牌。
2. 手机采购数量。
3. 多号码 WhatsApp（S14）的业务规则，单独设计时确认（见 §2）。

## 10. 开发进度

| 日期 | 进度 |
| --- | --- |
| 2026-11-11 | 华为企业账号已注册。HarmonyOS 工程 0.1 建立（`mobile/harmony`）：登录、工作台、客户队列与详情（拨号、写跟进）、订单列表与详情、消息、我的；只用现有接口，服务端未改动。数据层经 TypeScript 严格检查，界面代码待第一次在 DevEco Studio 26 中编译验证 |
| 2026-11-11 | AGC 已创建 APP ID（LVANJUBOS / `online.avenlee.bos`）。发布路线：①开发调试 → ②邀请测试（3–5 人试用）→ ③企业内部应用发布（全员）；操作指南 HARMONY_RELEASE_GUIDE.md，后台资料与隐私政策草稿在 `mobile/harmony/store/` |
| 2026-11-11 | 0.1 在 HarmonyOS 7 真机上运行。修复：`data/` 目录被根 `.gitignore` 排除（改名 `api/`）、LvIcon 属性名冲突；工作台改为分块加载并写明失败原因 |
| 2026-11-11 | 1.1：①流畅度——所有 GET 结果缓存在本机（内存 + 缓存目录），每个页面先显示上次数据再后台刷新；长列表改为 LazyForEach 按需渲染；图标路径缓存。②补数据——「消息」加入 WhatsApp 对话（会话列表、聊天、24 小时窗口内直接回复，窗口外提示到电脑端发模板，每 15 秒拉新消息）；工作台加入本月业绩（销售：个人业绩 / 目标完成；管理员：全公司 + 销售排行）；客户详情可改阶段（同电脑端看板规则）、WhatsApp 直达聊天；新增「我的待办」全部任务页。全部复用现有接口，服务端与数据库未改动 |

| 2026-11-11 | 1.1：WhatsApp 主动联系——24 小时窗口外（或从未聊过）时，聊天页改为「选择模板消息」：读取 Gupshup 里 Meta 审核通过的文字模板（GET /api/whatsapp/templates），按客户来源推荐开场白，变量按客户资料自动填好、可修改，预览后发送（POST /api/whatsapp/templates）；频率限制、退订拦截与电脑端相同。客户回复后自动切回自由聊天 |

| 2026-11-11 | 1.2：沟通工具与数据分析。聊天页输入区重新布局：一排工具（AI 回复 / 优化话术 / 译成外文 / 快捷回复 / 图片 / 文件 / 产品资料 / 模板），AI 建议以卡片出现在输入框上方，「用这条」只放进输入框不自动发送；译成外文后保留中文原意并随消息存为 original；客户消息自动译成中文（最新 10 条）或逐条「翻译成中文」；聊天图片可直接看、点开全屏；手机相册图片（HEIC / 超过 4.5 MB 自动转 JPEG）和文件（PDF、Word、Excel 等 ≤ 20 MB）可直接发送；产品资料库多选（≤ 10 个）发送。新增「数据分析」页（工作台业绩卡片、我的 进入）：按月切换，销售额与目标、客户转化漏斗、首联速度，管理员看销售对比。全部复用电脑端接口：ai-reply、inbox/polish、translate-out、translate、translate-batch、quick-replies、inbox/materials、whatsapp/media、sales-team/performance |

**HarmonyOS 上的 WhatsApp**：据目前了解，WhatsApp 没有 HarmonyOS 5 及以后版本的原生 App，在 HarmonyOS 7 手机上只能借助「卓易通」这类兼容工具运行，需要在公司手机上实测。因此 HarmonyOS 版联系客户以 App 内的 WhatsApp 会话（走 BOS 接入的 WhatsApp API）为主，这也是下一步的重点；手机 WhatsApp 共存模式（S14）需要按实测结果定。

