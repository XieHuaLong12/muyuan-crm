# LVANJU BOS App · 高保真交互原型

打开 `index.html` 即可预览（纯静态文件，可直接双击打开，无需安装或构建）。设计说明见 [docs/mobile-app](../../docs/mobile-app/README.md)。

> ⚠️ 原型使用本地示例数据（MOCK），不连接 BOS 接口，不参与 Next.js 构建与部署。

## 目录

| 路径 | 内容 |
| --- | --- |
| `tokens.json` | 设计令牌源文件（Android / HarmonyOS 共用） |
| `css/tokens.css` | 浅色 / 深色 / 跟随系统三态令牌 |
| `css/base.css` | 原型舞台：设备框、状态栏、控制台（不属于 App 界面） |
| `css/components.css` | 组件：顶栏、底部导航、按钮、卡片、列表、徽标、芯片、分段、表单、开关、步骤条、时间线、弹层、对话框、提示、悬浮按钮、空 / 错 / 骨架 |
| `css/screens.css` | 各页面布局 |
| `js/core.js` | 路由（每个页签独立返回栈）、底部导航、弹层 / 确认框 / 提示、下拉刷新、左边缘返回手势、加载 / 空 / 错状态 |
| `js/ui.js` | 组件函数 |
| `js/charts.js` | 累计走势、横向条形、分段条 |
| `js/mock-data.js` | **示例数据**（字段与取值域沿用 BOS） |
| `js/screens/*.js` | 页面：登录、工作台、客户、订单与报价、消息、任务、数据、我的 |
| `js/icons.js` | Lucide 0.468 图标（ISC 许可，与 PC 同版本） |
| `assets/` | Logo 与产品缩略图（来自 `public/`） |

## 演示要点

- 控制台（电脑）或「我的 → 原型演示工具」（手机）：切换管理员 / 销售、Android / HarmonyOS、360–430dp、浅色 / 深色、字体大小、加载 / 空 / 出错，模拟系统推送。
- 返回：设备左边缘向右滑，或按 Esc；危险操作会二次确认，可逆操作提供「撤销」。
- 链接直达：`index.html#dashboard`、`#customers`、`#customer`、`#orders`、`#order`、`#inbox`、`#tasks`、`#analytics`、`#me`、`#notifications`。
