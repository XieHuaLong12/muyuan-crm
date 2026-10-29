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

// 失败迁移必须根据备份与实际 DDL 人工核对。文件缺失不代表已回滚。
const migrationProbe = new PrismaClient();
try {
  const failed = await migrationProbe.$queryRaw`
    SELECT migration_name AS name
    FROM _prisma_migrations
    WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
  if (failed.length) {
    throw new Error(`Prisma: 存在未解决的失败迁移：${failed.map(row => row.name).join(', ')}。启动已停止；未自动修改迁移记录，请核对备份和实际 DDL。`);
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
    // 配置密码仅用于首次创建；部署不能重置现有账号。
    update: {},
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

  // 产品种子仅初始化空库。现有产品及包装资料包含人工修正，部署不得覆盖。
  // 需要更新产品目录时，单独审阅并执行现有 db:seed:products 命令。
  // 注意：这里**不能**传 `--env-file=.env`。生产环境（Hostinger 等）没有 .env 文件，
  // 环境变量由平台注入；`node --env-file=<缺失文件>` 会直接以退出码 9 结束，
  // 造成「页面能用但没数据」的静默失败。环境变量已通过 env 继承。
  try {
    const tsxCli = 'node_modules/tsx/dist/cli.mjs';
    const before = await db.product.count();
    if (before > 0) {
      console.log(`Product OS: 保留现有 ${before} 个产品及人工资料，跳过部署种子。`);
    } else if (!fs.existsSync(tsxCli)) {
      console.warn(`Product OS: 缺少 ${tsxCli}，跳过种子。请在服务器上运行 pnpm db:seed:products。`);
    } else {
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

  // 2026 图册校正：已有产品库不再跑种子，压缩沙发（Y 系列）在这里按图册改正
  // （Y-615 / Y-616 编号对调、尺寸 / 包装 / CBM / 毛重、人民币价）。逐字段受保护：只改仍是旧种子值的字段，
  // 人工改过的保留并在日志列出；改完后每次部署只做只读比对。
  try {
    const { applyCatalog2026 } = await import('../prisma/catalog-2026.mjs');
    await applyCatalog2026(db, message => console.log(`Product OS: ${message}`));
  } catch (error) {
    console.warn('Product OS: 图册校正未完成：', error instanceof Error ? error.message : error);
  }

  // 产品主图修复与补登记（已有产品库不再跑种子，图片在这里对齐）：
  //   1. 主图记录指向的图片不存在（例如从别处导入、文件没进仓库的路径）：把这条记录降为图库记录（保留不删），
  //      页面不再显示破图；
  //   2. 没有主图、但仓库里有 public/products/<型号>.jpg 的型号：登记为主图；同一文件已有记录时恢复为主图。
  // 只在本机能看到 public/products 目录时检查文件，避免在拿不到静态文件的环境里误判。
  try {
    const owner = await db.user.findUnique({ where: { email: 'admin@example.com' }, select: { id: true } });
    const canSeeFiles = fs.existsSync('public/products');
    const broken = [];
    const heroes = await db.productMedia.findMany({
      where: { role: 'HERO', product: { deletedAt: null } },
      select: { id: true, storageKey: true, product: { select: { model: true } } },
    });
    for (const hero of heroes) {
      const uploaded = hero.storageKey.startsWith('media/products/');
      if (!uploaded && !canSeeFiles) continue;
      const exists = uploaded
        ? Boolean(await db.productImageFile.findUnique({ where: { storageKey: hero.storageKey }, select: { id: true } }))
        : fs.existsSync(`public/${hero.storageKey}`);
      if (exists) continue;
      await db.productMedia.update({ where: { id: hero.id }, data: { role: 'GALLERY', sort: 1 } });
      broken.push(`${hero.product.model}（${hero.storageKey}）`);
    }
    if (broken.length) console.log(`Product OS: 主图文件不存在，已改为图库记录：${broken.join('、')}`);

    const missing = await db.product.findMany({
      where: { deletedAt: null, media: { none: { role: 'HERO' } } },
      select: { id: true, model: true },
    });
    let added = 0;
    for (const product of missing) {
      const file = `public/products/${product.model}.jpg`;
      const storageKey = `products/${product.model}.jpg`;
      if (!owner || !fs.existsSync(file)) continue;
      const existing = await db.productMedia.findUnique({ where: { storageKey } });
      if (existing && existing.productId !== product.id) continue;
      if (existing) {
        await db.productMedia.update({ where: { id: existing.id }, data: { role: 'HERO', sort: 0 } });
      } else {
        await db.productMedia.create({
          data: {
            productId: product.id, role: 'HERO', storageKey, mimeType: 'image/jpeg', fileName: `${product.model}.jpg`,
            size: fs.statSync(file).size, sort: 0, createdBy: owner.id,
          },
        });
      }
      added += 1;
    }
    if (added) console.log(`Product OS: 补登记 ${added} 张产品主图。`);
  } catch (error) {
    console.warn('Product OS image registration skipped:', error instanceof Error ? error.message : error);
  }

  // 2026 新品：压缩床垫 M-803 等 6 款、智能电动床垫 7 款整套新增，M-801 与 C-301 ~ C-306 按新规格补全；
  // 放在主图修复之后，已在库但没有主图的型号（如智能电动床垫）用仓库里的图片补上。
  // 只新增缺的型号；已有字段只改仍是旧种子值的，人工改过的保留并在日志列出（prisma/products-2026.ts）。
  try {
    const tsxCli = 'node_modules/tsx/dist/cli.mjs';
    if (fs.existsSync(tsxCli)) {
      const run = spawnSync(process.execPath, [tsxCli, 'prisma/products-2026-run.ts'], { stdio: 'inherit', env: process.env });
      if (run.error || run.status !== 0) {
        console.warn(`Product OS: 2026 新品导入未完成（${run.error?.message ?? `退出码 ${run.status}`}）。`);
      }
    }
  } catch (error) {
    console.warn('Product OS: 2026 新品导入未完成：', error instanceof Error ? error.message : error);
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

  // 有效口径：客户在我们第一条消息之后回复才算已回复、有效。把此前因广告自动消息等被系统标为已回复的客户改回来。
  // 只改系统自己设的「已回复」，每条写阶段历史；可重复运行，改完后每次部署只做只读检查。
  try {
    const tsxCli = 'node_modules/tsx/dist/cli.mjs';
    if (fs.existsSync(tsxCli)) {
      const run = spawnSync(process.execPath, [tsxCli, 'prisma/requalify-replies.ts'], { stdio: 'inherit', env: process.env });
      if (run.error || run.status !== 0) {
        console.warn(`有效口径调整未完成（${run.error?.message ?? `退出码 ${run.status}`}）。请运行 pnpm db:requalify-replies。`);
      }
    }
  } catch (error) {
    console.warn('有效口径调整未完成：', error instanceof Error ? error.message : error);
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

  // Meta 广告数据 + 表单目录同步环境自检：只报告「是否配置」，**绝不打印变量值**
  {
    const vars = [
      ['META_AD_ACCOUNT_ID', '广告账户 ID（act_ 开头），Marketing API 同步'],
      ['META_ADS_ACCESS_TOKEN', 'System User Token（ads_read），读取花费/展示/线索'],
      ['META_PAGE_ID', '主页 ID，拉取 leadgen_forms 表单目录'],
      ['META_PAGE_ACCESS_TOKEN', 'Page Token，读取 leadgen 详情与表单目录'],
      ['META_SYNC_SECRET', '定时同步入口 /api/cron/meta-sync 的密钥'],
    ];
    const missing = [];
    for (const [name, purpose] of vars) {
      const present = Boolean(process.env[name]?.trim());
      console.log(`Meta Ads Sync: ${present ? '✓ 已配置' : '✗ 未配置'}  ${name} — ${purpose}`);
      if (!present) missing.push(name);
    }
    if (missing.length) {
      console.warn(`Meta Ads Sync: 缺少 ${missing.join('、')} —— 广告数据 / 表单目录同步将跳过。`);
      console.warn('Meta Ads Sync: 配置方法见 docs/META_ADS_SYNC.md（System User Token 需 ads_read 权限）。');
    }
  }

  console.log('Production database is ready.');
} finally {
  await db.$disconnect();
}
