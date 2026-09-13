import { scryptSync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

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

const prismaCli = 'node_modules/prisma/build/index.js';
const push = spawnSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate'], {
  stdio: 'inherit',
  env: process.env,
});
if (push.status !== 0) process.exit(push.status ?? 1);

const { PrismaClient } = await import('@prisma/client');
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

  console.log('Production database is ready.');
} finally {
  await db.$disconnect();
}
