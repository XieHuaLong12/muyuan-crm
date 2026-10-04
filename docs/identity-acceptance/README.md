# 身份链验收证据

验收日期：2026-10-03。以下记录来自本机隔离 MySQL 8.4 与本地生产构建，截图全部为明确标记的测试夹具，不代表实际客户、销售额或投放效果。完整架构、14 项交付说明与上线步骤见 [IDENTITY_CHAIN.md](../IDENTITY_CHAIN.md)。

## 自动验证

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm test` | 99 项通过，0 失败、0 跳过 | [测试日志](tests.txt) |
| `pnpm lint` | 退出码 0 | [Lint 日志](lint.txt) |
| `pnpm exec tsc --noEmit` | 退出码 0，无诊断输出 | [TypeScript 日志](typescript.txt) |
| `pnpm build` | Next 生产构建通过，路由生成成功 | [构建日志](build.txt) |
| Prisma validate / generate | 通过 | 构建日志及交付说明 |
| 干净旧库增量升级 | 原 13 条 → 16 条，0 条未解决失败迁移 | [部署日志](upgrade-deploy.txt)、[数据核对](upgrade-verification.txt) |
| 原迁移文件保护 | 原 13 条 SQL 与 migration lock 未改变 | [迁移核对](migration-verification.txt) |

关键场景覆盖首次 / 重复留资、CSV 与 Webhook 幂等、500 + 500 行批量导入、双号码别名、跨 WhatsApp 账号冲突、晚到消息、AI 人工覆盖、AI 请求期间的人工成交 / 负责人变更、历史旧成交补单后再归因、固定订单来源、反馈租约与相同 payload 重试、广告分页、权限与 Cron secret。升级哨兵的客户原始联系方式、备注、阶段和 updatedAt 保持不变，旧导入结果仍可读取。

## 页面验收

| 页面 / 操作 | 已核对结果 | 截图 |
| --- | --- | --- |
| 销售身份时间线，1600 × 1000 | E.164 手机、原 Lead 时间、广告层级快照、会话、报价和固定订单来源可追溯 | [桌面身份链](desktop.png) |
| 人工确认 AI 结果 | 人工质量 B、公司修正生效；原 AI 质量 A 保留；真实 WON 阶段保持 | [人工确认](human-review.png) |
| 订单详情，1600 × 1000 | 实际订单与固定 Lead / 广告来源同时可见 | [订单桌面](order-desktop.png) |
| 订单详情，390 × 844 | 归因信息可阅读；页面宽度与滚动宽度均为 390，无横向溢出 | [移动端](mobile.png) |
| 广告反查，1600 × 1000 | 一条 Lead → 一个客户 → 两条消息 / 一个会话 → SENT 报价 → 固定订单，USD 销售额 2000、毛利 800 均为夹具 | [广告反查](ad-trace.png) |
| 广告汇总 | 人工最终采购身份 WHOLESALE 与批发客户数 1 一致；无 Meta 花费时成本 / ROAS 显示未知；币种分行 | 浏览器可访问性状态核对 |

上述新页面的最终验收未发现浏览器 error / warn；桌面身份链、订单与广告反查页面宽度与滚动宽度均为 1600。验收期间未发送真实 WhatsApp 消息，未请求真实 AI，未发送真实 Meta CAPI。外部服务成功、故障与恢复场景由隔离测试模拟。

## 清理与边界

验收客户、其订单、Lead 和导入记录已清理，残留计数均为 0；隔离数据库原有 40 位演示客户保留。临时 Next 服务、临时 MySQL 服务及浏览器验收标签已关闭，浏览器 viewport 已恢复，临时 `.env` 已移除。

本次未推送代码、未部署、未修改生产数据库，也未运行远程 CI。真实 Meta / WhatsApp / DeepSeek 权限、Dataset、token、Webhook 和定时任务配置仍需按交付说明完成，并使用真实测试 Lead 进行线上端到端验收。CAPI 默认关闭；数据库结构迁移通过并不等于已完成历史身份修复，修复任务先 dry-run 再执行并保留审计。
