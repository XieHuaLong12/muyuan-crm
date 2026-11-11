# LVANJUBOS · HarmonyOS 版

LVANJU BOS 的 HarmonyOS 原生 App（ArkTS + ArkUI，Stage 模型）。设计与交互以 [`prototypes/mobile-app`](../../prototypes/mobile-app/) 为准，方案见 [`docs/mobile-app`](../../docs/mobile-app/README.md)。

| 项目 | 值 |
| --- | --- |
| 应用名称 | LVANJUBOS |
| 包名（bundleName） | `online.avenlee.bos`（与 AppGallery Connect 的 APP ID 一致，发布后不能改） |
| 目标设备 | 公司配发的华为手机，HarmonyOS 7（API 26） |
| 最低版本（compatibleSdkVersion） | `5.0.0(12)`：代码只用 API 12 就有的能力；HarmonyOS 7 手机可以正常安装 |
| 服务器 | 默认 `https://avenlee.online`；登录页「服务器 · 更改」可切到测试站 |

## 当前版本 0.1 包含什么

全部使用 BOS **现有接口**，服务端不用改：

| 页面 | 能做什么 | 接口 |
| --- | --- | --- |
| 登录 | 邮箱 + 密码登录；会话加密保存在本机（Asset Store），7 天内免登录 | `POST /api/auth/login`、`GET /api/bootstrap` |
| 工作台 | 今日需要跟进、待首联、等你回复、高意向、待处理订单；待分配 / 待首联提醒；今天与逾期的待办，点圆圈完成 | `/api/bos/sales`、`/api/notifications`、`/api/orders`、`/api/tasks` |
| 客户 | 队列：待分配（管理员）、今日跟进、待首联、等我回复、高意向、全部；搜索；下拉刷新 | `/api/bos/sales`、`/api/customers?assign=pending` |
| 客户详情 | 一键拨号、复制 WhatsApp / 邮箱、下次跟进与首联截止、AI 建议、动态（跟进、阶段、成交）、资料；**写跟进**并设置下次跟进 | `GET /api/customers/:id`、`POST /api/customers/:id/followups` |
| 订单 | 待付款 / 待发货 / 物流异常 / 待收尾款；按状态筛选；搜索；订单详情（七段进度、付款、生产、发货、产品、客户、报价单） | `/api/orders`、`/api/orders/:id` |
| 消息 | 最近 24 小时的提醒（新线索、分配、首联截止、任务、客户消息），点开进入客户；底部角标 | `/api/notifications` |
| 我的 | 账号、服务器、版本、退出登录 | `POST /api/auth/logout` |

权限由服务器判断，和电脑端一致：销售只看到自己的客户和订单，管理员看到全部。

**还没有的功能**（按 [NATIVE_PLAN.md](../../docs/mobile-app/NATIVE_PLAN.md) 后续里程碑做）：App 内 WhatsApp 会话、任务页与日历、经营数据与财务、新建客户、改阶段与回访、系统推送（Push Kit）、通知设置、离线查看、App 内更新。其中经营数据、推送、离线、更新需要先在服务端加接口（S1–S5、S11–S13）。

## 用 DevEco Studio 打开和运行

> 第一次发布 App？按 [docs/mobile-app/HARMONY_RELEASE_GUIDE.md](../../docs/mobile-app/HARMONY_RELEASE_GUIDE.md) 一步步做。华为后台「应用上架 / 软件包管理」是公开上架用的，企业内部分发现在不用碰。

1. 安装 **DevEco Studio 26**（带 HarmonyOS 7 / API 26 SDK）。
2. 「Open」选择本目录 `mobile/harmony`。首次打开会同步 hvigor 和 ohpm；若提示升级 `modelVersion` 或设置 `targetSdkVersion`，按提示操作（目标选 HarmonyOS 7）。
3. 签名：「File → Project Structure → Signing Configs」勾选「Automatically generate signature」，用公司华为开发者账号登录。自动签名会使用包名 `online.avenlee.bos`，所以要先在 AppGallery Connect 创建好这个 APP ID。**签名文件不要提交到仓库**（`.gitignore` 已排除）。
4. 手机打开「开发者模式」和「USB 调试」，连接电脑后点「Run」。
5. 第一次登录前，在登录页底部「服务器 · 更改」填测试站地址（例如 `https://test.avenlee.online`）。测试站还没搭好时，用正式站也可以，但要注意「写跟进」会写进真实客户记录。

AppGallery Connect「新建 APP ID」的填法：应用类型 HarmonyOS 应用；应用名称 `LVANJUBOS`；应用包名 `online.avenlee.bos`；应用分类 应用；支持设备 手机；默认语言 简体中文；应用所属项目 新建 `LVANJUBOS`。

## 第一次编译时请重点看的地方

这个工程是在没有 HarmonyOS SDK 的环境里写的：数据层用 TypeScript 严格模式检查过，资源和图标引用都核对过，但界面代码（ArkUI）还没经过真正的编译。第一次编译如果报错，把 DevEco Studio 的报错原文发给我，我来改。可能需要按当前 SDK 调整的地方：

- `build-profile.json5` / `hvigor-config.json5` 的版本号字段（DevEco Studio 会提示）。
- `Session.ets` 里 Asset Store 的调用（保存登录会话）。
- `LvIcon.ets` 用 `Path` 画图标：如果图标大小不对，告诉我在哪个页面。

真机上请按这个顺序试一遍：登录 → 工作台数字与电脑端「今日跟进」一致 → 客户列表切换队列、搜索 → 客户详情拨号、写跟进（电脑端能看到这条跟进）→ 订单列表与详情 → 消息点开进入客户 → 退出登录再打开 App 要求重新登录。

## 目录

```
mobile/harmony/
├── AppScope/                    应用级配置：包名、名称、图标
├── entry/src/main/
│   ├── module.json5             模块配置：入口 Ability、权限（网络）
│   ├── ets/
│   │   ├── entryability/        启动：恢复会话后加载首页
│   │   ├── pages/Index.ets      根导航：一个 Navigation 栈，五个页签在底层，详情页压在上面
│   │   ├── views/               登录、页签（工作台 / 客户 / 订单 / 消息 / 我的）、客户详情、订单详情
│   │   ├── components/          设计系统组件：LvIcon、Pill、Avatar、StateView、StatTile、OrderSteps
│   │   ├── api/                 Http（{success,data} 信封、会话 Cookie、401 回到登录）、Session、Repo、Models、Inbox
│   │   └── common/              配置、文案常量（与 lib/constants.ts 一致）、格式化
│   └── resources/               颜色（浅色 / 深色）、尺寸、字符串、图标与 Logo
└── README.md
```

颜色、尺寸由 `prototypes/mobile-app/tokens.json` 生成，图标由 Lucide 0.468.0 生成，**不要手改生成的文件**：

```sh
node mobile/tools/gen-harmony-tokens.mjs                      # → resources/base|dark/element/color.json, float.json
python3 mobile/tools/gen-harmony-icons.py <lucide-static>/icons  # → ets/components/IconData.ets
```

App 图标（`AppScope/resources/base/media/foreground.png`、`background.png`）是临时图标：品牌绿底 + 白色房屋窗格标志。拿到 Logo 矢量源文件后替换。
