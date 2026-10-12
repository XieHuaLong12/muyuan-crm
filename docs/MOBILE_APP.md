# 手机 App（PWA）

CRM 可以安装到手机桌面：有自己的图标，点开全屏运行，没有浏览器地址栏，用起来和 App 一样。它和电脑版是同一个网站、同一个账号和数据，不需要应用商店，也不需要单独发版——网站更新后，手机上下次打开就是新版本。

## 怎么安装

前提：用正式域名的 **HTTPS** 地址打开（`http://` 或局域网 IP 不能安装）。

| 手机 | 步骤 |
| --- | --- |
| 安卓（Chrome / Edge / 三星浏览器） | 登录后页面顶部出现「把 CRM 装到手机桌面」，点「安装」。没有出现时：浏览器右上角菜单 →「安装应用」或「添加到主屏幕」 |
| 安卓（华为 / 小米 / OPPO / vivo 自带浏览器） | 浏览器菜单 →「添加到桌面」或「添加至主屏幕」。如果只能生成普通书签，改用 Chrome 或 Edge 安装 |
| iPhone / iPad | 用 Safari 打开 → 点「分享」按钮（新版 iOS 在「···」菜单里）→「添加到主屏幕」。页面顶部的提示里也写了这一步 |
| 微信里打开的链接 | 微信内无法安装：点右上角「···」→「在浏览器打开」，再按上面的步骤安装 |

提示条可以点「×」关掉，之后不再出现；已经从桌面图标打开时也不会出现。电脑上不显示提示条（Chrome / Edge 地址栏右侧仍可安装成桌面应用）。

**iPhone 注意**：从桌面图标打开的 App 和 Safari 不共享登录状态，第一次打开需要重新登录一次。

长按 App 图标（安卓）可以直接进入「今日跟进」「客户」「待办」。

## 提醒通知

在 App 顶部点「开启桌面通知」并允许后，新线索、新分配和到期任务会以系统通知弹出，点通知直接打开对应的客户或任务。

- 安卓：Chrome / Edge 中安装的 App 支持。
- iPhone：需要 iOS 16.4 及以上，并且必须是从桌面图标打开的 App（Safari 网页里没有通知权限）。
- 提醒由打开着的 App 每 20 秒检查一次（后台每分钟一次）。**App 被完全关掉或被系统冻结后不会收到通知**——要在关闭状态下也推送，需要服务器端 Web Push（新增订阅表和推送服务），目前没有做。

## 没有网络时

客户数据始终从服务器读取，手机上不缓存任何客户、订单或报价数据（数据私密、也必须是最新的）。断网时打开页面会显示「网络未连接」，联网后自动重新打开。

## 实现

| 文件 | 作用 |
| --- | --- |
| `app/manifest.ts` | 应用名称、图标、全屏显示、主题色和长按快捷方式（`/manifest.webmanifest`） |
| `app/icon.png`、`app/apple-icon.png`、`public/icons/` | 浏览器标签图标、iPhone 桌面图标、安卓图标（含可裁剪的 maskable 图标），由 `public/brand/lvanju-logo.jpg` 生成 |
| `public/sw.js` | Service Worker：断网时返回离线页；点击通知打开对应页面。**不缓存页面和接口数据** |
| `public/offline.html` | 离线页 |
| `components/pwa.tsx` | 生产环境注册 Service Worker；触屏设备上的安装提示条（`BOSShell` 页面顶部） |
| `components/live-notifications.tsx` | 系统通知优先通过 Service Worker 显示（手机只支持这种方式），没有时退回网页通知 |
| `next.config.ts` | `/sw.js` 返回 `Cache-Control: no-cache`，保证手机能及时拿到新版本 |

更新 `public/sw.js` 后，手机下次打开会自动换成新版本；如果改了离线页内容，把 `sw.js` 里的 `CACHE` 版本号加一。

## 想上架应用商店 / 要 APK 安装包

部署到正式 HTTPS 域名后，可以把网址填进 [PWABuilder](https://www.pwabuilder.com/) 生成安卓 APK / AAB（Trusted Web Activity），或打包提交 Google Play、Microsoft Store。安装包里打开的仍是这个网站，数据和功能与网页版一致；按 PWABuilder 的说明把生成的 `assetlinks.json` 放到 `public/.well-known/` 后，打开时不会显示浏览器地址栏。
