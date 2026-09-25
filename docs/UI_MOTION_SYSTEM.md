# LVANJU BOS · 统一动效系统

> 把 LVANJU BOS 从「传统后台」升级为「有生命感的 AI 外贸经营操作系统」。
> 关键词：**高级 · 克制 · 流畅 · 呼吸感 · 智能感**

---

## 1. 原则

动效只服务四件事，其余一律不做：

1. **提升数据理解** —— 数字滚动让金额变化可被感知；折线从左向右绘制暗示时间流向
2. **提升操作反馈** —— 按钮按下 `scale(0.97)`，卡片悬停上浮 2px
3. **增强系统高级感** —— 分层进入，页面不瞬间弹出
4. **表现 AI 智能属性** —— 绿色光点呼吸，表示系统在思考

### 禁止

| ❌ | 原因 |
|---|---|
| 大幅旋转 | 与「克制」冲突，显得业余 |
| 快速闪烁 | 干扰阅读，且可能诱发光敏不适 |
| 游戏化效果 | 这是经营系统，不是消费类产品 |
| 过度弹跳 | 弹跳暗示轻浮，与家具外贸的业务气质不符 |
| 列表行位移动画 | 几十行同时位移＝视觉噪音 |

### 基调

**轻、慢、自然。** 默认时长 300–500ms，缓动 `easeOut`
（`cubic-bezier(0.22, 0.61, 0.36, 1)`）。

---

## 2. 令牌

定义在 `app/motion.css` 的 `:root`。

| 令牌 | 值 | 用途 |
|---|---|---|
| `--motion-fast` | 200ms | 悬停、按压反馈 |
| `--motion-base` | **340ms** | 入场动画（默认） |
| `--motion-slow` | 460ms | 图表绘制 |
| `--motion-ease` | `cubic-bezier(.22,.61,.36,1)` | 全部动效统一缓动 |
| `--motion-breathe` | 5s | 卡片呼吸 |
| `--motion-pulse` | 3s | AI 光点、高优先级呼吸 |
| `--motion-status` | 4s | 顶部系统状态点 |

**为什么只有一个缓动函数**：多个缓动会让人感觉界面「各说各话」。
统一 `easeOut` 是最接近物理直觉、也最不抢戏的选择。

---

## 3. 分层进入（页面级）

页面**不瞬间出现**，按信息重要性依次进入：

| 时刻 | 内容 | 令牌 |
|---|---|---|
| `0ms` | 页面标题 | `MOTION_DELAY.title` |
| `100ms` | 操作按钮 / 状态页签 | `MOTION_DELAY.actions` |
| `200ms` | 数据卡片 | `MOTION_DELAY.cards` |
| `400ms` | 主要内容（表格 / 工作台） | `MOTION_DELAY.main` |
| `600ms` | 辅助模块（AI 区、提醒卡） | `MOTION_DELAY.aside` |

效果：`opacity 0 → 1`，`translateY 20px → 0`。

### 用法

```tsx
import { Reveal, MOTION_DELAY } from '@/components/ui/motion';

<Reveal delay={MOTION_DELAY.title}><h1>订单管理</h1></Reveal>
<Reveal delay={MOTION_DELAY.cards}>{/* 数据卡片 */}</Reveal>
<Reveal delay={MOTION_DELAY.main} variant="fade">{/* 图表 */}</Reveal>
```

也可以直接给已有容器加类，**不插入额外节点**（避免破坏 flex/grid 布局）：

```tsx
<div className="bos-metrics motion-in" style={{ '--motion-delay': '200ms' } as React.CSSProperties}>
```

---

## 4. 预置动效清单

全部定义在 `app/motion.css`。

| 名称 | 类 / 组件 | 效果 | 周期 |
|---|---|---|---|
| `fadeIn` | `.motion-fade` / `<Reveal variant="fade">` | 透明度 0→1 | 340ms 一次 |
| `slideUp` | `.motion-in` / `<Reveal>` | 透明 + 上移 20px | 340ms 一次 |
| `cardHover` | `.bos-card` 自带 | 上浮 2px + 阴影增强 | 200ms |
| `press` | `.bos-button:active` | `scale(0.97)` | 200ms |
| `breathe` | `.motion-breathe` | 卡片透明度 .98→1 | **5s 循环** |
| `pulse` | `.motion-dot` / `<AiPulse>` | `scale 1→1.15→1`，`.6→1→.6` | **3s 循环** |
| `statusDot` | `.bos-system-status i` / `<SystemStatus>` | 透明度 .45→1 | **4s 循环** |
| `logoPulse` | `.bos-loading-mark` / `<LogoLoading>` | 透明度 .3→1 | 1.6s 循环 |
| `nodePulse` | `.motion-node-current` | 绿色光晕 `0 0 8px rgba(20,92,69,.3)` | 3s 循环 |
| `borderBreathe` | `.motion-border-breathe` | 边框透明度 .5→1 | 3s 循环 |
| `lineDraw` | `<Bar>/<Area>/<Line>` 的 `animationDuration` | 折线左→右，柱状底→顶 | 460ms |
| `numberCount` | `<CountUp>` | ¥0 → ¥1,280,000 | 900ms |

---

## 5. 应用现状

| 位置 | 已应用 |
|---|---|
| **顶部栏** | `SystemStatus` —— ● 系统运行正常，4s 呼吸 |
| **全部载入态** | `LogoLoading` —— LVANJU Logo 呼吸，**已替换全部骨架屏/转圈** |
| **老板驾驶舱** | 分层进入（卡片 200ms / 主体 400ms / AI 600ms）· KPI 数字滚动 · AI 绿色光点 |
| **订单管理** | 分层进入（页签 100 / 筛选 200 / 表格 400）· 进度条当前节点脉冲 · 连接线绘制 |
| **任务中心** | 高优先级未完成任务边框呼吸（**悬停时停止**，不影响操作） |
| **销售工作台 / 客户管理 / 运营中心 / 产品库 / 组织目标** | 主体分层进入 |
| **全部卡片 / 按钮** | 悬停上浮 · 按压回弹 |
| **全部图表** | 折线绘制 · 柱状增长，统一 460ms easeOut |

---

## 6. 可访问性（硬性要求）

**必须尊重系统的「减弱动态效果」设置。** 这不是可选项：

```css
@media (prefers-reduced-motion: reduce) { /* 全部动效降为 0.01ms */ }
```

同时 `<CountUp>` 在检测到该设置时**直接显示最终数值**，不做逐帧变化。

---

## 7. 性能分层（硬性要求）

| 场景 | 策略 |
|---|---|
| **列表 > 50 行** | 容器加 `data-motion="off"`，关闭入场与周期动效 |
| **表格行** | 只做背景色过渡，**永不做位移** |
| **移动端（≤760px）** | 关闭全部循环动效（呼吸/脉冲/光点），只保留一次性的入场与按压反馈 |
| **数字滚动** | 只用于核心指标（金额、利润、订单数、客户数），不用于表格内每个数字 |

### 为什么不用 Framer Motion

需求提到 Framer Motion，这里**刻意没有引入**，理由具体：

1. **入场动画纯 CSS 完成，客户端 JavaScript 增量为 0。**
   `<Reveal>` 是**服务端组件**（无 `'use client'`），只在 HTML 上输出一个类名和一个 CSS 变量。
   换成 Framer Motion，每个页面的入场动画都要把组件变成客户端组件并带上运行时。
2. **性能是需求本身的硬指标**（§15「动画不会影响页面速度」）。
   Framer Motion 客户端运行时约 30KB+ gzip，直接与这条冲突。
3. **唯一真正需要它的是布局动画**（Trello 式卡片位移，需求 §8）。
   但客户 CRM 目前是**表格视图，没有看板**，所以这个需求**当前没有落地目标**。
4. 全部 12 种预置动效中，**11 种用 CSS 即可达到同等观感**，
   第 12 种（数字滚动）用 30 行 `requestAnimationFrame` 实现，已封装为 `<CountUp>`。

**什么时候应该引入**：等你真的要做客户看板的拖拽换阶段（Trello 式），
那时 Framer Motion 的 `layout` 动画确实无可替代 —— **到那时再加，只在那一个页面加**。

> 如果你希望现在就统一用 Framer Motion，告诉我，我可以换 —— 但上面第 1、2 条代价是真实的。

---

## 8. 给新页面接入（4 步）

```tsx
// 1. 引入原语
import { Reveal, MOTION_DELAY } from '@/components/ui/motion';
import { CountUp } from '@/components/ui/count-up';

// 2. 标题 / 卡片 / 主体分层进入
<Reveal delay={MOTION_DELAY.title}><h1>页面标题</h1></Reveal>
<Reveal delay={MOTION_DELAY.cards}><KpiCard/></Reveal>
<Reveal delay={MOTION_DELAY.main}><DataTable/></Reveal>

// 3. 核心数字用 CountUp（不要在表格里逐格使用）
<CountUp value={1280000} prefix="¥"/>

// 4. 大列表关动效
<Card data-motion={rows.length > 50 ? 'off' : 'on'}>…</Card>
```

**新增动效前先问**：它服务 §1 的哪一条？答不上来就不要加。

---

## 9. 尚未落地

| 需求 | 状态 | 原因 |
|---|---|---|
| §8 客户阶段看板（Trello 式 layout 动画） | **无目标** | 客户 CRM 是表格，没有看板视图。要做需要先建看板 |
| §10 财务系统动效 | **无目标** | **`/finance` 页面当前不存在**，财务模块尚未开发 |
| §11 运营分析中心 | 部分 | 图表动画已全局生效；运营中心自身的加载编排待做 |
| §12 卡片悬停 | 已完成 | 全局 `.bos-card` |
