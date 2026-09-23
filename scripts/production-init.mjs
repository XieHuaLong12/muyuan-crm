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

  // Product OS：产品库为空时才灌入种子（幂等，只在首次部署执行一次）。
  // 失败不影响启动：产品数据缺失不应阻断 CRM 运行，但必须在日志里说清楚原因。
  //
  // 注意：这里**不能**传 `--env-file=.env`。生产环境（Hostinger 等）没有 .env 文件，
  // 环境变量由平台注入；`node --env-file=<缺失文件>` 会直接以退出码 9 结束，
  // 造成「页面能用但没数据」的静默失败。环境变量已通过 env 继承。
  try {
    const productCount = await db.product.count();
    if (productCount === 0) {
      const tsxCli = 'node_modules/tsx/dist/cli.mjs';
      if (!fs.existsSync(tsxCli)) {
        console.warn(`Product OS: 缺少 ${tsxCli}，跳过种子。请在服务器上运行 pnpm db:seed:products。`);
      } else {
        console.log('Product OS: product library is empty, seeding from the 2026 price list...');
        const seed = spawnSync(process.execPath, [tsxCli, 'prisma/seed-product-os.ts'], {
          stdio: 'inherit',
          env: process.env,
        });
        if (seed.error) {
          console.warn(`Product OS: 种子启动失败（${seed.error.message}）。请运行 pnpm db:seed:products。`);
        } else if (seed.status !== 0) {
          console.warn(`Product OS: 种子以退出码 ${seed.status} 结束。请运行 pnpm db:seed:products。`);
        } else {
          const seeded = await db.product.count();
          console.log(`Product OS: 种子完成，当前 ${seeded} 个型号。`);
        }
      }
    } else {
      console.log(`Product OS: ${productCount} products already present, skipping seed.`);
    }
  } catch (error) {
    console.warn('Product OS seed skipped:', error instanceof Error ? error.message : error);
  }

  console.log('Production database is ready.');
} finally {
  await db.$disconnect();
}
