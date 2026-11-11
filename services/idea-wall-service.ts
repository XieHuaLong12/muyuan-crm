import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';
import { dayKey, localDate } from '@/lib/time';
import { IDEA_STATUSES, NOTE_COLORS, NOTE_KINDS, SUGGESTED_TAGS, firstLink, guessKind, splitQuote, tagsOf, tidy, type NoteKind } from '@/lib/idea-wall';
import { mediaStorageDir } from './whatsapp-media-service';
import { createTask } from './task-service';
import { createQuickReply } from './quick-reply-service';
import { uploadMaterial } from './sales-material-service';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const IMAGE_BYTES = 5 * 1024 * 1024;
const imageDir = () => path.join(mediaStorageDir(), 'wall');
const select = {
  id: true, kind: true, text: true, source: true, linkUrl: true, imageKey: true, imageType: true, color: true, status: true, tags: true, pinned: true,
  capturedOn: true, taskId: true, remindOn: true, savedTo: true, savedId: true, archivedAt: true, createdAt: true, updatedAt: true,
} satisfies Prisma.WallNoteSelect;
type Row = Prisma.WallNoteGetPayload<{ select: typeof select }>;
const view = (n: Row) => ({ ...n, imageKey: undefined, hasImage: !!n.imageKey, tags: Array.isArray(n.tags) ? (n.tags as string[]) : [] });
export type WallNoteView = ReturnType<typeof view>;

async function own(user: Actor, noteId: string) {
  const note = await db.wallNote.findFirst({ where: { id: noteId, userId: user.id }, select });
  if (!note) throw new HttpError(404, '这张纸条不存在');
  return note;
}

const listInput = z.object({
  q: z.string().trim().max(100).catch(''),
  kind: z.enum(['', 'IDEA', 'QUOTE', 'USEFUL']).catch(''),
  tag: z.string().trim().max(12).catch(''),
  archived: z.enum(['', '1']).catch(''),
});
/**
 * The wall: pinned first, then newest. An idea whose task got done counts as done. Also what can be tidied and
 * which notes have a reminder due today. Only the owner ever sees their notes.
 */
export async function wall(user: Actor, input: unknown = {}, now = new Date()) {
  const q = listInput.parse(input);
  const { timezone } = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true } });
  // A task finished elsewhere moves its idea to 做完了.
  const linked = await db.wallNote.findMany({ where: { userId: user.id, archivedAt: null, kind: 'IDEA', status: { not: 'DONE' }, taskId: { not: null } }, select: { id: true, taskId: true } });
  if (linked.length) {
    const done = await db.task.findMany({ where: { id: { in: linked.map(n => n.taskId!) }, status: 'DONE' }, select: { id: true } });
    const ids = linked.filter(n => done.some(t => t.id === n.taskId)).map(n => n.id);
    if (ids.length) await db.wallNote.updateMany({ where: { id: { in: ids } }, data: { status: 'DONE' } });
  }
  const all = await db.wallNote.findMany({ where: { userId: user.id, archivedAt: q.archived ? { not: null } : null }, select, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 500 });
  const needle = q.q.toLowerCase();
  const notes = all.filter(n => (!q.kind || n.kind === q.kind) && (!q.tag || (Array.isArray(n.tags) && (n.tags as string[]).includes(q.tag)))
    && (!needle || [n.text, n.source, ...(Array.isArray(n.tags) ? n.tags as string[] : [])].some(s => s.toLowerCase().includes(needle))));
  const live = q.archived ? [] : all;
  const today = dayKey(now, timezone);
  const tags = [...new Set([...SUGGESTED_TAGS, ...live.flatMap(n => Array.isArray(n.tags) ? n.tags as string[] : [])])];
  return {
    notes: notes.map(view),
    counts: { all: live.length, IDEA: live.filter(n => n.kind === 'IDEA').length, QUOTE: live.filter(n => n.kind === 'QUOTE').length, USEFUL: live.filter(n => n.kind === 'USEFUL').length,
      open: live.filter(n => n.kind === 'IDEA' && n.status !== 'DONE').length },
    tags, timezone,
    due: live.filter(n => n.remindOn && dayKey(n.remindOn, timezone) <= today && n.status !== 'DONE').map(n => ({ id: n.id, text: n.text.slice(0, 60) })),
    tidy: q.archived ? [] : tidy(live.map(n => ({ ...n, imageKey: n.imageKey })), now),
    quote: await todayQuote(user, today),
  };
}
export type Wall = Awaited<ReturnType<typeof wall>>;

/** 今日一句: today's sign's words when drawn, else one of the person's own quotes, the same one all day. */
async function todayQuote(user: Actor, today: string) {
  const sign = await db.dailySign.findUnique({ where: { userId_day: { userId: user.id, day: today } }, select: { content: true } });
  const gift = (sign?.content as { gift?: { text: string; source: string } } | null)?.gift;
  if (gift) return { ...gift, fromSign: true };
  const quotes = await db.wallNote.findMany({ where: { userId: user.id, kind: 'QUOTE', archivedAt: null }, select: { text: true, source: true }, orderBy: { createdAt: 'asc' } });
  if (!quotes.length) return null;
  const pick = quotes[[...today].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7) % quotes.length];
  return { text: pick.text, source: pick.source || '自己写的', fromSign: false };
}

const createInput = z.object({
  text: z.string().trim().min(1, '先写一句').max(2000, '最多 2000 个字'),
  kind: z.enum(['AUTO', 'IDEA', 'QUOTE', 'USEFUL']).default('AUTO'),
  source: z.string().trim().max(200).default(''),
  color: z.enum(NOTE_COLORS).default('yellow'),
  tags: z.array(z.string().trim().max(12)).max(10).default([]),
  capturedOn: z.string().trim().max(200).default(''),
});
/** 贴上去: a kind left on 自动 is guessed (lib/idea-wall guessKind); a quote written with 「——」 keeps its source. */
export async function createNote(user: Actor, input: unknown) {
  const v = createInput.parse(input);
  const kind: NoteKind = v.kind === 'AUTO' ? guessKind(v.text) : v.kind;
  const quote = kind === 'QUOTE' ? splitQuote(v.text) : null;
  const note = await db.wallNote.create({ data: {
    userId: user.id, kind, text: quote ? quote.text || v.text : v.text, source: quote ? (v.source || quote.source) : '',
    linkUrl: kind === 'USEFUL' ? firstLink(v.text).slice(0, 1000) : '', color: kind === 'IDEA' ? v.color : kind === 'QUOTE' ? 'cream' : 'white',
    status: kind === 'IDEA' ? 'NEW' : '', tags: tagsOf(v.text, v.tags), capturedOn: v.capturedOn,
  }, select });
  return view(note);
}

/** A screenshot pasted or dropped on the wall: a 有用的 note with the picture, stored privately. */
export async function createImageNote(user: Actor, file: File, fields: Record<string, unknown>) {
  if (!IMAGE_TYPES.has(file.type)) throw new HttpError(400, '截图支持 PNG、JPG、WebP 和 GIF');
  if (!file.size || file.size > IMAGE_BYTES) throw new HttpError(400, '图片要小于 5 MB');
  const text = z.string().trim().max(2000).catch('').parse(fields.text);
  const capturedOn = z.string().trim().max(200).catch('').parse(fields.capturedOn);
  const key = randomUUID();
  await mkdir(imageDir(), { recursive: true });
  await writeFile(path.join(imageDir(), key), Buffer.from(await file.arrayBuffer()), { flag: 'wx', mode: 0o600 });
  try {
    const note = await db.wallNote.create({ data: { userId: user.id, kind: 'USEFUL', text: text || '截图', imageKey: key, imageType: file.type, color: 'white', tags: tagsOf(text), capturedOn }, select });
    return view(note);
  } catch (error) { await unlink(path.join(imageDir(), key)).catch(() => undefined); throw error; }
}

export async function noteImage(user: Actor, noteId: string) {
  const note = await own(user, noteId);
  if (!note.imageKey) throw new HttpError(404, '这张纸条没有图片');
  const bytes = await readFile(path.join(imageDir(), note.imageKey)).catch(() => { throw new HttpError(404, '图片已不可用'); });
  return { bytes, type: note.imageType || 'image/png' };
}

const patchInput = z.object({
  text: z.string().trim().min(1).max(2000).optional(),
  source: z.string().trim().max(200).optional(),
  color: z.enum(NOTE_COLORS).optional(),
  status: z.enum(Object.keys(IDEA_STATUSES) as [keyof typeof IDEA_STATUSES]).optional(),
  kind: z.enum(Object.keys(NOTE_KINDS) as [NoteKind]).optional(),
  tags: z.array(z.string().trim().max(12)).max(10).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  remindOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
/** Edits from the wall: move along, pin, recolour, retag, remind on a day, archive (收起来) or bring back. */
export async function updateNote(user: Actor, noteId: string, input: unknown) {
  const note = await own(user, noteId);
  const v = patchInput.parse(input);
  const { timezone } = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true } });
  const kind = v.kind ?? note.kind;
  if (v.status && kind !== 'IDEA') throw new HttpError(400, '只有想法有进度');
  const data: Prisma.WallNoteUpdateInput = {
    ...(v.text !== undefined ? { text: v.text } : {}), ...(v.source !== undefined ? { source: v.source } : {}), ...(v.color ? { color: v.color } : {}),
    ...(v.status ? { status: v.status } : {}), ...(v.pinned !== undefined ? { pinned: v.pinned } : {}),
    ...(v.tags ? { tags: tagsOf('', v.tags) } : {}),
    ...(v.kind && v.kind !== note.kind ? { kind: v.kind, status: v.kind === 'IDEA' ? 'NEW' : '', color: v.kind === 'IDEA' ? 'yellow' : v.kind === 'QUOTE' ? 'cream' : 'white' } : {}),
    ...(v.archived !== undefined ? { archivedAt: v.archived ? new Date() : null } : {}),
    ...(v.remindOn !== undefined ? { remindOn: v.remindOn ? localDate(`${v.remindOn}T09:00`, timezone) : null } : {}),
  };
  return view(await db.wallNote.update({ where: { id: note.id }, data, select }));
}

/** 转成任务: a task for tomorrow 10:00 (company time) without a customer; the idea moves to 在做 and follows the task. */
export async function noteToTask(user: Actor, noteId: string, now = new Date()) {
  const note = await own(user, noteId);
  if (note.kind !== 'IDEA') throw new HttpError(400, '只有想法能转成任务');
  if (note.taskId) return view(note);
  const { timezone } = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true } });
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000), timezone);
  const task = await createTask({ title: note.text.slice(0, 180), description: '来自想法墙', type: 'FOLLOW_UP', priority: 'MEDIUM', dueDate: localDate(`${tomorrow}T10:00`, timezone).toISOString() }, user);
  return view(await db.wallNote.update({ where: { id: note.id }, data: { taskId: task.id, status: 'DOING' }, select }));
}

const saveInput = z.object({ target: z.enum(['QUICK_REPLY', 'MATERIAL']) });
/**
 * 送到它该去的地方: a line for customers becomes one of my 常用回复 (Chinese text; the reply editor adds the other
 * languages); a screenshot goes into 产品资料 (administrators maintain that library).
 */
export async function saveNote(user: Actor, noteId: string, input: unknown) {
  const note = await own(user, noteId);
  const { target } = saveInput.parse(input);
  if (note.savedTo === target) return view(note);
  let savedId: string;
  if (target === 'QUICK_REPLY') {
    const reply = await createQuickReply(user, { scope: 'MINE', title: note.text.replace(/\s+/g, ' ').slice(0, 30), category: 'OTHER', zh: note.text.slice(0, 1000) });
    savedId = reply.id;
  } else {
    if (!note.imageKey) throw new HttpError(400, '只有截图能放进产品资料');
    const { bytes, type } = await noteImage(user, note.id);
    const material = await uploadMaterial(user, new File([new Uint8Array(bytes)], `想法墙-${note.id}.${type.split('/')[1] || 'png'}`, { type }), { title: note.text.slice(0, 120) || '想法墙截图', category: 'OTHER' });
    savedId = material.id;
  }
  return view(await db.wallNote.update({ where: { id: note.id }, data: { savedTo: target, savedId }, select }));
}
