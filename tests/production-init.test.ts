import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { db } from '../lib/db';

function assertIsolatedDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['localhost', '127.0.0.1', 'mysql'].includes(url.hostname) && url.pathname.endsWith('_test'));
}

function bootstrap() {
  return spawnSync(process.execPath, ['scripts/production-init.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, SEED_ADMIN_PASSWORD: 'different-bootstrap-password' },
    timeout: 120_000,
  });
}

test('deployment preserves the existing administrator and manually edited product packaging across restarts', async () => {
  assertIsolatedDatabase();
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const variant = await db.productVariant.findFirstOrThrow();
  const cartons = await db.packingCarton.findMany({ where: { variantId: variant.id }, orderBy: { id: 'asc' } });
  try {
    const expectedAdmin = await db.user.update({ where: { id: admin.id }, data: {
      name: 'Manually corrected administrator', passwordHash: 'preserve-manual-password-hash',
    } });
    const expectedVariant = await db.productVariant.update({ where: { id: variant.id }, data: {
      packingRaw: 'Manually verified packaging', cartonCount: 7, cbm: '0.4321', grossWeightKg: '87.65',
      needsReview: false, reviewNote: 'Human verification must survive deployment',
    } });
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = bootstrap();
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: admin.id } }), expectedAdmin);
      assert.deepEqual(await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } }), expectedVariant);
      assert.deepEqual(await db.packingCarton.findMany({ where: { variantId: variant.id }, orderBy: { id: 'asc' } }), cartons);
    }
  } finally {
    await db.user.update({ where: { id: admin.id }, data: { name: admin.name, role: admin.role, passwordHash: admin.passwordHash } });
    await db.productVariant.update({ where: { id: variant.id }, data: {
      packingRaw: variant.packingRaw, cartonCount: variant.cartonCount, cbm: variant.cbm,
      grossWeightKg: variant.grossWeightKg, needsReview: variant.needsReview, reviewNote: variant.reviewNote,
      updatedAt: variant.updatedAt,
    } });
  }
});

test('deployment stops at an unresolved missing migration without falsifying rollback metadata', async () => {
  assertIsolatedDatabase();
  const id = randomUUID();
  const name = `missing_acceptance_${id.replaceAll('-', '')}`;
  try {
    await db.$executeRaw`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count)
      VALUES (${id}, ${'0'.repeat(64)}, ${name}, NOW(3), 0)`;
    const result = bootstrap();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /未解决的失败迁移/);
    const rows = await db.$queryRaw<Array<{ rolled_back_at: Date | null; finished_at: Date | null }>>`
      SELECT rolled_back_at, finished_at FROM _prisma_migrations WHERE id = ${id}`;
    assert.deepEqual(rows, [{ rolled_back_at: null, finished_at: null }]);
  } finally {
    await db.$executeRaw`DELETE FROM _prisma_migrations WHERE id = ${id} AND migration_name = ${name}`;
  }
});

test('deployment registers product photos added after the library was seeded, once, without touching existing photos', async () => {
  assertIsolatedDatabase();
  const product = await db.product.findFirstOrThrow({ where: { model: 'Y-617' } });
  const before = await db.productMedia.findMany({ where: { productId: product.id } });
  const existing = await db.productMedia.findFirstOrThrow({ where: { storageKey: 'products/Y-601.jpg' } });
  await db.productMedia.deleteMany({ where: { productId: product.id, role: 'HERO' } });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = bootstrap();
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      const hero = await db.productMedia.findMany({ where: { productId: product.id, role: 'HERO' } });
      assert.deepEqual(hero.map(media => media.storageKey), ['products/Y-617.jpg'], 'the photo file is registered exactly once');
      assert.deepEqual(await db.productMedia.findUniqueOrThrow({ where: { id: existing.id } }), existing, 'existing photo records are not rewritten');
    }
  } finally {
    await db.productMedia.deleteMany({ where: { productId: product.id } });
    if (before.length) await db.productMedia.createMany({ data: before });
  }
});

test('deployment replaces main photos whose file is missing with the repository photo, keeping the old record', async () => {
  assertIsolatedDatabase();
  const models = ['M-803', '智享-Pro', 'M-802'];
  const products = await db.product.findMany({ where: { model: { in: models } }, include: { media: true } });
  const byModel = new Map(products.map(p => [p.model, p]));
  const before = products.flatMap(p => p.media);
  const brokenKey = (model: string) => `uploads/imported/${encodeURIComponent(model)}.png`;
  try {
    // 从别处导入的主图：路径指向不存在的文件
    for (const model of ['M-803', '智享-Pro']) {
      const hero = byModel.get(model)!.media.find(m => m.role === 'HERO')!;
      await db.productMedia.update({ where: { id: hero.id }, data: { storageKey: brokenKey(model) } });
    }
    const m802 = byModel.get('M-802')!;
    await db.productMedia.create({
      data: { productId: m802.id, role: 'HERO', storageKey: brokenKey('M-802'), mimeType: 'image/png', fileName: 'M-802.png', size: 1, sort: 0, createdBy: m802.createdBy },
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = bootstrap();
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      if (attempt === 0) assert.match(result.stdout, /主图文件不存在，已改为图库记录/);
      else assert.doesNotMatch(result.stdout, /主图文件不存在/, 'a second deployment has nothing to repair');
      const heroes = await db.productMedia.findMany({ where: { productId: { in: products.map(p => p.id) }, role: 'HERO' }, include: { product: true } });
      const heroOf = (model: string) => heroes.filter(h => h.product.model === model).map(h => h.storageKey);
      assert.deepEqual(heroOf('M-803'), ['products/M-803.jpg']);
      assert.deepEqual(heroOf('智享-Pro'), ['products/smart-zhixiang-pro.jpg'], 'smart mattress photos are restored by their file name');
      assert.deepEqual(heroOf('M-802'), [], 'no photo in the repository: the page shows 待补图 instead of a broken image');
      const kept = await db.productMedia.findMany({ where: { storageKey: { in: models.map(brokenKey) } } });
      assert.deepEqual(kept.map(m => m.role), ['GALLERY', 'GALLERY', 'GALLERY'], 'the imported records are kept, not deleted');
    }
  } finally {
    await db.productMedia.deleteMany({ where: { productId: { in: products.map(p => p.id) } } });
    await db.productMedia.createMany({ data: before });
  }
});
