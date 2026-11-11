# LVANJU BOS 移动端（Android / HarmonyOS）设计与原型

面向销售团队、管理人员和老板的手机 App 设计。不是把电脑版缩小，而是按手机上的高频工作重新组织：联系客户、写跟进、看数、处理提醒。

## 交付物

| 步骤 | 文档 / 产物 |
| --- | --- |
| 1 · 分析现有系统 | [ANALYSIS.md](ANALYSIS.md)：技术框架、页面导航、业务规则、角色权限、接口、品牌规范、需求与现状对照 |
| 2 · 信息架构 | [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md)：导航、页面清单、操作流程与点击次数、页面状态、通知分类 |
| 2 · 设计规范 | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)：颜色、字体与数字、间距、图标、组件（含 Compose / ArkUI 对应）、图表、动效、平台差异 |
| 3–4 · 高保真可交互原型 | [`prototypes/mobile-app/`](../../prototypes/mobile-app/)：19 个页面 + 20 余个底部弹层，管理员 / 销售两种身份 |
| 5 · 检查 | [QA_CHECKLIST.md](QA_CHECKLIST.md)：自动化交互检查、一致性、需求覆盖、原型边界 |
| 6 · 对照 | [PROTOTYPE_PARITY.md](PROTOTYPE_PARITY.md)：HarmonyOS App 与原型逐页差距清单，A 批（不改服务端）/ B 批（需确认） |
| 6 · 开发落地 | [NATIVE_PLAN.md](NATIVE_PLAN.md)：已确认决定、服务端加性改动、认证、离线、两端推送与通知、Android / HarmonyOS 技术选型与企业内部分发、里程碑、待确认决定 |
| 开工准备 | [PREPARATION.md](PREPARATION.md)：手机、账号证书与资质、品牌素材、服务器与开发环境、团队、离线默认值、开工顺序 |
| HarmonyOS 版工程 | [`mobile/harmony`](../../mobile/harmony/README.md)：0.1 版（登录、工作台、客户与写跟进、订单、消息、我的），用 DevEco Studio 26 打开 |
| HarmonyOS 版发布 | [HARMONY_RELEASE_GUIDE.md](HARMONY_RELEASE_GUIDE.md)：从开发调试、邀请测试到企业内部发布的逐步操作；后台资料、隐私政策草稿、图标在 `mobile/harmony/store/` |

## 预览原型

直接用浏览器打开 `prototypes/mobile-app/index.html` 即可（无需安装依赖、无需构建）。

- 电脑上：左侧是原型控制台（切换身份、页面直达、平台、屏幕宽度 360–430、主题、字体大小、数据状态、模拟系统推送），右侧是手机。
- 手机上：全屏运行；「我的 → 原型演示工具」里有同样的切换项。
- 返回：设备左边缘向右滑，或按 Esc。下拉页面顶部可刷新。

所有数据为示例（MOCK，见 `prototypes/mobile-app/js/mock-data.js`），不连接任何 BOS 接口。

## 与现有系统的边界

- 没有修改 `app/`、`components/`、`services/`、`lib/`、`prisma/` 中的任何文件，没有数据库迁移，没有接口变化。HarmonyOS 版只调用现有接口。
- 原型放在 `prototypes/`，不参与 Next.js 构建与部署；ESLint 已忽略该目录（`eslint.config.mjs`）。`mobile/`（原生工程与生成工具）同样被 ESLint 和 `tsconfig.json` 排除，不影响网站构建。
- 服务端需要的新能力（设备令牌、推送适配、通知已读与偏好、只读数据接口等）列在 NATIVE_PLAN §2，**确认后再按 PROJECT_RULES 开发**。

## 按 PROJECT_RULES §0.5.2 的 7 段摘要

1. **需求理解**：为 Android 与 HarmonyOS（公司手机为 HarmonyOS 7）设计原生 App 的 UI/UX，先交付设计规范与可交互原型，确认后再开发。
2. **对 BOS 的影响**：新增两个客户端，共用现有 API 与业务规则；不改变各模块边界。
3. **涉及模块**：本次仅新增 `docs/mobile-app/`、`prototypes/mobile-app/`，以及 ESLint 忽略原型目录。
4. **数据变化**：本次无。后续建议的加性表 / 列见 NATIVE_PLAN §2（DeviceToken、NotificationRead、NotificationPreference、Announcement、FollowUp.clientRequestId）；审批、收款记录已确认不做。
5. **API 变化**：本次无。后续新增只读接口与设备、已读、偏好、版本与分发、离线客户包接口；跟进接口加一个可选字段。现有信封与字段不变。
6. **UI 变化**：PC 与 PWA 页面不变；移动端设计系统沿用 BOS 品牌绿、焦点色、状态色与 Lucide 图标。
7. **实施计划**：见 NATIVE_PLAN §0 已确认决定、§7 里程碑、§9 仍待确认的事项，以及 PREPARATION 开工准备。
