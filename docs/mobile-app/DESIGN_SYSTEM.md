# LVANJU BOS 移动端 · 第二步（下）：设计系统

> 方向：现代企业级 SaaS + 极简 + 商务感。一块偏绿的安静画布，白色卡片承载数据，深森林绿只用在「操作」上。
> 令牌源文件：[`prototypes/mobile-app/tokens.json`](../../prototypes/mobile-app/tokens.json)（原型 `css/tokens.css`、Android Compose 主题、HarmonyOS `resources` 都由它生成）。

## 1. 设计原则

1. **先结论后明细**：每页顶部给一个结论（今日业绩、今日需跟进 7 位、物流异常 1 单），明细往下放。
2. **颜色只表达状态和操作**：品牌绿 = 可点的主操作 / 当前位置；红 = 逾期、异常、未读；橙 = 即将到期、待处理；其余都是中性色。不用颜色做装饰。
3. **一个屏幕一个主操作**：详情页底部固定 1–2 个按钮，最重要的在右侧（拇指区）。
4. **数字可读优先**：金额带币种符号、千分位；老板视角的大数用「万」；列内数字用等宽数字；不同币种不折算。
5. **不伪造**：未知显示「—」；AI 内容标「AI 建议 · 需人工确认」；规划中的能力标「规划」；示例数据标「示例（MOCK）」。

## 2. 颜色

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `bg` | `#F5F6F2` | `#0D1310` | 页面画布 |
| `surface` | `#FFFFFF` | `#151C18` | 卡片、底栏、弹层 |
| `surface2` | `#EFF1EC` | `#1C2520` | 输入框、分段控件底、空闲筛选 |
| `ink` / `ink2` / `ink3` | `#15211B` / `#56635C` / `#6B766F` | `#E7EDE9` / `#A9B5AE` / `#8E9A93` | 正文 / 次要 / 元信息（对比度 16.6 / 6.3 / 4.7） |
| `brand` | `#164B3A`（= PC `--bos-green`） | `#2F7A5F` | 主按钮、当前页签、选中 |
| `brandInk` | `#164B3A` | `#86CFAE` | 品牌色文字 / 图标 |
| `brandSoft` | `#E6F0EA` | `#1B3329` | 选中底、品牌徽标底 |
| `focus` | `#498B73`（= PC 焦点色） | `#6FB898` | 焦点环 |
| `success` | `#1F7A4D` / `#E5F3EA` | `#74C99A` / `#173225` | 已付清、已完成 |
| `warning` | `#8A5414` / `#FBF0E1` | `#E3B06A` / `#3A2A14` | 即将到期、待付款、规划标记 |
| `danger` | `#A8432F` / `#FBEBE6` | `#F0907A` / `#3B1D17` | 逾期、异常、未读、危险操作 |
| `info` | `#2B5D8C` / `#E8F0F8` | `#8DB8E8` / `#172A3D` | 已报价、生产中 |
| `logo` | `#2E534B` | 同左 | 只用于 Logo 底色 |

- 线索等级用**同一绿色色阶**：A 实心深绿、B 浅绿、C 灰、D 灰 + 删除线，不引入新颜色。
- 客户标签沿用 PC 的 8 色（`lib/customer-tags.ts`）。
- 深色模式不是反色：表面色按亮度阶梯抬高，阴影换成描边，品牌色提亮到在深色上仍 ≥ 4.5:1。

## 3. 字体与数字

| 角色 | 尺寸 / 行高 | 字重 | 用途 |
| --- | --- | --- | --- |
| Display | 32 / 40 | 650 | 每页最多一个主数字（今日业绩、订单金额） |
| Title L | 24 / 30 | 650 | 大标题（根页） |
| Title M | 18 / 26 | 600 | 顶栏标题、弹层标题 |
| Title S | 16 / 24 | 600 | 卡片标题、列表主文字 |
| Body | 15 / 22 | 400 | 正文 |
| Body S | 14 / 20 | 400 | 次要正文 |
| Caption | 13 / 18 | 400 | 元信息 |
| Micro | 12 / 16 | 500 | 徽标、导航文字（中文最小字号） |

- 字体：Android 用系统 Roboto + Noto Sans CJK SC；HarmonyOS 用 HarmonyOS Sans SC。原型用 Inter 补齐拉丁字母和数字。
- 所有文字用 `sp` / `fp`，跟随系统字号；版式在 100% / 112% / 125% 下验证（原型控制台「字体大小」）。
- 金额：币种符号缩小为数字的 0.62 倍、次要色；主数字用比例数字，表格列用等宽数字（`tnum`）。
- 「万」只在概览里用（¥128.6万），详情页给完整数字（¥1,286,450）。

## 4. 间距、圆角、尺寸

- 4pt 网格：4 / 8 / 12 / 16 / 20 / 24 / 32 / 40；页面左右边距 16。
- 圆角：徽标 6、输入 12、卡片 16、主视觉卡 20、底部弹层顶部 24。
- 触控：最小 48×48（Android）；HarmonyOS 热区不小于 40vp，统一按 48。按钮高 48，输入框 44。
- 顶栏 56，底部导航 64 + 系统手势区；全面屏下内容避开状态栏和底部手势区（Android `WindowInsets`、HarmonyOS `expandSafeArea` / 避让区）。
- 宽度适配 360–430dp：卡片单列，KPI 两列；360 宽时两列表单降为一列。

## 5. 图标

Lucide 0.468（与 PC `lucide-react` 同版本），线宽 1.75，24 网格；导航 22，列表 18–20，徽标 13。Android 导出 VectorDrawable，HarmonyOS 导出 SVG 资源。WhatsApp 用通用「对话」图标 + 文字，不使用第三方商标。

## 6. 组件

原型实现见 `prototypes/mobile-app/js/ui.js`。

| 组件 | 规格 | Android（Compose M3） | HarmonyOS（ArkUI） |
| --- | --- | --- | --- |
| 顶栏 | 根页大标题，滚动后收为 18 号标题 + 分隔线；详情页返回 + 标题 + ≤2 个图标 | `LargeTopAppBar` / `TopAppBar` + `exitUntilCollapsedScrollBehavior` | `Navigation` 标题栏 `titleMode(Full→Mini)` |
| 底部导航 | 5 项，图标 + 文字，选中为浅绿胶囊，角标红底 | `NavigationBar` + `BadgedBox` | `Tabs` + 自定义 `TabBar`，`Badge` |
| 按钮 | 主（实心绿）、次（白底描边）、浅绿、文字、危险 | `Button` / `OutlinedButton` / `FilledTonalButton` / `TextButton` | `Button(ButtonType.Normal)` + 样式 |
| 卡片 | 白底、16 圆角、极淡阴影 + 发丝边 | `Card` / `ElevatedCard` | `Column` + `borderRadius` + `shadow` |
| 列表行 | 左图标 / 头像、主次文字、右侧值与箭头，分隔线从文字处开始 | `ListItem` | `List` + `ListItem` |
| 客户卡片 | 头像（含等级角标）、姓名 + 国家代码、公司、阶段 / 标签、下次跟进、电话与 WhatsApp 圆形按钮 | 自定义 | 自定义 |
| 筛选芯片 | 36 高胶囊，选中实心绿，可带计数 | `FilterChip` | `Button` / `Chip`（API 12+） |
| 分段控件 | 页内 2–4 个视图切换 | `SingleChoiceSegmentedButtonRow` | `SegmentButton` |
| 底部弹层 | 拖拽把手、标题、可滚动内容、固定底部按钮；下滑关闭 | `ModalBottomSheet` | `bindSheet` / `SheetOptions` |
| 确认框 | 标题 + 后果说明 + 可选原因输入；危险操作红色按钮 | `AlertDialog` | `AlertDialog` / `CustomDialog` |
| 提示（Snackbar） | 底部深色条，可带「撤销」 | `SnackbarHost` | `promptAction.showToast` + 自定义撤销条 |
| 悬浮按钮 | 列表页「新建客户」，滚动后收为图标 | `ExtendedFloatingActionButton(expanded=)` | 自定义悬浮 `Button` |
| 开关 | Android 为 M3 开关，HarmonyOS 为系统 Toggle 样式（原型切平台可看） | `Switch` | `Toggle(ToggleType.Switch)` |
| 统计卡 | 标签 + 图标、主数字、变化或说明 | 自定义 | 自定义 |
| 进度 | 订单七段步骤条、目标进度条 | 自定义 / `LinearProgressIndicator` | 自定义 / `Progress` |
| 时间线 | 跟进、消息（含译文）、阶段变化、报价、留资 | `LazyColumn` 自定义 | `List` 自定义 |
| 空 / 错 / 骨架 | 见 IA §4 | 自定义 | 自定义（`LoadingProgress` 仅用于按钮内） |
| 离线提示条 | 顶栏下方，警示色浅底，写明数据保存时间；不遮挡内容、不可关闭 | 自定义 + `ConnectivityManager` 监听 | 自定义 + `@kit.NetworkKit` 连接状态监听 |

## 7. 图表

- 单一坐标轴；当期为品牌绿 2px 线 + 10% 面积，对比期为灰色 1.5px 线；网格为发丝实线。
- 每日成交金额稀疏（几笔大单），用**本月累计 vs 上月同期累计**表示趋势，点按某天看当日金额和累计；另提供明细表视图。
- 横向条形用于漏斗、排行、来源，数值在条上方右侧；付款状态用分段条（同色系由深到浅），图例带数量。
- 两条以上序列必有图例；文字不使用序列颜色。

## 8. 动效与反馈

- 页面推入 / 返回 320ms 减速曲线；弹层 220–320ms；按压 `scale(.98)`。
- 下拉刷新：拉动距离 > 58 触发，完成后提示「已更新到最新数据」，顶部显示更新时间。
- 系统减少动态效果时关闭所有动画。
- 每个写操作都有即时反馈：成功提示（可撤销）、错误提示（说明怎么改）、按钮加载态（防重复提交）。

## 9. Android 与 HarmonyOS 的差异

| 项目 | Android（Material 3） | HarmonyOS（Design Guidelines） |
| --- | --- | --- |
| 返回 | 系统返回手势 / 键；Android 14+ 预测性返回 | 左右边缘侧滑返回 |
| 开关、弹层、对话框 | M3 组件外观 | 系统组件外观（原型在 HarmonyOS 模式下开关切换为系统样式） |
| 字体 | Roboto + Noto Sans CJK | HarmonyOS Sans |
| 通知外观 | 通知渠道（Channel）、悬浮通知 | 通知渠道（Slot）、横幅通知 |
| 状态栏 / 导航区避让 | `enableEdgeToEdge` + `WindowInsets` | `setWindowLayoutFullScreen` + `getWindowAvoidArea` |
| 深色模式 | `isSystemInDarkTheme()` + 应用内覆盖 | `resources/dark` 限定词 + `ColorMode` 应用内覆盖 |

业务流程、信息层级、文案在两端完全一致，只有系统组件外观和系统能力调用不同。
