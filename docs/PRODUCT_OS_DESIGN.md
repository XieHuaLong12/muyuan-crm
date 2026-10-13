# LVANJU BOS · Product OS 设计文档

> **文档性质**：设计文档（第一阶段）。**尚未编码。**
> **事实来源**：真实产品资料，非假设。
> **配套**：源数据抽取结果见 [product-os/source-extract.json](product-os/source-extract.json)；规范见 [../PROJECT_RULES.md](../PROJECT_RULES.md)；总架构见 [LVANJU_BOS_ARCHITECTURE.md](LVANJU_BOS_ARCHITECTURE.md)。

---

## 0. 摘要（先读这一节）

### 0.1 一句话结论

报价表与产品图册已完整解析，得到 **28 个型号 / 58 个可报价变体**。真实数据结构比"商品表"复杂得多，设计围绕 **三件事** 展开：

1. **价格与包装挂在"尺寸变体"上，不挂在型号上** —— Y-601 一个型号有 3 个尺寸，3 个不同价格（$134.33 / $194.03 / $246.27）。
2. **包装是多箱的** —— 真实值是 `100*29*20+101*21*13+110*30*33` 这种形式，单行字段装不下。
3. **两份资料互相矛盾** —— 发现 **10 类数据冲突**，其中 2 类是图册模板复制粘贴错误。系统必须**记录来源并能暴露冲突**，否则 AI 会照着错的数字报价。

### 0.2 资料解析结果

| 项 | 内容 |
|---|---|
| 报价表 | 3 页，**文字可直接提取**。含 28 型号、58 变体的尺寸/材料/包装/CBM/毛重/单价 |
| 产品图册 | 25 页，**纯图片（无文字层）**。含系列名、中英文材料、座型标签、色号、产品大图 |
| 系列 | 图册 25 页全部属于 **WARM HOME** 系列 |
| 分类 | **Compressed Sofa**（Y 系列 17 个 + D 系列 5 个）、**Compressed Bed**（C 系列 6 个） |
| 报价 | 全部 **USD**、**FOB** 报价（已确认）；单一定价（无数量分档） |
| MOQ | **线上 10 件 / 线下交谈 20 件**（已确认，按渠道分档） |
| 图册未覆盖 | Y-604 / Y-606 / Y-616 / Y-617（报价表有，无图无系列信息）。2026-10-13 起由 2026 压缩沙发图册补齐 |

### 0.3 规模

- 新增 **14 张表**，**不修改任何现有表结构**（可选加 1 个 nullable 字段）
- 4 个新页面，全部使用 `.bos` 设计系统
- 8 组 API

### 0.4 业务确认结果（2026-09-22）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 贸易术语 | ✅ **FOB**（与报价表"不含关税与运费"一致） |
| 2 | MOQ | ✅ **线上 10 件 / 线下交谈 20 件** → 设计为**按渠道分档** |
| 3 | 数据权威性 | ✅ **所有型号一律以报价表为准** → 6 项冲突已裁决 |

**剩余待确认**：见 [§7 待确认问题](#7-待确认问题)。其中 **2 项为 BLOCKER**——报价表在 D-612 的 CBM 与 Y-611 的尺寸上存在可证明的错误，"以报价表为准"若严格执行会把错误数据写入系统。

> 「以报价表为准」是本设计的**默认权威规则**，已写入种子数据与冲突裁决逻辑。仅下列 2 处建议例外，需你确认。

---

## 0.5 修订记录（2026-09-23）

业务方补充了**中文报价表**（绿安居·压缩家具系列2026年报价），据此修正两处并新增三项：

### 修正：分类体系（原来分错了）

| 系列 | 正确品类 | 原来的错误 |
|---|---|---|
| **Y** | 压缩沙发 | ✅ 正确 |
| **D** | **压缩单人椅** | ❌ 被并进了「压缩沙发」 |
| **C** | 压缩床 | ✅ 正确 |
| **M** | 压缩床垫 | ❌ 完全没有 |

改为**两层分类**：

```
压缩家具系列（第一层级）
├── Y 系列 · 压缩沙发
├── D 系列 · 压缩单人椅
├── C 系列 · 压缩床
└── M 系列 · 压缩床垫

智能床垫系列（第一层级，占位，等待上传产品）
```

### 新增：双语

| 内容 | 中文来源 | 英文来源 |
|---|---|---|
| 产品名 / 分类名 / 材料名 | 中文报价表 | 英文报价表 |
| 价格 | 中文报价表（CNY） | 英文报价表（USD） |

界面提供 **中文 / EN** 切换：中文供内部使用，英文用于展示客户。

### 新增：M 系列压缩床垫

中文报价表独有，英文表与图册都没有：**M-801（独立袋装弹簧）、M-802（记忆海绵）**，共 8 个变体。

### 发现：中英文两份报价表在 9 个型号上不一致

详见 [source-extract-cn.json](product-os/source-extract-cn.json) 的 `conflicts`。要点：

- **Y-602 / Y-607 / Y-614**：中文表与产品图册一致，**英文表不一致**
- **Y-615 与 Y-616**：两份表的型号编号**整体对调**
- 差异**只登记、不自动改写**，全部写入变体的 `reviewNote`

> ✅ 2026-10-13 业务确认：压缩沙发（Y 系列）全部以 **2026 图册**为准（与中文表一致，编号以图册为准，美元价仍取英文表），见 [catalog-2026-sofas.json](product-os/catalog-2026-sofas.json) 与 [QUOTATION_SYSTEM.md](QUOTATION_SYSTEM.md)。D / C / M 系列不变。

---

## 1. 产品数据库 ER 设计

### 1.1 实体关系

```
SourceDocument（报价表 / 图册，带版本与生效日期）
      │
      │ 记录每个字段的来源值
      ▼
ProductCategory ──< Product >── ProductSeries
  (压缩沙发/压缩床)     │        (WARM HOME)
                       │
        ┌──────────────┼───────────────┬──────────────┬─────────────┬────────────┐
        ▼              ▼               ▼              ▼             ▼            ▼
 ProductVariant  ProductMaterial  ProductOption  ProductMedia  ProductDocument  ProductMoq
 (尺寸/配置变体)   (材料分层)      (面料/颜色)     (图片)        (规格书/认证)    (渠道 MOQ)
        │
        ├──< PackingCarton   （多箱包装，1..n 个纸箱）
        ├──< ProductPrice    （价格，挂变体不挂型号）
        ├──< SpecObservation （每个来源的字段值 → 冲突检测的依据）
        └──< SpecConflict    （需人工裁决的冲突）

ProductAiProfile（AI 产品画像：卖点/客群/市场/关键词）
```

### 1.2 六个关键设计决策（由真实数据驱动）

#### D1 · 价格挂在变体，不挂在型号

Y-601 三个尺寸三个价格：

| 尺寸 | 包装 | CBM | 毛重 | 单价 |
|---|---|---|---|---|
| 180×90×66 | 102*28*28 2pc | 0.16 | 40 | US$134.33 |
| 270×90×66 | 96*96*30 | 0.28 | 57 | US$194.03 |
| 270×180×66 | 96*96*35 | 0.32 | 72 | US$246.27 |

→ **变体（Variant）是可报价的最小单位**。型号只是分组。

#### D2 · 变体有两种语义，必须用 variantType 区分

| 类型 | 例子 | 说明 |
|---|---|---|
| `CONFIGURATION`（整组配置） | Y-612 "3 SEATS 300*100*74" | 报价表口径，按整组报价 |
| `MODULE`（模块件） | Y-608 "OTTOMAN 脚踏 98*98*35" | 图册口径，按模块件包装 |

Y-608 / Y-615 / D-608 / D-609 同时存在两种口径（冲突 C-06），**不是错误，是粒度不同**，需并存。

#### D3 · 包装是多箱结构，必须单独建表

真实数据里的四种写法：

```
96*96*35                        → 1 箱
34*34*110*2CTNS                 → 2 箱（同尺寸）
28*28*98=3件                     → 3 件各 1 箱
25*25*128+42*42*117             → 2 箱（不同尺寸）
100*29*20+101*21*13+110*30*33   → 3 箱（不同尺寸，C 系列床）
```

→ `PackingCarton[]` 子表：`{lengthCm, widthCm, heightCm, cartonCount, piecesPerCarton, grossWeightKg, label}`，同时**保留 `packingRaw` 原始文本**便于人工核对。

#### D4 · CBM 可由包装推导，用作自动校验

```
cbm = Σ(L × W × H × cartonCount) / 1,000,000
```

已验证有效：**D-612** 报价表 CBM=0.23，但 `33*33*91` = 0.0991 → 图册的 0.1 才对（冲突 C-03）。
→ 变体同时存 `cbm`（权威值）与 `cbmComputed`（推导值），不一致即产生冲突记录。

#### D5 · 材料是"分层结构"，不是一个字符串

图册真实材料（Y-601）：

```
抗压高分子可压缩海绵 + 180T有氧绵 + 羽丝绵 + 压缩专用灯芯绒布
PRESSURE-RESISTANT HIGH POLYMER COMPRESSIBLE SPONGE
  + 180T AEROBIC COTTON + FEATHER SILK COTTON + CORDUROY
```

→ 拆为 `role` 分层：`FOAM`（海绵）/ `FILLING`（填充）/ `COVER`（面料）/ `FRAME`（结构，如 C 系列碳钢架），每条含 **中英文名 + 规格（如 180T）**。面料同时进 `ProductOption(kind=FABRIC)` 以便筛选。

#### D6 · MOQ 按渠道分档，不能是单一数字

业务确认：**线上 10 件，线下交谈 20 件**。

→ 独立 `ProductMoq` 表（`channel` + `minQty`），而不是 `Product.moq` 单字段。

**理由**：
- 同一型号在不同渠道的起订量**确实不同**，单字段必然要丢一边
- 业务已明确区分渠道，且未来会增加到 Alibaba / 独立站 / 展会
- 与 `ProductPrice.customerTier`、`ProductOption.kind` 的既有模式一致
- 提供统一的 `getMoq(productId, channel)` 解析入口，与 `quote-price` 同样遵循"唯一入口"原则

### 1.3 来源与冲突机制（本设计的核心）

发现的冲突类型：

| 类型 | 实例 | 判断依据 |
|---|---|---|
| **模板复制错误** | Y-601 与 Y-602 图册包装表完全相同；D-608 与 D-611 相同 | 两型号不应同包装 |
| **算术错误** | D-612 报价 CBM 0.23 vs 包装推导 0.0991 | 数学验证 |
| **录入笔误** | Y-611 报价尺寸 `300*16*68` → 应为 `300*106*68` | 图册交叉验证 |
| **真实版本差异** | Y-614 报价包装 `113*75*35` vs 图册 `64*34*112` | 两者各自算术自洽 |
| **粒度差异** | Y-608 整组 vs 模块 | 业务口径不同 |
| **材料描述不一致** | C 系列报价含碳钢架，图册未提 | 需业务确认 |

**机制**：

```
SourceDocument（报价表 = 商业权威；图册 = 产品权威）
      │
      ├─ 导入时逐字段写入 SpecObservation（记录来源 + 页码）
      │
      ├─ 同一字段多来源不一致 → 自动创建 SpecConflict（OPEN）
      │
      ├─ 人工在 /products/conflicts 裁决 → 写入变体的权威字段 + 标记 RESOLVED
      │
      └─ 未裁决的冲突，AI 与报价单禁止使用该字段（降级为"需确认"）
```

> **这一条是"AI 可理解"的前提**：没有来源与冲突标记，AI 无法判断该用哪个数字，就只能猜。

### 1.4 派生指标（销售与 AI 直接受益）

| 指标 | 公式 | 用途 |
|---|---|---|
| **单柜装载量** `unitsPer40HQ` | `floor(68 / cbm)` | "CBM 低 → 单柜装得多 → 单件运费低"，这是压缩沙发的核心卖点 |
| 单件海运成本占比 | `unitPrice` vs 估算运费 | 报价谈判 |
| 变体覆盖度 | 型号下变体数与价格区间 | 列表页"起价"展示 |
| 数据完整度 | 必填字段缺失比例 | 数据质量看板 |

> 40HQ 按 68 m³ 可用容积估算，需业务确认后可配（放 `Setting` 或环境变量，不硬编码在业务逻辑里）。

---

## 2. Prisma Model 设计

> 约定：全部为**新增表**；金额 `Decimal(14,2)`；CBM `Decimal(8,4)`；枚举用 `String` + Zod（与现有代码一致）；软删除用 `deletedAt`；操作人用 `createdBy`。

```prisma
// ═══════════ 源文档与版本 ═══════════
model SourceDocument {
  id String @id @default(cuid())
  kind String                          // PRICE_LIST | CATALOG | SPEC_SHEET
  title String
  version String @default("")           // "2026"
  effectiveFrom DateTime?
  language String @default("en")
  fileKey String @default("")           // 原始 PDF 存储键
  fileHash String @default("")
  pageCount Int @default(0)
  textExtractable Boolean @default(true)
  note String @db.Text
  createdBy String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  prices ProductPrice[]
  observations SpecObservation[]
  @@index([kind, effectiveFrom])
}

// ═══════════ 分类与系列 ═══════════
model ProductCategory {
  id String @id @default(cuid())
  code String @unique                   // COMPRESSED_SOFA | COMPRESSED_BED
  nameEn String
  nameCn String
  sort Int @default(0)
  products Product[]
}

model ProductSeries {
  id String @id @default(cuid())
  code String @unique                   // WARM_HOME
  nameEn String                         // WARM HOME
  nameCn String @default("")
  descriptionEn String @db.Text
  descriptionCn String @db.Text
  sort Int @default(0)
  products Product[]
}

// ═══════════ 产品主表（型号级）═══════════
model Product {
  id String @id @default(cuid())
  model String @unique                  // Y-601
  nameEn String                         // Compressed Sofa Y-601
  nameCn String @default("")
  categoryId String
  category ProductCategory @relation(fields: [categoryId], references: [id])
  seriesId String?
  series ProductSeries? @relation(fields: [seriesId], references: [id], onDelete: SetNull)
  status String @default("ACTIVE")      // DRAFT | ACTIVE | ARCHIVED
  lengthLabel String @default("")       // "2.0 METER"
  isModular Boolean @default(false)
  isSofaBed Boolean @default(false)
  seatCount Int?
  pillowCount Int?
  backrestCount Int?
  leadTimeDays Int @default(0)      // 报价表：7-15 天（收款后）
  qaMonths Int @default(12)         // 报价表：质保 12 个月
  descriptionEn String @db.Text
  descriptionCn String @db.Text
  createdBy String
  deletedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  variants ProductVariant[]
  materials ProductMaterial[]
  options ProductOption[]
  moqs ProductMoq[]
  media ProductMedia[]
  documents ProductDocument[]
  aiProfile ProductAiProfile?
  @@index([categoryId, status])
  @@index([seriesId])
  @@index([deletedAt])
}

// ═══════════ 尺寸/配置变体（可报价最小单位）═══════════
model ProductVariant {
  id String @id @default(cuid())
  productId String
  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  sku String @unique                    // Y-601-270x180x66
  variantType String @default("CONFIGURATION")  // CONFIGURATION | MODULE
  labelEn String @default("")           // "3 SEATS" | "OTTOMAN"
  labelCn String @default("")           // "三人位" | "脚踏"

  // 主尺寸 (cm)
  lengthCm Int?
  widthCm Int?
  heightCm Int?
  // 次级尺寸：内空（Y-610）或床垫尺寸（C 系列）
  secondaryLabelEn String @default("")
  secondaryLabelCn String @default("")
  secondaryLengthCm Int?
  secondaryWidthCm Int?
  secondaryHeightCm Int?
  bedSizeCm String @default("")         // "180*200CM"

  // 包装与物流
  packingRaw String @default("")        // 原始文本，便于核对
  cartonCount Int @default(1)
  cbm Decimal @db.Decimal(8, 4) @default(0)
  cbmComputed Decimal? @db.Decimal(8, 4)   // 由 PackingCarton 推导，用于校验
  grossWeightKg Decimal @db.Decimal(8, 2) @default(0)
  grossWeightRaw String @default("")    // "23.8*2+16.8"
  unitsPer40HQ Int?                     // 派生：floor(68 / cbm)

  status String @default("ACTIVE")
  createdBy String
  deletedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  cartons PackingCarton[]
  prices ProductPrice[]
  observations SpecObservation[]
  conflicts SpecConflict[]
  media ProductMedia[]
  @@index([productId, status])
  @@index([deletedAt])
}

model PackingCarton {
  id String @id @default(cuid())
  variantId String
  variant ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  label String @default("")             // "CHAISE贵妃" | 空
  lengthCm Int
  widthCm Int
  heightCm Int
  cartonCount Int @default(1)
  piecesPerCarton Int @default(1)
  grossWeightKg Decimal? @db.Decimal(8, 2)
  sort Int @default(0)
  @@index([variantId, sort])
}

// ═══════════ 材料（分层）与选项 ═══════════
model ProductMaterial {
  id String @id @default(cuid())
  productId String
  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  variantId String?
  role String                           // FOAM | FILLING | COVER | FRAME | OTHER
  nameEn String
  nameCn String @default("")
  specEn String @default("")            // "180T"
  sort Int @default(0)
  @@index([productId, role])
}

model ProductOption {
  id String @id @default(cuid())
  productId String
  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  kind String                           // FABRIC | COLOUR
  code String @default("")              // "K3115-12"
  nameEn String
  nameCn String @default("")
  isDefault Boolean @default(false)
  sort Int @default(0)
  @@index([productId, kind])
}

// ═══════════ 渠道 MOQ（业务规则，非文档数据）═══════════
model ProductMoq {
  id String @id @default(cuid())
  productId String
  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  channel String                        // ONLINE | OFFLINE | ALIBABA | WEBSITE | EXHIBITION
  channelLabelCn String @default("")    // "线上" | "线下交谈"
  minQty Int
  note String @db.Text
  createdBy String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([productId, channel])
  @@index([channel])
}

// ═══════════ 价格 ═══════════
model ProductPrice {
  id String @id @default(cuid())
  variantId String
  variant ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  sourceDocumentId String?
  sourceDocument SourceDocument? @relation(fields: [sourceDocumentId], references: [id], onDelete: SetNull)
  priceListKey String @default("")      // "LVANJU-2026"
  currency String @default("USD")
  incoterm String @default("FOB")       // 已确认默认 FOB；预留 FOB|EXW|CIF|DDP
  includesFreight Boolean @default(false)  // 报价表：不含关税与运费
  customerTier String @default("ALL")   // ALL | WHOLESALE | IMPORTER | DISTRIBUTOR | BRAND
  minQty Int @default(1)
  maxQty Int?                           // null = 无上限
  unitPrice Decimal @db.Decimal(14, 2)
  cost Decimal? @db.Decimal(14, 2)
  effectiveFrom DateTime
  effectiveTo DateTime?
  status String @default("ACTIVE")      // DRAFT | ACTIVE | SUPERSEDED
  createdBy String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([variantId, currency, incoterm, customerTier, minQty, effectiveFrom])
  @@index([variantId, status])
  @@index([effectiveFrom])
}

// ═══════════ 来源观察与冲突 ═══════════
model SpecObservation {
  id String @id @default(cuid())
  variantId String
  variant ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  sourceDocumentId String
  sourceDocument SourceDocument @relation(fields: [sourceDocumentId], references: [id], onDelete: Cascade)
  sourcePage Int?
  field String                          // cbm | grossWeightKg | packingRaw | lengthCm | unitPriceUsd | material
  valueText String @db.Text
  createdAt DateTime @default(now())
  @@unique([variantId, sourceDocumentId, field])
  @@index([field])
}

model SpecConflict {
  id String @id @default(cuid())
  variantId String
  variant ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  field String
  valuesJson String @db.Text            // [{sourceId, sourceTitle, value}]
  severity String @default("WARNING")   // INFO | WARNING | BLOCKER
  status String @default("OPEN")        // OPEN | RESOLVED | ACCEPTED
  resolution String @db.Text
  resolvedBy String?
  resolvedAt DateTime?
  createdAt DateTime @default(now())
  @@index([status, severity])
}

// ═══════════ 媒体与文档 ═══════════
model ProductMedia {
  id String @id @default(cuid())
  productId String
  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  variantId String?
  variant ProductVariant? @relation(fields: [variantId], references: [id], onDelete: SetNull)
  role String @default("GALLERY")       // HERO | GALLERY | LINE_DRAWING | DIMENSION | PACKING | 3D
  storageKey String @unique
  mimeType String
  fileName String
  width Int?
  height Int?
  size Int
  sourceDocumentId String?
  sourcePage Int?
  sort Int @default(0)
  createdBy String
  createdAt DateTime @default(now())
  @@index([productId, role])
  @@index([variantId])
}

model ProductDocument {
  id String @id @default(cuid())
  productId String?
  product Product? @relation(fields: [productId], references: [id], onDelete: Cascade)
  variantId String?
  kind String                           // SPEC_SHEET | CERTIFICATE | TEST_REPORT | MANUAL | CATALOG
  title String
  storageKey String @unique
  mimeType String
  size Int
  language String @default("en")
  sourceDocumentId String?
  createdBy String
  createdAt DateTime @default(now())
  @@index([productId, kind])
}

// ═══════════ AI 产品画像 ═══════════
model ProductAiProfile {
  id String @id @default(cuid())
  productId String @unique
  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  sellingPointsJson String @db.Text     // string[]
  advantagesJson String @db.Text        // string[]
  useCasesJson String @db.Text          // string[]
  bestCustomerJson String @db.Text      // string[]
  recommendedMarketJson String @db.Text // string[]
  keywordsJson String @db.Text          // string[]
  searchText String @db.Text            // 拼接检索文本（全文 + 向量）
  embeddingRef String @default("")      // 向量索引引用（pgvector 或外部）
  status String @default("DRAFT")       // DRAFT | APPROVED
  reviewedBy String?
  reviewedAt DateTime?
  updatedAt DateTime @updatedAt
}
```

### 2.1 与现有表的关系（加性，不动现有结构）

| 现有 | 关系 | 方式 |
|---|---|---|
| `Customer.productModel`（自由文本） | → `ProductVariant` | **保留原字段**；新增 nullable `variantId` 或 `CustomerProductInterest` 关联表（见 §7 问题 10） |
| `Quotation.product` / `productModel` | → `QuotationItem` → `ProductVariant` | Order OS 阶段处理，本期不动 |
| `MediaAsset` | 不复用 | `MediaAsset.customerId` 为必填，产品图片用独立 `ProductMedia` |
| `ProductAiProfile.embeddingRef` | 未来接 pgvector | 本期先只存 `searchText`，向量化放扩展路线 |

---

## 3. 页面结构

### 3.1 `/products` —— 三栏布局

复用现有 `.bos-sales-grid` 的三栏栅格（230px | 1fr | 250px），保持 BOS 一致性。

```
┌──────────────┬────────────────────────────────────┬──────────────────────┐
│ 产品分类/系列  │ 产品列表                            │ AI 产品分析           │
│              │                                    │                      │
│ ▸ 压缩沙发    │ [搜索框]         [状态筛选] [视图切换] │ 选中 Y-601 后显示：    │
│   · Y 系列 17 │                                    │                      │
│   · D 系列 5  │ ┌────┬──────────┬──────┬─────────┐ │ · AI 卖点（3 条）      │
│ ▸ 压缩床 6    │ │图片│ 型号/系列 │ 变体 │ 起价    │ │ · 目标客群            │
│              │ ├────┼──────────┼──────┼─────────┤ │ · 推荐市场            │
│ ── 状态 ──    │ │    │ Y-601    │ 3 个 │ $134.33 │ │ · 关键词              │
│ □ 在售        │ │    │ WARM HOME│      │         │ │ · 单柜装载量 212 件    │
│ □ 草稿        │ │    │ 2.0M     │      │         │ │ · 数据完整度 / 冲突     │
│ □ 归档        │ └────┴──────────┴──────┴─────────┘ │                      │
│              │                                    │ [生成画像] [编辑]      │
│ ── 数据质量 ── │ 每行附带：CBM / 40HQ 装载量 / 冲突数 │                      │
│ ⚠ 10 项冲突   │                                    │                      │
└──────────────┴────────────────────────────────────┴──────────────────────┘
```

**要点**
- 列表默认显示**起价**与**变体数**，符合销售实际询问方式
- 冲突数直接在列表暴露，不藏进详情
- 右侧 AI 面板复用 `components/workspace/AIReplyPanel` 的交互模式（生成 → 编辑 → 确认）

### 3.2 `/products/[id]` —— 产品详情

```
┌─────────────────────────────────────────────────────────────┐
│  Hero 图   │  Y-601 · Compressed Sofa                        │
│  + 缩略图  │  WARM HOME · 2.0 METER · 在售                     │
│            │  起价 US$134.33 · 3 个尺寸变体 · 40HQ 可装 212 件  │
│            │  [编辑] [查看原图] [导出规格书]                    │
├─────────────────────────────────────────────────────────────┤
│ Specifications │ Packaging │ Pricing │ Materials │ Options │ Media │ AI Analysis │ Sources
├─────────────────────────────────────────────────────────────┤
│  变体表：尺寸 / 包装 / CBM / 毛重 / 40HQ装载 / 单价 / 状态      │
│  ⚠ 该变体存在 1 项数据冲突 → 点击裁决                          │
└─────────────────────────────────────────────────────────────┘
```

页内标签（复用 `.bos-tabs`）：

| 标签 | 内容 |
|---|---|
| **Specifications** | 各尺寸变体表（尺寸 / 变体类型 / 座型） |
| **Packaging** | 多箱明细（每箱尺寸、箱数、件数、毛重）+ CBM 校验结果 |
| **Pricing** | 价格表（币种 / 贸易术语 / 有效期 / 来源文档） |
| **Materials** | 分层材料（中英文 + 规格） |
| **Options** | 面料与色号 |
| **Media** | 大图 / 线稿 / 尺寸图 / 包装图 |
| **AI Analysis** | AI 产品画像 + 生成与审核 |
| **Sources** | 来源文档 + 字段级观察值 + 冲突裁决 |

### 3.3 `/products/import` —— 资料导入

沿用**已验证的 Meta 智能导入模式**（预览 → 确认 → 幂等写入），这是本项目已有的成熟范式：

```
上传 PDF/CSV → 解析 → 字段映射预览 → 冲突预检 → 人工核对 → 确认写入
```

**关键**：预览阶段**零写入**；确认时整批事务；重复导入幂等（用 `fileHash`）。

### 3.4 `/products/conflicts` —— 冲突裁决台

```
字段 | 型号 | 报价表值 | 图册值 | 推导值 | 建议 | [采纳报价表] [采纳图册] [手动输入]
```

### 3.5 设计系统符合性（强制）

| 要求 | 做法 |
|---|---|
| 作用域 | 全部页面包在 `.bos` 内，样式写入 `app/bos.css`（不新增颜色变量） |
| 原语 | 只用 `components/ui/bos.tsx`：`Header` / `Card` / `Table` / `Badge` / `Button` / `EmptyState` / `Skeleton` |
| 字号 | 仅用 `bos-type-*` 既有档位（36/20/15/14/13/11） |
| 断点 | 覆盖 1600 / 1250 / 1100 / 760 / 600，移动端 390px 无横向溢出 |
| 无障碍 | `:focus-visible` 保留；表格用 `caption` + `th scope`；图标 `aria-hidden` |
| 空态/加载 | 每个数据区块都有 `EmptyState` / `Skeleton` + `loading.tsx` |
| 不伪造数据 | 缺失值显示 `—`；未裁决冲突的字段显示"需确认"，**不显示猜测值** |

---

## 4. API 设计

全部遵循 `PROJECT_RULES.md` §4：路由极薄、`requireUser()` 鉴权、Zod 在 service 内解析、`{success,data}` 信封。

### 4.1 产品与变体

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | `/api/products` | 列表：`q` / `category` / `series` / `status` / `hasConflict` / `page` | 登录 |
| POST | `/api/products` | 新建型号 | ADMIN |
| GET | `/api/products/:id` | 详情（含变体/材料/价格/媒体/画像/冲突） | 登录 |
| PATCH | `/api/products/:id` | 编辑 | ADMIN |
| DELETE | `/api/products/:id` | 软删除 | ADMIN |
| GET/POST | `/api/products/:id/variants` | 变体列表 / 新建 | 读登录，写 ADMIN |
| PATCH/DELETE | `/api/product-variants/:id` | 编辑 / 软删除 | ADMIN |
| GET/POST | `/api/product-variants/:id/cartons` | 多箱包装明细 | ADMIN |
| GET/POST | `/api/products/:id/materials` | 分层材料 | ADMIN |
| GET/POST | `/api/products/:id/options` | 面料 / 色号 | ADMIN |
| GET/POST | `/api/products/:id/moq` | 渠道 MOQ（线上 10 / 线下 20，可扩展） | ADMIN |
| GET | `/api/products/:id/moq?channel=ONLINE` | **MOQ 解析**：返回该渠道起订量；未配置返回 `null` | 登录 |

### 4.2 价格

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/product-variants/:id/prices` | 价格历史（按有效期） |
| POST | `/api/product-variants/:id/prices` | 新增价格（写 `sourceDocumentId`） |
| PATCH | `/api/product-prices/:id` | 修改 / 置为 `SUPERSEDED` |
| GET | `/api/products/:id/quote-price?qty=&currency=&incoterm=&tier=&channel=` | **定价解析**：按数量/币种/术语/客户等级/渠道返回唯一价格 **与 MOQ 校验结果**；不满足 MOQ 或无匹配价格时返回 `null` 与原因 |

> `quote-price` 是 AI 报价与订单定价的**唯一入口**，同时返回 `price` 与 `moqCheck`，保证"价格"和"起订量"口径都不会分叉。
>
> **权威规则（已确认）**：规格/包装/CBM/毛重/价格一律以报价表为准，由 `SourceDocument.authority` 与 `SpecConflict.status` 共同保证。

### 4.3 媒体与文档

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/products/:id/media` | 上传（复用 `MEDIA_STORAGE_DIR` 与签名访问机制） |
| GET | `/api/product-media/:id` | 鉴权或签名访问 |
| POST | `/api/products/:id/documents` | 规格书 / 认证上传 |

### 4.4 来源文档与冲突

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/source-documents` | 来源文档登记 |
| POST | `/api/source-documents/:id/parse` | 解析 PDF/CSV → **预览，零写入** |
| POST | `/api/source-documents/:id/commit` | 确认写入（幂等，整批事务） |
| GET | `/api/spec-conflicts` | 冲突列表（按严重度/状态） |
| PATCH | `/api/spec-conflicts/:id` | 裁决（采纳某来源 / 手动值） |

### 4.5 AI 能力

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/PUT | `/api/products/:id/ai-profile` | 读取 / 保存画像（`APPROVED` 才可用于对外） |
| POST | `/api/products/:id/ai-profile/generate` | AI 生成建议 → 返回草稿，**人工确认后落库** |
| POST | `/api/products/search` | **AI 选品**：自然语言 → 候选 + 理由 |
| GET | `/api/products/:id/knowledge` | 生成知识文档（供 RAG 分块索引） |

### 4.6 Zod 契约要点

- 尺寸类：`z.coerce.number().int().min(1).max(2000)`（cm）
- CBM：`z.coerce.number().min(0).max(50)`，服务端同时算 `cbmComputed` 并比对
- 价格：复用 `lib/validation.ts` 的 `amount`（非负、两位小数、上限 1e12）
- 型号：`z.string().trim().regex(/^[YDC]-\d{3}$/, '型号格式应为 Y-601')`
- 分页：硬上限 100/页（沿用 `take:101` → `slice(0,100)` 模式）
- `incoterm`：`z.enum(['FOB','EXW','CIF','DDP']).default('FOB')`（FOB 已确认为现行报价术语）
- `channel`：`z.enum(['ONLINE','OFFLINE','ALIBABA','WEBSITE','EXHIBITION'])`，MOQ 与价格解析均需携带

---

## 5. AI 能力规划

### 5.1 分层定位

```
L3 编排：客户问 "I need 100 sofas for France"
          → 解析意图 → 调工具 → 评分排序 → 生成带理由的推荐
L2 工具（全部带 Actor 作用域，只读，复用 services）
   searchProducts()  getVariantSpecs()  getPacking()  getPrice()
   getUnitsPer40HQ()  getMaterials()  getAiProfile()  searchKnowledge()
L1 事实层（唯一权威，禁止模型编造）
   Product / ProductVariant / PackingCarton / ProductPrice / ProductMaterial
L0 网关：lib/ai/（供应商无关、模型路由、成本计量、Zod 约束）
```

### 5.2 AI Product Profile（你指定的字段）

```jsonc
{
  "product": "Y-601",
  "sellingPoints": [
    "Space-saving compressed sofa (压缩后体积仅为常规包装的 20%)",
    "80% shipping cost saving vs uncompressed",
    "Easy self-installation, no tools required"
  ],
  "advantages": ["最低 CBM 0.16 → 40HQ 可装 425 件"],
  "useCases": ["Living room modular seating", "Small apartment", "Retail display"],
  "bestCustomer": ["Furniture importer", "Online furniture retailer"],
  "recommendedMarket": ["France", "Canada", "Australia"],
  "keywords": ["compressed sofa","vacuum packed sofa","modular sofa","corduroy sofa"]
}
```

**生成方式**：从图册页内容（系列名、材料、座型、摆放方式）+ 报价表数据（CBM/装载量/价格带）生成 → 人工审核 → `status=APPROVED` 才可用于对外沟通。

**关键约束**：`recommendedMarket` 属**经营性判断**，必须由业务确认，不能仅由 AI 定稿（当前资料里没有任何市场数据支撑）。

### 5.3 AI 选品（你给的场景）

```
输入：客户 "I need 100 sofas for France"，已知预算/市场（可选）

Step 1 意图解析（Zod 约束的 JSON）
       { category: "COMPRESSED_SOFA", quantity: 100, market: "FR", seats: null }

Step 2 候选过滤（结构化查询，非模型）
       status=ACTIVE 且 category 匹配 且 有有效价格

Step 3 多维评分（确定性算法，可解释）
       装载效率  unitsPer40HQ   权重 30%   ← 压缩沙发的第一卖点
       价格竞争力 单价所在分位     权重 25%
       市场适配  recommendedMarket 命中  权重 20%
       变体覆盖  能否满足数量/组合  权重 15%
       数据完整度 无冲突、字段齐全  权重 10%

Step 4 输出（必须可解释）
       推荐：Y-601（270×180×66）
       理由：CBM 0.32 → 40HQ 可装 212 件，满足 100 件并留出组合空间；
              US$246.27/件（FOB），100 件约 US$24,627；
              MOQ 校验通过（线上 10 件 / 线下 20 件，100 件均满足）；
              WARM HOME 为当前在售主力系列。
       ⚠ 价格为 FOB，不含关税与运费。
```

**要点**：评分是**确定性算法**，AI 只负责解析意图与组织语言。这保证结果可复现、可审计、可解释——避免"AI 随便推荐一个"。

### 5.4 防幻觉硬约束

| 约束 | 实现 |
|---|---|
| 价格只能来自 `ProductPrice` | `getPrice()` 查不到 → 明确回答"需确认"，**禁止估算** |
| CBM / 毛重只能来自 `PackingCarton` / 变体字段 | 同上 |
| 冲突未裁决的字段不可用于对外 | `SpecConflict.status=OPEN` → 降级为"需确认" |
| 每个回答带来源 | 输出附 `productId` / `variantId` / `sourceDocumentId` |
| 不承诺交期 | `leadTimeDays` 来自报价表（7–15 天）；为空时不回答 |
| **MOQ 必须按渠道回答** | 线上 10 件 / 线下 20 件；未指定渠道时**反问渠道**，不默认取其一 |
| **权威冲突未裁决的字段不可用** | `SpecConflict.status=OPEN/BLOCKER` → 降级为"需确认" |
| 对外内容永远人工发送 | 沿用现有红线 |

### 5.5 与知识库（RAG）的关系

| 数据类型 | 检索方式 | 理由 |
|---|---|---|
| 尺寸 / CBM / 重量 / 价格 | **结构化查询** | 必须精确，不能靠相似度 |
| 材料 / 座型 / 色号 | 结构化查询 | 同上 |
| 卖点 / 话术 / 认证 / 政策 | **向量检索**（`ProductAiProfile.searchText` + `ProductDocument`） | 语义匹配更合适 |
| 客户问"适合法国的沙发" | 结构化过滤（市场字段）+ 向量补充 | 混合 |

> 顺序固定：**先结构化，后向量**。向量结果必须带来源，且不得覆盖结构化事实。

---

## 6. 后续扩展路线

| 阶段 | 内容 | 依赖 |
|---|---|---|
| **P1（本期 · V1.0）** | 14 张表 + `/products` 四页面 + 8 组 API + 报价表/图册导入解析 + 冲突裁决 + AI 画像与选品 | — |
| **P2** | 柜型装载优化（20GP / 40GP / 40HQ / 45HQ）、装柜计算器、产品级成本与真实毛利 | P1 有准确 CBM |
| **P3** | 与 Order OS 打通：`QuotationItem` → `ProductVariant`；`Deal.productCost` 取真实成本；订单行引用产品 | Order OS 阶段 |
| **P4** | 供应商与采购（`Supplier` / `PurchaseOrder`）、交期与库存、MOQ 阶梯价 | P2 |
| **P5** | 向量检索升级（pgvector）、图册图片 AI 自动打标与归类、多语言产品内容、经销产品目录分发 | 数据库迁移到 PostgreSQL |
| **P6** | 产品版本与停产管理、替代型号推荐、竞品价格追踪 | — |

### 6.1 本期明确不做

- ❌ 不做库存与采购（无当前数据支撑）
- ❌ 不做数量分档价（报价表未提供，等业务确认）
- ❌ 不做多币种换算（沿用现有多币种隔离原则）
- ❌ 不做向量检索（先落 `searchText`，数据库迁移后再上）
- ❌ 不自动生成对外发送内容

### 6.2 数据迁移要求（严格遵守 PROJECT_RULES）

1. **加性**：14 张新表；仅可选的 `Customer.variantId`（nullable）属现有表变更——若你选择不加，则用关联表替代。
2. **迁移命名**：`2026xxxxxx_product_os_core`
3. **seed**：以 [product-os/source-extract.json](product-os/source-extract.json) 为准，写入 **28 型号 / 58 变体**，并：
   - **同时写入两个来源的观察值**，使冲突在首次导入时就被系统记录
   - 按已确认规则填充：`incoterm = FOB`、`ProductMoq`（ONLINE=10 / OFFLINE=20）
   - 冲突字段按附录 A 的裁决结果取值（6 项已裁决；2 项 BLOCKER 待你确认后再定稿）
4. **不修改生产逻辑**：现有 `Quotation` / `Deal` / 业绩指标零改动。
5. **副本演练**：迁移与 seed 先在数据库副本执行，逐字段比对。

### 6.3 验收标准

- [ ] 28 型号、58 变体全部入库，尺寸/包装/CBM/毛重/价格与报价表逐一核对一致
- [ ] 10 类冲突在 `/products/conflicts` 全部可见，可逐条裁决
- [ ] `cbmComputed` 校验能自动识别出 D-612 的 CBM 错误
- [ ] 多箱包装（如 `100*29*20+101*21*13+110*30*33`）能正确结构化与还原
- [ ] 40HQ 装载量按 CBM 正确推导
- [ ] AI 询价返回数据库真实价格（FOB）；无价格时回答"需确认"而非估算
- [ ] AI 回答 MOQ 时按渠道区分（线上 10 / 线下 20）；未指定渠道时反问
- [ ] 渠道 MOQ 可通过 `/api/products/:id/moq` 配置与扩展
- [ ] AI 选品对 "100 sofas for France" 返回带理由的推荐
- [ ] `/products` 四页面符合 BOS 设计系统，390px 无横向溢出
- [ ] `pnpm test` / `lint` / `tsc --noEmit` / `pnpm build` 全绿
- [ ] 现有 CRM 全部功能与业绩指标零回归

---

## 7. 待确认问题

### ✅ 已确认（2026-09-22）

| # | 问题 | 结论 |
|---|---|---|
| A-01 | 贸易术语 | **FOB** |
| A-02 | MOQ | **线上 10 件 / 线下交谈 20 件**（按渠道分档） |
| A-03 | 数据权威性 | **所有型号一律以报价表为准**（Y-614 采用 113*75*35） |

### 🔴 待确认 · BLOCKER（2 项）

「以报价表为准」若**严格执行**，会把下面两处**可证明的错误**写进系统。建议例外处理，请确认：

| # | 型号 | 报价表值 | 问题 | 建议 |
|---|---|---|---|---|
| 1 | **D-612** | CBM **0.23** | 包装 `33*33*91` 推导为 **0.0991**，相差 **2.3 倍**。CBM 直接决定 40HQ 装载量与运费估算 | 采用 **0.1**（图册值） |
| 2 | **Y-611** | 尺寸 **300*16*68** | 高 16cm 的沙发不成立；图册为 `300*106*68` | 采用 **300*106*68** |

> 若你选择"一律以报价表为准、不做例外"，我也可以照办 —— 但这两个数字会进入 AI 报价与装柜计算，影响真实运费报价，请确认后我再执行。

### 待确认 · 一般（8 项）

| # | 问题 | 影响 |
|---|---|---|
| 3 | 是否需要**数量分档价**（如 1-10 / 11-50 / 50+）？ | 定价模型复杂度 |
| 4 | 「线上 / 线下」之外是否还有其他 MOQ 渠道（Alibaba / 独立站 / 展会）？ | `ProductMoq.channel` 值域 |
| 5 | **WARM HOME** 的正式中文系列名？ | 中文界面与知识库 |
| 6 | ~~**Y-604 / Y-606 / Y-616 / Y-617** 的实物图与系列归属？~~ 2026 图册已收录 | 数据完整性 |
| 7 | **智能床垫（Smart Mattress）** 资料何时提供？是否纳入本期？ | 品类扩展 |
| 8 | 色号体系（`K3115-12` / `3115-18`）是否需要独立管理？ | `ProductOption` 设计 |
| 9 | 40HQ 可用容积按 **68 m³** 估算是否可接受？ | 装载量派生指标 |
| 10 | `Customer.productModel` 与产品库如何关联：**nullable 外键** 还是 **独立关联表**？ | 是否触碰现有表 |

> 已由交叉核对**自动解决**、无需确认的：Y-611 尺寸漏 0、D-612 CBM 矛盾、Y-614 包装版本差异（已按你的答复定案）。

---

## 附录 A · 数据冲突登记册（10 类）

| ID | 类型 | 型号 | 字段 | 裁决 |
|---|---|---|---|---|
| C-01 | 模板复制错误 | Y-601, Y-602 | 图册包装表 | ✅ **已裁决** → 以报价表为准 |
| C-02 | 模板复制错误 | D-608, D-611 | 图册包装表 | ✅ **已裁决** → 以报价表为准 |
| C-03 | 算术错误 | D-612 | CBM | 🔴 **BLOCKER** → 严格执行报价表将写入 0.23（推导值 0.0991）；建议例外采用 0.1 |
| C-04 | 录入笔误 | Y-611 | 尺寸 | 🔴 **BLOCKER** → 严格执行报价表将写入 `300*16*68`；建议例外采用 `300*106*68` |
| C-05 | 真实版本差异 | Y-614 | 包装/CBM/重量 | ✅ **已裁决** → 2026-10-13 起以 2026 图册为准（`64*34*112` 等，原裁决 `113*75*35` 被取代） |
| C-06 | 粒度差异 | Y-608, Y-615, D-608, D-609 | 变体粒度 | ✅ **已裁决** → 非冲突，`variantType` 区分 CONFIGURATION / MODULE 并存 |
| C-07 | 材料描述不一致 | Y-601, Y-602, Y-608, C-301 | 材料 | ✅ **已裁决** → 报价表为权威值；图册中英文名作为知识库补充保留 |
| C-08 | 数据缺失 | D-612, Y-613 | 毛重 | ✅ **已裁决** → 两来源互补（D-612 用图册 18kg；Y-613 用报价表 37kg） |
| C-09 | 图册未覆盖 | Y-604, Y-606, Y-616, Y-617 | — | ✅ **已解决** → 2026 图册已收录（图片、尺寸、中文材料） |
| C-10 | 业务未确认 | 全部 | 贸易术语/MOQ/分档价 | 🟡 **部分解决** → FOB 与 MOQ 已确认；分档价待定 |

**统计**：7 项已裁决 · 2 项 BLOCKER 待确认 · 1 项部分解决。

完整字段级明细见 [product-os/source-extract.json](product-os/source-extract.json) 的 `conflicts` 与 `confirmedDecisions` 数组。

---

## 附录 B · 资料解析技术记录

| 项 | 结果 |
|---|---|
| 报价表文字提取 | `pypdf` 直接提取成功，3 页约 6,000 字符，数据完整 |
| 图册 | **25 页全部为扫描图片，无文字层**，文字提取结果为 0 字符 |
| 图册读取方式 | 用 `pypdf` + `Pillow` 提取每页内嵌图像 → 缩放到 1500px → 视觉逐页读取 |
| 已提取资产 | 图册 25 页高清图 + 报价表 30 张产品缩略图 |
| 结论 | 图册**必须走 OCR 或视觉解析**才能进入系统，这本身说明需要 `/products/import` 的图片解析能力 |
