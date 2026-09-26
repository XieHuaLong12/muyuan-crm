# Meta Facebook Lead Ads 接入说明

## 流程

```
Facebook 广告表单
   ↓  Meta Lead Ads Webhook（POST）
/api/leads/webhook   ← 先验 X-Hub-Signature-256
   ↓  Graph API 拉取线索详情
   ↓  映射 CRM 字段
   ↓  按 leadgen_id 去重
写入 Customer（source=FACEBOOK / sourceDetail=Facebook Ads / stage=NEW）
```

## 环境变量

在 **Hostinger 面板 → Environment variables**（或本机 `.env`）添加：

| 变量 | 必填 | 说明 |
|---|---|---|
| `META_LEAD_WEBHOOK_SECRET` | ✅ | 专用于 Meta Webhook 验证。**不要复用 `WEBHOOK_SECRET`** |
| `META_PAGE_ACCESS_TOKEN` | ✅ | 读取 leadgen 详情的 Page Access Token |
| `META_APP_SECRET` | ✅ | 校验 `X-Hub-Signature-256`。**不配则拒绝一切推送** |
| `META_GRAPH_VERSION` | ➖ | 已存在，默认 `v26.0`。Meta 约两年废弃一次版本，到期只改这个变量，不用改代码 |

> ⚠️ 不加 `META_APP_SECRET` 的话，本接口会**拒绝所有推送**（有意为之：宁可漏，不可被伪造客户灌库）。

## Meta 后台配置

1. **developers.facebook.com → 你的 App → Webhooks → Page**
2. **Callback URL**：`https://你的域名/api/leads/webhook`
3. **Verify Token**：填 `META_LEAD_WEBHOOK_SECRET` 的值（必须完全一致）
4. 点 **Verify and Save**
5. **订阅字段**：勾选 **`leadgen`**
6. 到 **Page → Lead Access**，确认该 Page 已授权给你的 App
7. 生成 `META_PAGE_ACCESS_TOKEN`：App → Messenger/Page → 生成 **Page Access Token**（需要 `leads_retrieval` 权限）

## 测试

### 1. 浏览器验证（最快）

```
https://avenee.online/api/leads/webhook?hub.mode=subscribe&hub.verify_token=<TOKEN>&hub.challenge=test123
```

- 页面显示 **`test123`** → 通过
- 返回 `forbidden` → `META_LEAD_WEBHOOK_SECRET` 不匹配或未配置

### 2. 用 Meta 的测试工具推送

Meta App → Webhooks → Page → **Test** 按钮，或到 **Lead Ads Testing Tool** 用真实表单提交一条测试线索。

### 3. 确认 CRM

1. 打开 **客户管理**，应出现一条 `source=Facebook`、`sourceDetail=Facebook Ads`、阶段 **新客户** 的记录
2. 或直接查库：

```sql
SELECT leadgenId, formId, status, customerId, error, createdAt
FROM MetaLeadEvent ORDER BY createdAt DESC LIMIT 10;
```

`status` 含义：

| status | 含义 |
|---|---|
| `RECEIVED` | 已登记，正在处理 |
| `CREATED` | 已创建新客户 |
| `LINKED` | **已有相同邮箱/电话的客户，已关联而不重复创建** |
| `SKIPPED` | 该 `leadgen_id` 已处理过（Meta 重推） |
| `FAILED` | 失败，`error` 列有原因（多为 token 缺失或权限不足） |

## 字段映射

| Facebook 问题 | CRM 字段 |
|---|---|
| Company name | `companyName` |
| Full name | `name` |
| Email | `email` |
| WhatsApp number | `whatsapp`（并写入 `whatsappNormalized`） |
| What best describes your business? | `purchaseType`（归一到批发商/进口商/经销商…） |
| Which market or country… | `country` |
| Estimated order quantity per model? | `quantity`（区间取上限） |
| Are you interested in compressed / roll-packed sofas? | `productInterest` |
| Do you currently import furniture from China? | `notes` |
| What is your main concern when sourcing sofas? | `notes` |
| **未识别的问题** | `notes`，并保留**完整 JSON 原文** |

> 匹配按**关键词**而非写死的字段名，所以你在 Meta 里改问题措辞也不会失效。
> 一个答案命中多个类别时（如「Importer / wholesale」），按**最早出现**的关键词归类。

## 安全设计

| 防线 | 作用 |
|---|---|
| `X-Hub-Signature-256`（HMAC SHA256 + `META_APP_SECRET`） | 防伪造推送写入客户 |
| `MetaLeadEvent.leadgenId` 唯一约束 | 防 Meta 重推造成重复客户 |
| 邮箱/电话查重后**关联**而非新建 | 防同一客户因多次投放重复建档 |

## 不会破坏的既有功能

`/api/leads/webhook` 原先由 catch-all 处理，走 `x-webhook-secret` 请求头。新路由**完整保留了该分支**：

- 带 `x-webhook-secret` 的 POST → 行为与之前**完全一致**（仍调用 `importLead`）
- 不带该头 → 走 Meta 签名校验流程

---

## 为什么 GET 必须完全独立（线上故障记录）

**症状**：Meta 后台点 Verify 报 `ERR_CONNECTION_CLOSED`。

**原因**：Next.js 在**模块加载期**就执行所有顶层 import。原来的 `route.ts` 顶层引了
`lead-import-service` 与 `meta-lead-service`，那条链会拉起 Prisma 客户端与整棵依赖图。
只要初始化失败或冷启动超时，**连不需要数据库的 GET 验证也会一起挂掉** ——
连接被直接关闭，Meta 看到的就是 `ERR_CONNECTION_CLOSED`。

**修法**：

| | 做法 |
|---|---|
| GET | 只 import `next/server` + `node:crypto`，不查库、不调 service、不调 Graph API |
| POST | service 一律用 `await import(...)` **动态加载**，只有真的收到推送才付出加载成本 |

`tests/meta-lead.test.ts` 里有一条断言把这条路钉死：**顶层一旦出现 service / Prisma import 就测试失败**。

## 排查顺序（如果 Verify 仍然失败）

1. **确认已重新部署** —— 改动不部署等于没改
2. 在服务器上直接 curl：

```bash
curl -i "https://avenee.online/api/leads/webhook?hub.mode=subscribe&hub.verify_token=<TOKEN>&hub.challenge=test123"
```

| 现象 | 说明 |
|---|---|
| 返回 `test123` | 代码与变量都对，问题在 Meta 后台填的 token |
| 返回 `403 forbidden` | 变量名或值不对（注意是 `META_LEAD_WEBHOOK_SECRET`） |
| 仍然连接被关闭 | **不再是代码问题**：Hostinger 代理 / WAF / SSL / 域名解析层拦截 |
| 返回 404 | 部署的还是旧版本，该路由不存在 |

---

## 相关文档

- **广告数据 + 表单目录同步**（Marketing API / leadgen_forms）：见 [META_ADS_SYNC.md](META_ADS_SYNC.md)。
  它与本页的 Lead Ads 线索推送互补：线索推送负责「进客户」，广告同步负责「看花费与归因」。
