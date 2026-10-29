/**
 * 部署时运行：把 2026 新品与规格补全写入已有的产品库（见 prisma/products-2026.ts）。
 * scripts/production-init.mjs 每次部署调用；只新增缺的型号，已有资料受保护，可重复执行。
 */
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { applyProducts2026 } from './products-2026';

if (existsSync('.env')) process.loadEnvFile('.env');

const db = new PrismaClient();
applyProducts2026(db, message => console.log(`Product OS: ${message}`))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
