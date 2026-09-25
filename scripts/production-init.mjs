import { scryptSync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

required('DATABASE_URL');
const adminPassword = required('SEED_ADMIN_PASSWORD');
required('AUTH_SECRET');

const { PrismaClient } = await import('@prisma/client');
const probe = new PrismaClient();
let needsBaseline = false;
try {
  const tables = await probe.$queryRaw`SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('Customer', '_prisma_migrations')`;
  const names = new Set(tables.map(table => table.name));
  if (names.has('Customer')) {
    const migrations = names.has('_prisma_migrations')
      ? await probe.$queryRaw`SELECT COUNT(*) AS count FROM _prisma_migrations`
      : [{ count: 0 }];
    needsBaseline = Number(migrations[0].count) === 0;
  }
} finally {
  await probe.$disconnect();
}
if (needsBaseline) {
  const baseline = spawnSync(process.execPath, ['scripts/baseline-mysql.mjs'], { stdio: 'inherit', env: process.env });
  if (baseline.status !== 0) process.exit(baseline.status ?? 1);
}

const prismaCli = 'node_modules/prisma/build/index.js';

// ── 解除「失败且文件已不存在」的迁移记录 ──────────────────────
// 背景：某个 migration 已被部署过，之后又被改名或重写，Prisma 会留下一条
// finished_at 为空的失败记录。这条记录会让后续所有迁移永久报 P3009 而无法应用。
//
// 只在**本地已无该 migration 文件**时才自动解除 —— 那种记录必然是历史遗留。
// 如果文件还在，说明是真的迁移失败，交给人处理，不擅自改动。
const migrationProbe = new PrismaClient();
try {
  const failed = await migrationProbe.$queryRaw`
    SELECT migration_name AS name
    FROM _prisma_migrations
    WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
  for (const row of failed) {
    const file = `prisma/migrations/${row.name}/migration.sql`;
    if (fs.existsSync(file)) {
      console.warn(`Prisma: 迁移 ${row.name} 失败但文件仍在，需要人工检查，未自动处理。`);
      continue;
    }
    console.warn(`Prisma: 迁移 ${row.name} 失败且本地已无对应文件，标记为已回滚以解除阻塞。`);
    const resolved = spawnSync(
      process.execPath,
      [prismaCli, 'migrate', 'resolve', '--rolled-back', row.name],
      { stdio: 'inherit', env: process.env },
    );
    if (resolved.status !== 0) {
      console.error(
        `Prisma: 自动解除失败。请在服务器上运行：npx prisma migrate resolve --rolled-back ${row.name}`,
      );
      process.exit(resolved.status ?? 1);
    }
  }
} catch (error) {
  // _prisma_migrations 尚未建立时跳过（全新数据库）
  if (!/doesn't exist|Unknown table|no such table/i.test(String(error))) throw error;
} finally {
  await migrationProbe.$disconnect();
}

const push = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
});
if (push.status !== 0) process.exit(push.status ?? 1);

const db = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

try {
  await db.user.upsert({
    where: { email: 'admin@example.com' },
    create: {
      name: 'Jason',
      email: 'admin@example.com',
      role: 'ADMIN',
      passwordHash: hashPassword(adminPassword),
    },
    update: {
      name: 'Jason',
      role: 'ADMIN',
      passwordHash: hashPassword(adminPassword),
    },
  });

  await db.setting.upsert({
    where: { id: 'system' },
    create: {
      id: 'system',
      companyName: '木远家具贸易',
      currency: process.env.DEFAULT_CURRENCY ?? 'CNY',
      timezone: process.env.DEFAULT_TIMEZONE ?? 'Asia/Shanghai',
    },
    update: {},
  });

  // Product OS：每次都跑一遍种子。
  //
  // 种子本身完全幂等（按 Product.model / ProductVariant.sku / storageKey upsert），
  // 所以重复执行是安全的，代价只是几秒。
  //
  // 之前用「产品库为空才跑」的条件，结果第一次部署后再改分类/加型号都不会生效 ——
  // 这类「守卫条件过期」的 bug 已经发生过两次（空产品库、缺产品图），
  // 因此这里不再做条件判断：宁可每次多花几秒，也不要再出现「部署成功但数据是旧的」。
  //
  // 注意：这里**不能**传 `--env-file=.env`。生产环境（Hostinger 等）没有 .env 文件，
  // 环境变量由平台注入；`node --env-file=<缺失文件>` 会直接以退出码 9 结束，
  // 造成「页面能用但没数据」的静默失败。环境变量已通过 env 继承。
  try {
    const tsxCli = 'node_modules/tsx/dist/cli.mjs';
    if (!fs.existsSync(tsxCli)) {
      console.warn(`Product OS: 缺少 ${tsxCli}，跳过种子。请在服务器上运行 pnpm db:seed:products。`);
    } else {
      const before = await db.product.count();
      console.log(`Product OS: seeding product library (currently ${before} products)...`);
      const seed = spawnSync(process.execPath, [tsxCli, 'prisma/seed-product-os.ts'], {
        stdio: 'inherit',
        env: process.env,
      });
      if (seed.error) {
        console.warn(`Product OS: 种子启动失败（${seed.error.message}）。请运行 pnpm db:seed:products。`);
      } else if (seed.status !== 0) {
        console.warn(`Product OS: 种子以退出码 ${seed.status} 结束。请运行 pnpm db:seed:products。`);
      } else {
        const [products, images, categories] = await Promise.all([
          db.product.count(),
          db.productMedia.count(),
          db.productCategory.count(),
        ]);
        console.log(
          `Product OS: 种子完成，当前 ${products} 个型号、${images} 张产品图、${categories} 个分类。`,
        );
      }
    }
  } catch (error) {
    console.warn('Product OS seed skipped:', error instanceof Error ? error.message : error);
  }

  // 订单：为启用订单模块之前已有的成交补单。按 dealId 幂等，重复运行不会重复建单。
  try {
    const tsxCli = 'node_modules/tsx/dist/cli.mjs';
    if (fs.existsSync(tsxCli)) {
      const before = await db.order.count();
      const seed = spawnSync(process.execPath, [tsxCli, 'prisma/seed-orders.ts'], {
        stdio: 'inherit',
        env: process.env,
      });
      if (seed.error) {
        console.warn(`Orders: 补单脚本启动失败（${seed.error.message}）。请运行 pnpm db:seed:orders。`);
      } else if (seed.status !== 0) {
        console.warn(`Orders: 补单脚本以退出码 ${seed.status} 结束。请运行 pnpm db:seed:orders。`);
      } else {
        console.log(`Orders: 补单完成，订单数 ${before} → ${await db.order.count()}。`);
      }
    }
  } catch (error) {
    console.warn('Orders backfill skipped:', error instanceof Error ? error.message : error);
  }

  // Meta Lead Ads 环境自检：只报告「是否配置」，**绝不打印变量值**
  {
    const vars = [
      ['META_LEAD_WEBHOOK_SECRET', 'Webhook 验证（hub.verify_token）'],
      ['META_LEAD_VERIFY_TOKEN', '兼容旧名（META_LEAD_WEBHOOK_SECRET 未配时回退）'],
      ['META_PAGE_ACCESS_TOKEN', 'Graph API 读取 leadgen 详情'],
      ['META_APP_SECRET', 'X-Hub-Signature-256 验签'],
      ['META_GRAPH_VERSION', 'Graph API 版本（默认 v26.0）'],
    ];
    const missing = [];
    for (const [name, purpose] of vars) {
      const present = Boolean(process.env[name]?.trim());
      console.log(`Meta Lead Ads: ${present ? '✓ 已配置' : '✗ 未配置'}  ${name} — ${purpose}`);
      // 必填三项缺失时收集，最后统一告警
      if (!present && name !== 'META_LEAD_VERIFY_TOKEN' && name !== 'META_GRAPH_VERSION') missing.push(name);
    }
    if (!process.env.META_LEAD_WEBHOOK_SECRET?.trim() && process.env.META_LEAD_VERIFY_TOKEN?.trim()) {
      console.warn('Meta Lead Ads: 正在使用旧变量名 META_LEAD_VERIFY_TOKEN，建议改用 META_LEAD_WEBHOOK_SECRET。');
    }
    if (missing.length) {
      console.warn(`Meta Lead Ads: 缺少 ${missing.join('、')} —— Meta Webhook 验证或线索拉取将无法工作。`);
      console.warn('Meta Lead Ads: 请在 Hostinger 面板 → Environment variables 中补齐后重新部署。');
    }
  }

  console.log('Production database is ready.');
} finally {
  await db.$disconnect();
}
