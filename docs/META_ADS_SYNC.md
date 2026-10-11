# Meta 广告数据 + 表单目录同步说明

把 Meta 广告花费/展示/点击/线索（Marketing API）与 Lead Ads 表单目录（leadgen_forms）
自动同步进 CRM，与既有的「Lead Ads 线索推送」形成完整闭环：

```
Meta 广告账户（ads_read） ──→ Campaign / MarketingMetric 表 ──→ Growth Center 广告表现、渠道分析
Meta 主页（leads_retrieval）─→ MetaLeadForm 表（表单名/问题/线索数）
Lead Ads webhook（已上线） ──→ MetaLeadEvent（含 adId/campaignId 归因）→ Customer
```

## 数据流

| 数据 | 来源 API | 写入表 | 展示位置 |
|---|---|---|---|
| 广告系列目录 | `GET /act_{id}/campaigns` | `Campaign`（channel=FACEBOOK，externalId=Meta ID） | Growth Center 广告总览 |
| 近 30 天按天花费/展示/点击/线索 | `GET /act_{id}/insights`（time_increment=1） | `MarketingMetric`（campaignId+metricDate 幂等） | 广告表现 / 渠道分析 |
| 表单目录 | `GET /{page_id}/leadgen_forms` | `MetaLeadForm` | 设置页「Meta 广告与表单」 |
| 线索 → 广告归因 | leadgen 详情里的 ad_id/campaign_id | `MetaLeadEvent.adId / campaignId` | 对账花费与线索 |

同步完全幂等：重复执行只更新数值，不会产生重复的系列/指标/表单。

## 环境变量

在 **Hostinger 面板 → Environment variables**（或本机 `.env`）添加：

| 变量 | 必填 | 说明 |
|---|---|---|
| `META_AD_ACCOUNT_ID` | ✅ | 广告账户 ID，`act_` 开头（Business 设置 → 广告账户），裸数字亦可 |
| `META_ADS_ACCESS_TOKEN` | ✅ | **System User Token**，权限勾选 `ads_read`（见下） |
| `META_PAGE_ID` | ➖ | 主页 ID；配置后才会同步表单目录 |
| `META_PAGE_ACCESS_TOKEN` | ➖ | 已有（Lead Ads 已在用）；表单目录复用它 |
| `META_SYNC_SECRET` | ✅ | 定时同步入口 `/api/cron/meta-sync` 的密钥，**随机长字符串，不要复用其他密钥** |

`META_APP_SECRET` / `META_LEAD_WEBHOOK_SECRET` 等 Lead Ads 变量不变。

## Meta 后台配置（一次性）

### 1. 生成 System User Token（ads_read）

1. 打开 **business.facebook.com → 设置 → 用户 → 系统用户（System users）**
2. 添加系统用户（名称如 `CRM Sync`，角色 Admin）
3. 点该系统用户 → **生成 Token**：
   - App 选择你的 CRM 应用
   - 权限勾选 **`ads_read`**（读花费/展示/线索；不需要 ads_management）
4. **复制 Token 立即保存**——它只显示一次
5. 到 **设置 → 账户 → 广告账户**，确认你的广告账户在这个 Business 下，并把该系统用户加为账户成员

### 2. 权限与审核说明

- `ads_read` 是 **Advanced Access** 权限：标准访问只对「App 管理员自己拥有的广告账户」生效。
- 若 System User Token 调用返回权限错误（同步记录 `MetaSyncRun.error` 里可见），
  需要在 **developers.facebook.com → 你的 App → 应用审核 → 权限和功能** 提交 `ads_read` 的高级访问，
  并完成 **商家验证（Business Verification）**（设置 → 安全中心）。
- 表单目录用现有 Page Token 即可（`leads_retrieval` + `pages_show_list`，Lead Ads 已开通）。

### 3. 广告账户 ID

**business.facebook.com → 设置 → 账户 → 广告账户**，记下 `act_` 开头的数字串。
Meta 广告管理器右上角也能看到账户 ID（形如 `123456789012345`）。

## 定时同步（Hostinger Cron）

**Hostinger 面板 → 高级 → Cron Jobs**，添加：

- 周期：**每 6 小时**（`0 */6 * * *`）
- 命令：`curl -s "https://你的域名/api/cron/meta-sync?secret=<META_SYNC_SECRET 的值>"`
- 或分开跑：`&kind=ads`（只广告）、`&kind=forms`（只表单）

`kind` 默认 `all`。每次执行的统计与失败原因都会落进 `MetaSyncRun` 表，
可在设置页「Meta 广告与表单」卡片直接查看最近一次结果。

## 手动同步与验证

1. **设置页**：管理员登录 → 设置 → 「Meta 广告与表单」卡片 → 点「全部同步」
2. **本机命令行**：

```bash
pnpm meta:sync          # 广告 + 表单
pnpm meta:sync ads      # 只广告
pnpm meta:sync forms    # 只表单
```

3. **验证数据**：

```bash
curl -i "https://你的域名/api/cron/meta-sync?secret=..."   # 200 + JSON 统计
```

```sql
SELECT kind, status, JSON_EXTRACT(detail,'$.account.name') account, error, startedAt
FROM MetaSyncRun ORDER BY startedAt DESC LIMIT 5;

SELECT externalId, name, status, currency FROM Campaign WHERE channel='FACEBOOK';
SELECT metricDate, spend, impressions, clicks, leads FROM MarketingMetric ORDER BY metricDate DESC LIMIT 5;
SELECT formId, name, leadsCount, syncedAt FROM MetaLeadForm;
```

4. **广告效果**（增长中心已于 2026-10-11 并入）：打开「广告与线索 → 广告效果」，「按什么汇总」选「广告系列」，
   表格应出现 Meta 系列的真实花费、平台线索与 CRM 留资；顶部状态显示「广告花费已同步」。
   驾驶舱「Channel Performance」中 Facebook Ads 显示投入。

## 常见失败排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `Graph API 400: (#100) ... param access_token` | Token 未生成或选错 App | 重新生成 System User Token |
| `Graph API 403: (#200) ... ads_read` | 权限不足（Advanced Access） | 提交 App Review + 商家验证，或把 App 管理员加为账户成员 |
| `Graph API 400: (#270) This Ad Account ... not allowed` | System User 不是该账户成员 | Business 设置 → 广告账户 → 添加系统用户 |
| `META_SYNC_SECRET` 校验失败（403 forbidden） | cron 的 secret 与环境变量不一致 | 对齐两边值；注意 URL 需 encode |
| 表单同步报缺 `META_PAGE_ID` | 未配置主页 ID | 主页「关于」里复制 ID 填入 |

## 与既有功能的关系（不破坏任何东西）

- **Lead Ads webhook**（`/api/leads/webhook`）行为不变；本次只在其落库时
  额外记录 `adId/campaignId`（新列为可空，历史线索不受影响）。
- **Growth Center** 此前展示手工录入的 Campaign/MarketingMetric；Meta 同步写入的是
  同一套表（channel=FACEBOOK、externalId=Meta ID），手工数据不会冲突。
- 新表（`MetaAdAccount`/`MetaLeadForm`/`MetaSyncRun`）与迁移 `20260926120000_meta_ads_forms`
  均为加性变更，`prisma migrate deploy` 会自动应用。
