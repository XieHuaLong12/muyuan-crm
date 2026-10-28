import { db } from '@/lib/db';
import { MAX_ATTEMPTS, addressesToCheck, clampParts, contactabilityScore, gradeOf, mailability, scoreTotal, verifiedFacts, type ScoreParts, type VerifyStatus } from '@/lib/radar';
import { deepSeekConfigured } from './deepseek-customer-service';
import { scoreWithAi } from './radar-ai-service';

/**
 * Scoring and e-mail checks for new radar prospects, run by the radar's scheduled job in small batches. DeepSeek reads
 * the site and scores four dimensions; contactability comes from the address checks, which are only paid for when a
 * prospect may be mailed (A or B). Without DeepSeek a prospect stays unscored — a rule guess would mislead the grade.
 */

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'unknown').slice(0, 300);

type EmailRow = { id: string; address: string; kind: string; verifyStatus: string; verifyAttempts: number; bouncedAt: Date | null };
/** Score, grade and card status from the stored parts and the current address checks. */
function regrade(parts: ScoreParts, prospect: { emails: EmailRow[]; whatsapp: string; phone: string; status: string; customerType: string }) {
  const full = { ...parts, contactability: contactabilityScore(prospect.emails, prospect) };
  const score = scoreTotal(full);
  const mail = mailability(prospect.emails);
  // Only the open states follow the addresses; a prospect someone excluded or contacted keeps its status.
  const status = prospect.status === 'NEW' || prospect.status === 'NO_EMAIL' ? (mail === 'NONE' ? 'NO_EMAIL' : 'NEW') : prospect.status;
  return { scoreParts: full, score, grade: gradeOf(score), status };
}

/** Scores up to `limit` unscored prospects. Each is claimed first (attempt counter), so overlapping runs never score one twice. */
export async function scoreProspects(limit = 20) {
  if (!deepSeekConfigured()) return { scored: 0, failed: 0, skipped: 'DEEPSEEK_NOT_CONFIGURED' as const };
  const rows = await db.radarProspect.findMany({ where: { scoredAt: null, status: { in: ['NEW', 'NO_EMAIL'] }, scoreAttempts: { lt: MAX_ATTEMPTS } },
    orderBy: { discoveredAt: 'asc' }, take: limit, include: { emails: true } });
  let scored = 0, failed = 0;
  for (const p of rows) {
    const claim = await db.radarProspect.updateMany({ where: { id: p.id, scoredAt: null, scoreAttempts: p.scoreAttempts }, data: { scoreAttempts: { increment: 1 } } });
    if (!claim.count) continue;
    try {
      const ai = await scoreWithAi({ name: p.name, mapsCategory: p.mapsCategory, rating: p.rating === null ? null : Number(p.rating), reviewCount: p.reviewCount,
        city: p.city, country: p.country, website: p.website, siteText: p.siteText ?? '' });
      const graded = regrade(clampParts({ ...ai.scores, contactability: 0 }), p);
      const unrelated = ai.customerType === 'UNRELATED';
      const status = unrelated && (p.status === 'NEW' || p.status === 'NO_EMAIL') ? 'EXCLUDED' : graded.status;
      await db.radarProspect.update({ where: { id: p.id }, data: {
        customerType: ai.customerType, mainProducts: ai.mainProducts, aiReason: ai.reason, siteFacts: verifiedFacts(ai.facts, p.siteText),
        scoreParts: graded.scoreParts, score: graded.score, grade: graded.grade, scoredAt: new Date(), scoreError: '',
        ...(status !== p.status ? { status, statusAt: new Date() } : {}),
        ...(unrelated && status === 'EXCLUDED' ? { excludedReason: `不是目标行业：${ai.reason}`.slice(0, 200) } : {}),
      } });
      scored++;
    } catch (error) {
      failed++;
      await db.radarProspect.update({ where: { id: p.id }, data: { scoreError: errorText(error) } });
      console.warn('[radar] scoring failed', { prospectId: p.id, error: errorText(error) });
    }
  }
  return { scored, failed };
}

// ─── E-mail checks ──────────────────────────────────────

export type VerifyOutcome = { status: Exclude<VerifyStatus, ''>; detail: string };
export const verifierConfigured = () => !!process.env.EMAIL_VERIFY_API_KEY?.trim() && ['millionverifier', 'zerobounce'].includes(verifierName());
const verifierName = () => (process.env.EMAIL_VERIFY_PROVIDER?.trim().toLowerCase() || 'millionverifier');

/**
 * One address through the configured checker (EMAIL_VERIFY_PROVIDER). Catch-all and disposable inboxes are RISKY:
 * they may be sent to in small numbers. A shared role address (info@) is fine for B2B and counts as VALID.
 */
export async function checkAddress(address: string): Promise<VerifyOutcome> {
  const key = process.env.EMAIL_VERIFY_API_KEY!.trim();
  if (verifierName() === 'zerobounce') {
    const url = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(key)}&email=${encodeURIComponent(address)}&ip_address=`;
    const body = await (await fetch(url, { signal: AbortSignal.timeout(20_000) })).json() as { status?: string; sub_status?: string; error?: string };
    if (body.error || !body.status) throw new Error(`ZeroBounce：${body.error || '没有返回结果'}`);
    const sub = body.sub_status ?? '';
    const status = body.status === 'valid' ? 'VALID' : body.status === 'catch-all' ? 'RISKY' : body.status === 'unknown' ? 'UNKNOWN'
      : body.status === 'do_not_mail' && sub === 'role_based' ? 'VALID' : body.status === 'do_not_mail' && sub === 'disposable' ? 'RISKY' : 'INVALID';
    return { status, detail: [body.status, sub].filter(Boolean).join(' / ').slice(0, 200) };
  }
  const url = `https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(key)}&email=${encodeURIComponent(address)}&timeout=10`;
  const body = await (await fetch(url, { signal: AbortSignal.timeout(20_000) })).json() as { result?: string; subresult?: string; error?: string };
  if (body.error || !body.result) throw new Error(`MillionVerifier：${body.error || '没有返回结果'}`);
  const status = body.result === 'ok' ? 'VALID' : body.result === 'catch_all' || body.result === 'disposable' ? 'RISKY' : body.result === 'invalid' ? 'INVALID' : 'UNKNOWN';
  return { status, detail: [body.result, body.subresult].filter(Boolean).join(' / ').slice(0, 200) };
}

/**
 * Checks the best addresses of A and B prospects (at most two different addresses per prospect, retrying a check
 * that failed), then grades the prospect again: a valid direct address is worth more than a catch-all inbox.
 */
export async function verifyEmails(limit = 20) {
  if (!verifierConfigured()) return { checked: 0, failed: 0, skipped: 'VERIFIER_NOT_CONFIGURED' as const };
  const prospects = await db.radarProspect.findMany({
    where: { grade: { in: ['A', 'B'] }, status: { in: ['NEW', 'NO_EMAIL'] }, emails: { some: { bouncedAt: null, verifyStatus: { in: ['', 'UNKNOWN'] }, verifyAttempts: { lt: MAX_ATTEMPTS } } } },
    orderBy: [{ score: 'desc' }, { discoveredAt: 'asc' }], take: limit, include: { emails: true },
  });
  let checked = 0, failed = 0;
  for (const p of prospects) {
    const due = addressesToCheck(p.emails, p.domain);
    if (!due.length) continue;
    for (const email of due) {
      if (checked + failed >= limit) break;
      const claim = await db.radarEmail.updateMany({ where: { id: email.id, verifyAttempts: email.verifyAttempts }, data: { verifyAttempts: { increment: 1 } } });
      if (!claim.count) continue;
      try {
        const outcome = await checkAddress(email.address);
        await db.radarEmail.update({ where: { id: email.id }, data: { verifyStatus: outcome.status, verifyDetail: outcome.detail, verifiedAt: new Date() } });
        checked++;
      } catch (error) {
        failed++;
        await db.radarEmail.update({ where: { id: email.id }, data: { verifyStatus: 'UNKNOWN', verifyDetail: errorText(error).slice(0, 200), verifiedAt: new Date() } });
      }
    }
    const fresh = await db.radarProspect.findUniqueOrThrow({ where: { id: p.id }, include: { emails: true } });
    if (!fresh.scoreParts) continue;
    const graded = regrade(clampParts(fresh.scoreParts as Partial<ScoreParts>), fresh);
    await db.radarProspect.update({ where: { id: p.id }, data: { scoreParts: graded.scoreParts, score: graded.score, grade: graded.grade,
      ...(graded.status !== fresh.status ? { status: graded.status, statusAt: new Date() } : {}) } });
    if (checked + failed >= limit) break;
  }
  return { checked, failed };
}
