# 报价单与运费库（产品库 → 报价单）

> 2026-10-11 · 影响级别 **L3**（新增迁移 `20261011090000_quotation_builder`，全部为加性变更）

目标：在产品库里一分钟做好一份报价——选客户、点型号、单价自动带出（可逐行改）、按运费库自动算运费，
一键生成**中文 / English / Français** 报价图片与 PDF；每份报价都挂在客户档案下，以后查价不会报错价格。
单据版面沿用 `LVANJU 报价单` Excel（中文报价单 / English Quotation / Devis Français）。

## 怎么用

| 入口 | 地址 | 说明 |
| --- | --- | --- |
| 报价单列表 | `/products/quotes` | 按编号 / 客户 / 型号搜索；草稿与已发送分开看 |
| 新建报价 | `/products/quotes/new` | 也可从客户档案「新建报价」（`?customerId=`）或产品详情「用此产品报价」（`?product=`）进入 |
| 报价单 | `/products/quotes/:id` | 下载图片、下载 PDF、复制图片（粘贴进 WhatsApp Web）、手机上直接分享、打印；登记已发送、修改草稿、复制为新报价 |
| 运费库 | `/products/freight` | 管理员维护，所有人可看 |
| 报价设置 | `/products/quotes/settings` | 仅管理员：三种语言的抬头 / 条款 / 说明，美元与欧元汇率 |

侧边栏：管理员「订单」分区新增 **报价单 / 运费库** 两个页签；销售「产品与报价」分区新增 **产品库 / 报价单 / 运费库** 页签。

### 构建器的四步

1. **客户与币种**：搜索自己负责的客户（管理员可选全部）。币种 CNY / USD / EUR；**人民币自动用中文单据，外币自动用英文单据**，法文可手动选择。「按价格表调价」预设 -5% ~ +20%，也可输入任意百分比——用来给不同客群（零售、批发、经销）对症报价。
2. **产品**：搜型号或尺寸（`Y-601`、`270x180`、`床`），点一下加入，回车加入第一条，同一规格再点数量 +1；「自定义行」用于样品费、定制款等产品库外的项目。每一行都能改名称、数量、单价，展开可改尺寸 / 材质 / 包装 / CBM / 毛重 / 备注（如颜色）。
3. **运费与贸易条款**：填目的国后列出匹配的运价卡片，每张卡直接显示这票货的运费；选中后贸易条款与指定地点自动带出，运费数字仍可手动改（可恢复自动计算）。也可选「不含运费」或「手动填写运费」，另有「其他费用」（税费、验货等）。
4. **买方信息与交易条款**：已按客户资料和对应语言模板填好，个别报价可单独修改；内部备注不显示在单据上。

右侧为实时预览（手机上切换「编辑 / 预览」），保存后进入报价单页面导出。**必须保存后才能导出**，保证发出去的每份报价都有记录。

### 单价怎么来的（智能单价，可随时手改）

按顺序取第一个可用的：

| 顺序 | 来源 | 标签 | 说明 |
| --- | --- | --- | --- |
| 1 | 该客户上次用**同一币种**报过的这个规格 | 上次报价（绿） | 同一客户前后报价一致，不会报错价格 |
| 2 | 价格表（`ProductPrice`）同币种价 ×（1 + 调价%） | 价格表 | 调价只作用于这一类 |
| 3 | 价格表其他币种价按系统汇率折算后 ×（1 + 调价%） | 价格表（提示「按汇率折算」） | 例如某些规格只有人民币价 |
| 4 | 都没有 | 手动（橙） | 留空，必须填写才能保存 |

手动改过的行标为「手动」，可点 ↺ 恢复建议价；每行下方显示来源与价格表价，便于比对。切换币种时所有产品行按新币种重新带出（会提示核对）。管理员在每行看到**毛利率**（成本取自产品成本，含汇率换算），销售看不到成本，成本也不进入销售的任何接口返回。

### 运费怎么算

运费库每条运价：目的国、目的港 / 城市、运输方式（海运 / 空运 / 快递 / 铁路 / 陆运）、对应贸易条款、计费方式、运价与币种、计泡系数、最低计费量、时效、备注。

| 计费方式 | 计费量 |
| --- | --- |
| 按公斤 `KG` | max(总毛重, 总体积 × 计泡系数)，例如 法国 22 CNY/kg、计泡 1:200 |
| 按立方 `CBM` | 总体积，例如 印度 550 USD/CBM |
| 按 20GP / 40HQ 整柜 | ⌈总体积 ÷ 28 / 68 m³⌉ |
| 按票（一口价） | 1 |

再与最低计费量比较取大，乘运价后按汇率换算成报价币种（`1 外币 = ? 人民币`，美元汇率与产品毛利共用 `Setting.usdCnyRate`，欧元为新增 `Setting.eurCnyRate`）。缺少汇率时不自动换算，提示手动填写运费。修改运价**不影响**已保存的报价单。

### 编号、发送与修改

- 编号 `LVJ-年月-流水`（如 `LVJ-202610-001`），按月递增；并发撞号由唯一约束拒绝后自动重取。
- 「登记已发送」沿用原有流程：客户阶段 → 已报价、记录首次报价时间与报价金额、3 天后报价跟进、广告回传事件。**系统不会自动对外发送任何内容。**
- 只能修改**草稿**（带版本号，两人同时改返回 409）；已发送的报价请「复制为新报价」，保证发给客户的版本不被改动。

## 需求分析（PROJECT_RULES §0.5.2）

1. **需求理解**：在产品库内提供报价系统：币种决定单据语言（人民币中文 / 外币英文），单价自动带出且可人工调整以适配不同客群，运费按国家维护（按公斤、按立方等）并自动计算，生成图片与 PDF，报价关联到客户档案以便日后核对价格。歧义处理：欧元单据默认英文，另提供 Excel 已有的法文模板；调价只影响价格表带出的单价；成本仅管理员可见。
2. **对 BOS 的影响**：属于 Product OS / Sales OS 交界；复用既有 `Quotation` 与「登记已发送」工作流，不改变其他 OS 的契约。
3. **涉及模块**：`services/itemized-quote-service.ts`、`services/freight-service.ts`、`services/quote-template-service.ts`、`lib/quote-math.ts`、`lib/quote-i18n.ts`、`lib/quote-pdf.ts`、`lib/quote-export.ts`、`lib/quotation-amount.ts`、`components/bos/quote/*`、`components/workspace/QuotationPanel.tsx`、`app/(bos)/products/{quotes,freight}`、`app/api/{quotes,freight-rates,quote-settings}`；报价金额读取方 `bos-growth-service`、`bos-v2-service`、`business-cockpit-service`、`action-center-service`、`order-service`、`quotation-service`。
4. **数据变化**（全部加性，见下表）。受保护语义核对：不涉及幂等键、单例行 id、软删除、`Deal.dealDate` / `Customer.inquiryAt` 口径。
5. **API 变化**：新增端点，`{success,data}` 信封不变；旧 `POST/GET /api/quotations` 与 `PATCH /api/quotations/:id` 保持兼容。
6. **UI 变化**：全部在 `.bos` 作用域，复用 `Header / Card / Table / Badge / Button / EmptyState` 与既有 token；对外单据（`.quote-doc`）只使用已有色值；已在 1600px 与 390px 核对，无横向溢出。
7. **实施与验证**：见下文「验证记录」；回滚只需回退代码，新增表与列不被旧代码读取。

## 数据库变更（`20261011090000_quotation_builder`）

| 对象 | 变更 |
| --- | --- |
| `Quotation` | 新增 `language`（默认 `en`）、`quoteDate`、`validUntil`、`subtotalAmount`、`freightAmount`、`otherAmount`、`totalAmount`、`totalQuantity`、`totalCbm`、`totalGrossWeightKg`、`destination`（默认空）、`freightRateId`（FK → `FreightRate`，删除置空）、`documentJson`（单据快照）；索引 `createdAt`、`freightRateId` |
| `QuotationItem`（新表） | 明细行快照：规格、包装、CBM、毛重、单价、金额、价格表价、单价来源；随报价级联删除 |
| `FreightRate`（新表） | 运费库 |
| `QuoteTemplate`（新表） | 每种语言一行；没有记录时用代码里的默认文案，**读取不落库** |
| `Setting` | 新增可空 `eurCnyRate` |

旧的单行报价不受影响：新列为空，金额仍按 `unitPrice × quantity`。多行报价同时写入旧列（`product` 为摘要、`quantity` 为总件数、`unitPrice` 为均价），任何未更新的旧读取方也能得到近似值。

## 指标口径

「报价金额」统一经 `lib/quotation-amount.ts`：多行报价取 `totalAmount`（产品小计 + 运费 + 其他费用，即客户看到的报价总额），旧报价取 `unitPrice × quantity`。已更新：增长中心报价金额、BOS 驾驶舱报价金额、经营驾驶舱本期 / 上期报价额、行动中心报价提醒金额、登记发送时的客户报价金额、订单详情的报价记录。口径定义（发送时间窗口、同币种汇总）不变。

## 导出

浏览器端把单据（固定 1000px 宽）用 `html-to-image@1.11.13` 渲染成画布：图片为 2 倍清晰度 PNG；PDF 在每一行产品 / 条款 / 合计的下边缘分页，按 A4 写成 JPEG 页面（`lib/quote-pdf.ts`，无第三方 PDF 依赖）。超长单据自动降低倍率以适配 iOS 画布上限。中文、法文与产品图按屏幕效果原样输出，不依赖服务器字体。

## 验证记录

- `pnpm exec prisma validate` / `prisma generate`
- `pnpm test`：148 项全部通过（新增 `tests/quotation-builder.test.ts` 7 项：金额与运费计算、智能单价顺序、PDF 结构与分页、服务端重算与按月编号、权限隔离与成本不泄漏、草稿版本冲突与发送后锁定、模板仅管理员可改）
- `pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm build`
- 升级演练：先应用 13 条旧迁移，再应用其余 8 条（含本迁移），共 21 条，新表与新列齐全（CI 同步更新）
- 浏览器（Playwright）：管理员 1600px 建 USD 报价（India 550 USD/CBM，5.28 CBM → USD 2,904.00）、切换人民币自动中文、+15% 调价、手输小数、保存、下载 PNG（2000px 宽）与 PDF（A4）、登记已发送、客户档案报价与历史价格、再次报价沿用上次价格；销售 390px 建 EUR 法文报价（France 22 CNY/kg、计泡 1:200 → 36 kg → EUR 101.54）、导出 PDF、无横向溢出、无法打开其他销售客户的报价、页面不含成本字段
