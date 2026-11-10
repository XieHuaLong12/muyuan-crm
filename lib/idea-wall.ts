/**
 * 想法墙 (docs/IDEA_WALL.md): one person's own wall of notes. Three kinds — 想法 with a progress, 喜欢的话 with where
 * it came from, and 有用的 things (a tip, a link, a screenshot, a line from a chat). The rules for guessing a kind,
 * reading tags and spotting notes worth tidying live here, so the page, the floating capture and the tests agree.
 */
export const NOTE_KINDS = { IDEA: ['💡', '想法'], QUOTE: ['❝', '喜欢的话'], USEFUL: ['📌', '有用的'] } as const;
export type NoteKind = keyof typeof NOTE_KINDS;
export const isNoteKind = (v: string): v is NoteKind => Object.prototype.hasOwnProperty.call(NOTE_KINDS, v);

/** An idea's progress; the other kinds have none. */
export const IDEA_STATUSES = { NEW: '刚想到', WANT: '想做', DOING: '在做', DONE: '做完了' } as const;
export type IdeaStatus = keyof typeof IDEA_STATUSES;
export const STATUS_ORDER: IdeaStatus[] = ['NEW', 'WANT', 'DOING', 'DONE'];
export const nextStatus = (s: string): IdeaStatus => STATUS_ORDER[(STATUS_ORDER.indexOf(s as IdeaStatus) + 1) % STATUS_ORDER.length];

export const NOTE_COLORS = ['yellow', 'pink', 'green', 'blue', 'purple'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
/** Tags offered first; any word after # is a tag too. */
export const SUGGESTED_TAGS = ['广告', '客户', '产品', '系统', '心态', '话术'] as const;
export const MAX_TAGS = 6;

const LINK = /https?:\/\/[^\s<>"'，。]+/i;
export const firstLink = (text: string) => text.match(LINK)?.[0] ?? '';

/**
 * What a pasted text most likely is. A link → 有用的. Words in quotation marks, a 「——」 attribution, or one short
 * sentence closed with 。！ → 喜欢的话. Anything else is an idea. The person can always switch it.
 */
export function guessKind(raw: string): NoteKind {
  const text = raw.trim();
  if (!text) return 'IDEA';
  if (LINK.test(text) || /截图|\.pdf\b/i.test(text)) return 'USEFUL';
  if (/^[「“"『]/.test(text) || /——|—— ?\S/.test(text) || (/^[^？?]{2,40}[。！!]$/.test(text) && !/[要做试想]/.test(text.slice(0, 2)))) return 'QUOTE';
  return 'IDEA';
}

/**
 * Splits a quote from its source when written together: 「付出不亚于任何人的努力。」—— 稻盛和夫 → text and source.
 * Surrounding quotation marks are dropped; the source is kept as written.
 */
export function splitQuote(raw: string) {
  const text = raw.trim();
  const at = text.search(/\s*(——|--|－－)\s*/);
  const body = at > 0 ? text.slice(0, at) : text;
  const source = at > 0 ? text.slice(at).replace(/^\s*(——|--|－－)\s*/, '').trim() : '';
  return { text: body.replace(/^[「“"『]\s*/, '').replace(/\s*[」”"』]$/, '').trim(), source };
}

/** #tags written in the text, plus chosen ones; trimmed, without #, unique, at most MAX_TAGS. */
export function tagsOf(text: string, chosen: string[] = []) {
  const written = [...text.matchAll(/#([\p{L}\p{N}_]{1,12})/gu)].map(m => m[1]);
  return [...new Set([...chosen, ...written].map(t => t.trim().replace(/^#/, '')).filter(Boolean))].slice(0, MAX_TAGS);
}

/** Character bigrams: rough sameness for short Chinese or Latin notes (0 nothing shared … 1 the same). */
function bigrams(text: string) {
  const s = text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
export function similarity(a: string, b: string) {
  const x = bigrams(a), y = bigrams(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const g of x) if (y.has(g)) both++;
  // Dice coefficient: two notes that share most of their character pairs.
  return (2 * both) / (x.size + y.size);
}

export type TidyNote = { id: string; kind: string; status: string; text: string; savedTo: string; linkUrl: string; imageKey: string | null; createdAt: Date; updatedAt: Date };
export type Tidy =
  | { kind: 'MERGE'; keep: string; drop: string; text: string }
  | { kind: 'STALE'; id: string; days: number; text: string }
  | { kind: 'REPLY'; id: string; text: string };
const DAY = 86_400_000;
/** Ideas this similar are probably the same thing written twice. */
export const SAME_IDEA = 0.45;
export const STALE_DAYS = 30;
const PHRASING = /话术|回复|回客户|先问|可以说|客户问|开场|跟进时|[“"].{4,}[”"]/;

/**
 * 帮你理一理, at most three suggestions: two ideas that say the same thing (keep the one already moving), an idea
 * left at 刚想到 for 30 days, and a tip that reads like something to say to customers (存成常用回复). Only
 * suggestions: nothing changes until the person clicks.
 */
export function tidy(notes: TidyNote[], now: Date): Tidy[] {
  const out: Tidy[] = [];
  const ideas = notes.filter(n => n.kind === 'IDEA' && n.status !== 'DONE');
  merge: for (let i = 0; i < ideas.length; i++) {
    for (let j = i + 1; j < ideas.length; j++) {
      if (similarity(ideas[i].text, ideas[j].text) < SAME_IDEA) continue;
      const rank = (n: TidyNote) => STATUS_ORDER.indexOf(n.status as IdeaStatus);
      const [keep, drop] = rank(ideas[i]) > rank(ideas[j]) || (rank(ideas[i]) === rank(ideas[j]) && ideas[i].createdAt <= ideas[j].createdAt) ? [ideas[i], ideas[j]] : [ideas[j], ideas[i]];
      out.push({ kind: 'MERGE', keep: keep.id, drop: drop.id, text: `「${drop.text.slice(0, 30)}」和「${keep.text.slice(0, 30)}」说的是同一件事，留下${keep.status === 'NEW' ? '早贴的' : '已经在动的'}那张？` });
      break merge;
    }
  }
  const stale = ideas.filter(n => n.status === 'NEW' && now.getTime() - n.updatedAt.getTime() >= STALE_DAYS * DAY)
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())[0];
  if (stale) {
    const days = Math.floor((now.getTime() - stale.updatedAt.getTime()) / DAY);
    out.push({ kind: 'STALE', id: stale.id, days, text: `「${stale.text.slice(0, 30)}」贴了 ${days} 天没动，挪到「想做」还是收起来？` });
  }
  const reply = notes.find(n => n.kind === 'USEFUL' && !n.savedTo && !n.linkUrl && !n.imageKey && n.text.length >= 10 && n.text.length <= 600 && PHRASING.test(n.text));
  if (reply) out.push({ kind: 'REPLY', id: reply.id, text: `「${reply.text.slice(0, 30)}」像一句回客户的话，存成常用回复，聊天时打 / 就能用？` });
  return out;
}
