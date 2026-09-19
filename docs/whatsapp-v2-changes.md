# WhatsApp CRM V2 修改文件

相对原 main 的文件变更。R100 表示只移动旧 SQLite 迁移，内容不变。

```text
M	.env.example
M	.github/workflows/ci.yml
A	app/api/whatsapp/ai-reply/route.ts
A	app/api/whatsapp/messages/route.ts
A	app/api/whatsapp/send/route.ts
M	app/api/whatsapp/webhook/route.ts
M	app/globals.css
M	components/customer-detail.tsx
M	components/whatsapp-chat-panel.tsx
M	components/workspace.tsx
A	docs/whatsapp-v2-deployment.md
M	lib/constants.ts
A	lib/gupshup.ts
M	lib/types.ts
A	prisma/baseline/schema.prisma
R100	prisma/migrations/20260910054903_init/migration.sql	prisma/legacy-sqlite-migrations/20260910054903_init/migration.sql
R100	prisma/migrations/20260912090000_customer_inquiry_date/migration.sql	prisma/legacy-sqlite-migrations/20260912090000_customer_inquiry_date/migration.sql
R100	prisma/migrations/20260912140000_meta_import/migration.sql	prisma/legacy-sqlite-migrations/20260912140000_meta_import/migration.sql
R100	prisma/migrations/20260917013000_ai_whatsapp_foundation/migration.sql	prisma/legacy-sqlite-migrations/20260917013000_ai_whatsapp_foundation/migration.sql
A	prisma/legacy-sqlite-migrations/migration_lock.toml
A	prisma/migrations/20260918000000_mysql_baseline/migration.sql
A	prisma/migrations/20260919090000_whatsapp_v2/migration.sql
M	prisma/migrations/migration_lock.toml
M	prisma/schema.prisma
A	scripts/baseline-mysql.mjs
M	scripts/production-init.mjs
M	services/deepseek-customer-service.ts
A	services/whatsapp-ai-service.ts
M	services/whatsapp-identity-service.ts
A	services/whatsapp-message-service.ts
A	services/whatsapp-stage-service.ts
M	services/whatsapp-webhook-service.ts
M	tests/whatsapp-foundation.test.ts
A	tests/whatsapp-v2.test.ts
M	tests/whatsapp-webhook.test.ts
A	docs/whatsapp-v2-changes.md
```

验证：GitHub Actions CRM CI 第 38 次运行成功执行 MySQL 基线和 V2 迁移、28 项测试（0 失败）、ESLint 和生产构建。本地 strict TypeScript、Prisma validate/generate 和生产构建亦通过。

生产数据库迁移与真实 Gupshup/DeepSeek 凭据联调需在部署环境进行。

界面验收：实际 CustomerDetail 组件 + 模拟 API，Chrome 无头浏览器验证 AI 草稿使用与发送交互；1600px 桌面左右比例约 1.5:1，390px 手机无横向溢出，无浏览器运行错误。

GitHub 直接发布适配：production-init 自动识别无迁移历史的 V1 MySQL 库，通过结构对比后登记基线并迁移；CI 额外验证旧库升级、重复启动和历史数据保留。
