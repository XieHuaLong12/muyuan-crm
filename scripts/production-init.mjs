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
  // 失败不影响启动：产品数据缺失不应阻断 CRM 运行。
  try {
    const productCount = await db.product.count();
    if (productCount === 0) {
      console.log('Product OS: product library is empty, seeding from the 2026 price list...');
      const seed = spawnSync(
        process.execPath,
        ['--env-file=.env', 'node_modules/tsx/dist/cli.mjs', 'prisma/seed-product-os.ts'],
        { stdio: 'inherit', env: process.env },
      );
      if (seed.status !== 0) {
        console.warn('Product OS seed did not finish. Run `pnpm db:seed:products` manually.');
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
