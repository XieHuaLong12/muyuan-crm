import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin } from '@/lib/auth';
import { FIRST_TOUCH_PRODUCT_LINES } from '@/lib/constants';
import { customerScriptLanguage } from '@/lib/outreach';
import { countryCodeOf } from '@/lib/phone-country';
import { MATERIAL_CATEGORIES, MATERIAL_LANGUAGES, languageRank } from '@/lib/sales-materials';
import { accessible } from './customer-service';
import { MEDIA_TYPES_ALLOWED, mediaStorageDir, storeMedia } from './whatsapp-media-service';
import { PRODUCT_IMAGE } from './product-admin-service';

/**
 * 产品资料 in the chat: the company's catalogs and spec sheets (资料库, uploaded once by an administrator), product
 * photos from the product library, and files this salesperson sent other customers lately. Whatever is chosen is
 * copied into the customer's attachments and goes out through the normal send, so it is recorded like any file.
 */
const MAX_BYTES = 20 * 1024 * 1024;
const directory = () => path.join(mediaStorageDir(), 'materials');
const id = z.string().trim().min(1).max(191);

const materialFields = z.object({
  title: z.string().trim().min(1, '请填写资料名称').max(120, '名称最多 120 个字'),
  category: z.enum(Object.keys(MATERIAL_CATEGORIES) as [keyof typeof MATERIAL_CATEGORIES]).default('CATALOG'),
  language: z.enum(['', ...Object.keys(MATERIAL_LANGUAGES)] as ['', ...(keyof typeof MATERIAL_LANGUAGES)[]]).default(''),
  productLine: z.enum(['', ...FIRST_TOUCH_PRODUCT_LINES.map(l => l.value)] as [string, ...string[]]).default(''),
  sort: z.coerce.number().int().min(0).max(9999).default(0),
});
const materialSelect = { id: true, title: true, category: true, language: true, productLine: true, fileName: true, mimeType: true, size: true, sort: true, updatedAt: true } as const;
export type MaterialView = { id: string; title: string; category: string; language: string; productLine: string; fileName: string; mimeType: string; size: number; sort: number; updatedAt: Date };

const safeFileName = (name: string) => name.replace(/[\r\n/\\]/g, '_').slice(0, 180) || 'material';
function checkFile(file: File) {
  if (!MEDIA_TYPES_ALLOWED.has(file.type)) throw new HttpError(400, '支持 PDF、图片、Office 文档和 ZIP');
  if (!file.size || file.size > MAX_BYTES) throw new HttpError(400, '文件须在 1 字节至 20 MB 之间（WhatsApp 发文件的上限）');
}
async function writeMaterial(file: File) {
  const key = `${randomUUID()}`;
  await mkdir(directory(), { recursive: true });
  await writeFile(path.join(directory(), key), Buffer.from(await file.arrayBuffer()), { flag: 'wx', mode: 0o600 });
  return key;
}
async function readMaterial(storageKey: string) {
  return readFile(path.join(directory(), storageKey)).catch(() => { throw new HttpError(404, '资料文件已不可用，请管理员重新上传'); });
}

/** The 资料库 page: every current file, catalogs first. */
export async function listMaterials() {
  return db.salesMaterial.findMany({ where: { deletedAt: null }, orderBy: [{ category: 'asc' }, { sort: 'asc' }, { updatedAt: 'desc' }], select: materialSelect });
}

export async function uploadMaterial(user: Actor, file: File, fields: Record<string, unknown>) {
  requireAdmin(user, '资料库由管理员维护');
  const v = materialFields.parse(fields);
  checkFile(file);
  const storageKey = await writeMaterial(file);
  try {
    return await db.salesMaterial.create({ data: { ...v, fileName: safeFileName(file.name), mimeType: file.type, size: file.size, storageKey, createdBy: user.id }, select: materialSelect });
  } catch (error) { await unlink(path.join(directory(), storageKey)).catch(() => undefined); throw error; }
}

export async function updateMaterial(user: Actor, materialId: string, input: unknown) {
  requireAdmin(user, '资料库由管理员维护');
  id.parse(materialId);
  const v = materialFields.partial().parse(input);
  const found = await db.salesMaterial.findFirst({ where: { id: materialId, deletedAt: null }, select: { id: true } });
  if (!found) throw new HttpError(404, '资料不存在');
  return db.salesMaterial.update({ where: { id: materialId }, data: v, select: materialSelect });
}

/** 换新版: the same entry gets the new file, so everyone sends the new version from now on. */
export async function replaceMaterialFile(user: Actor, materialId: string, file: File) {
  requireAdmin(user, '资料库由管理员维护');
  id.parse(materialId);
  checkFile(file);
  const found = await db.salesMaterial.findFirst({ where: { id: materialId, deletedAt: null }, select: { storageKey: true } });
  if (!found) throw new HttpError(404, '资料不存在');
  const storageKey = await writeMaterial(file);
  const saved = await db.salesMaterial.update({ where: { id: materialId }, data: { storageKey, fileName: safeFileName(file.name), mimeType: file.type, size: file.size }, select: materialSelect })
    .catch(async error => { await unlink(path.join(directory(), storageKey)).catch(() => undefined); throw error; });
  // Files already sent were copied into each customer's attachments, so the old one is no longer needed.
  await unlink(path.join(directory(), found.storageKey)).catch(() => undefined);
  return saved;
}

/** Removed from the library (kept in the database as deleted; files already sent stay with the customers). */
export async function deleteMaterial(user: Actor, materialId: string) {
  requireAdmin(user, '资料库由管理员维护');
  id.parse(materialId);
  const result = await db.salesMaterial.updateMany({ where: { id: materialId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (!result.count) throw new HttpError(404, '资料不存在');
  return { id: materialId };
}

/** Opens a library file (any signed-in user), for a look before sending. */
export async function materialFile(materialId: string) {
  id.parse(materialId);
  const material = await db.salesMaterial.findFirst({ where: { id: materialId, deletedAt: null }, select: { fileName: true, mimeType: true, storageKey: true } });
  if (!material) throw new HttpError(404, '资料不存在');
  return { ...material, buffer: await readMaterial(material.storageKey) };
}

/** The customer's language as the scripts read it: from the profile, else the country (French / Arabic speaking), else English. */
async function customerLanguage(customerId: string) {
  const c = await db.customer.findUniqueOrThrow({ where: { id: customerId }, select: { language: true, country: true, countryCode: true, whatsapp: true, waId: true, phone: true } });
  return customerScriptLanguage(c.language, countryCodeOf(c));
}

const pickerQuery = z.object({ customerId: id, q: z.string().trim().max(60).default('') });

/** The chat's 产品资料 panel: library files, product photos and recently sent files, in one request. */
export async function materialPicker(user: Actor, input: unknown) {
  const v = pickerQuery.parse(input);
  await accessible(v.customerId, user);
  const language = await customerLanguage(v.customerId);
  const like = v.q ? { contains: v.q } : undefined;
  const [files, products, recent] = await Promise.all([
    db.salesMaterial.findMany({ where: { deletedAt: null, ...(like ? { OR: [{ title: like }, { fileName: like }] } : {}) }, select: materialSelect, take: 100 }),
    db.product.findMany({ where: { deletedAt: null, status: 'ACTIVE', media: { some: { storageKey: { startsWith: PRODUCT_IMAGE.prefix } } },
      ...(like ? { OR: [{ model: like }, { nameCn: like }, { nameEn: like }] } : {}) },
      orderBy: { model: 'asc' }, take: 12,
      select: { id: true, model: true, nameCn: true, nameEn: true,
        media: { where: { storageKey: { startsWith: PRODUCT_IMAGE.prefix } }, orderBy: [{ role: 'desc' }, { sort: 'asc' }], take: 8, select: { id: true, role: true, storageKey: true, fileName: true } } } }),
    recentFiles(user, v.customerId, v.q),
  ]);
  files.sort((a, b) => languageRank(a.language, language) - languageRank(b.language, language) || a.category.localeCompare(b.category) || a.sort - b.sort || b.updatedAt.getTime() - a.updatedAt.getTime());
  return {
    language,
    files,
    products: products.map(p => ({ id: p.id, model: p.model, name: p.nameCn || p.nameEn,
      images: p.media.map(m => ({ id: m.id, hero: m.role === 'HERO', src: `/media/products/${m.storageKey.slice(PRODUCT_IMAGE.prefix.length)}` })) })),
    recent,
  };
}

/** Documents and photos this person sent from BOS in the last 60 days, newest first, one per file name. */
async function recentFiles(user: Actor, customerId: string, q: string) {
  const since = new Date(Date.now() - 60 * 86400_000);
  const sent = await db.whatsAppMessage.findMany({ where: { sentById: user.id, direction: 'OUTBOUND', sentAt: { gte: since }, mediaUrl: { startsWith: '/api/whatsapp/media/' },
    messageType: { in: ['IMAGE', 'FILE', 'DOCUMENT'] }, status: { notIn: ['FAILED'] }, ...(q ? { fileName: { contains: q } } : {}) },
    orderBy: { sentAt: 'desc' }, take: 80, select: { mediaUrl: true, fileName: true, mimeType: true, sentAt: true, customerId: true, customer: { select: { name: true } } } });
  const seen = new Set<string>();
  return sent.filter(m => m.fileName && !seen.has(m.fileName) && !!seen.add(m.fileName)).slice(0, 15).map(m => ({
    id: m.mediaUrl!.slice('/api/whatsapp/media/'.length), fileName: m.fileName!, mimeType: m.mimeType ?? '', sentAt: m.sentAt,
    to: m.customerId === customerId ? '这位客户' : m.customer.name }));
}

const attachInput = z.object({
  customerId: id,
  items: z.array(z.object({ kind: z.enum(['MATERIAL', 'PRODUCT_IMAGE', 'RECENT']), id })).min(1, '请先选资料').max(10, '一次最多发 10 个'),
});

/**
 * Copies the chosen files into the customer's attachments, in the order chosen; the chat then sends them one by
 * one through the normal send (24-hour window, opt-out and records as usual).
 */
export async function attachMaterials(user: Actor, input: unknown) {
  const v = attachInput.parse(input);
  await accessible(v.customerId, user);
  const assets: { id: string; fileName: string; mimeType: string }[] = [];
  for (const item of v.items) {
    let file: { fileName: string; mimeType: string; buffer: Buffer };
    if (item.kind === 'MATERIAL') {
      file = await materialFile(item.id);
    } else if (item.kind === 'PRODUCT_IMAGE') {
      const media = await db.productMedia.findFirst({ where: { id: item.id, product: { deletedAt: null } }, select: { storageKey: true, product: { select: { model: true } } } });
      const image = media ? await db.productImageFile.findUnique({ where: { storageKey: media.storageKey }, select: { data: true, mimeType: true } }) : null;
      if (!media || !image) throw new HttpError(404, '产品图不存在');
      file = { fileName: `${media.product.model}.jpg`, mimeType: image.mimeType, buffer: Buffer.from(image.data) };
    } else {
      // Only files this person sent themselves.
      const sent = await db.whatsAppMessage.findFirst({ where: { sentById: user.id, mediaUrl: `/api/whatsapp/media/${item.id}` }, select: { id: true } });
      const asset = sent ? await db.mediaAsset.findUnique({ where: { id: item.id } }) : null;
      if (!asset) throw new HttpError(404, '文件不存在');
      const buffer = await readFile(path.join(mediaStorageDir(), asset.storageKey)).catch(() => { throw new HttpError(404, '文件已不可用'); });
      file = { fileName: asset.fileName, mimeType: asset.mimeType, buffer };
    }
    const asset = await storeMedia({ customerId: v.customerId, createdBy: user.id, ...file });
    assets.push({ id: asset.id, fileName: asset.fileName, mimeType: asset.mimeType });
  }
  return { assets };
}
