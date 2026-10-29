import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import { hashPassword } from '../lib/auth';
import { createScript, deleteScript, listScripts, updateScript } from '../services/outreach-script-service';
import { outreachNextView, processOutreach } from '../services/outreach-engine-service';
import { nonStandardShares, outreachDashboard, scriptTouches } from '../services/outreach-analytics-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const actorOf = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const HOUR = 3_600_000;

test('script library: deleting a script takes it and its sends out of the library, the rotation and every number', async () => {
  const tag = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase(), marker = `ScriptDel${tag}`;
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { outreachStartedAt: true, outreachConfig: true } });
  await db.setting.update({ where: { id: 'system' }, data: { outreachStartedAt: new Date('2026-01-01T00:00:00Z'), outreachConfig: {} } });
  const [admin, sales] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }),
    db.user.create({ data: { name: `${marker} Seller`, email: `${marker.toLowerCase()}@example.com`, role: 'SALES', passwordHash: hashPassword('x') } }),
  ]);
  const boss = actorOf(admin), me = actorOf(sales);
  let n = 0;
  const lead = () => {
    const phone = `+338${String(Date.now()).slice(-6)}${String(++n).padStart(2, '0')}`;
    return db.customer.create({ data: { name: `${marker} Lead${n}`, ownerId: sales.id, source: 'FACEBOOK', sourceDetail: 'Sofa_FR_Oct', country: 'France', leadGrade: 'A',
      whatsapp: phone, phone, phoneE164: phone, whatsappNormalized: phone.slice(1), contactKeysAt: new Date(), assignedAt: new Date() } });
  };
  const send = async (customerId: string, content: string) => {
    await db.whatsAppMessage.create({ data: { customerId, direction: 'OUTBOUND', content, sentAt: new Date(Date.now() - 30 * HOUR), raw: '{}', source: 'gupshup', status: 'SENT' } });
    await processOutreach(customerId, { ai: false });
  };
  const textA = `Hi from LVANJU ${tag}, compressed sofas from Foshan. Stores or online?`;
  const textB = `Hello ${tag}, which market do you sell to?`;
  const a = await createScript({ code: `T0-DL${tag}1`, position: 'T0', grades: ['A'], language: 'en', content: textA }, boss);
  const b = await createScript({ code: `T0-DL${tag}2`, position: 'T0', grades: ['A'], language: 'en', content: textB }, boss);
  try {
    // A goes out once; the next lead in the rotation is waiting on A too.
    const [sent, other, waiting] = [await lead(), await lead(), await lead()];
    for (const c of [sent, other, waiting]) await outreachNextView({ customerId: c.id }, me);
    assert.deepEqual((await db.outreachAssignment.findMany({ where: { customerId: { in: [sent.id, other.id, waiting.id] } }, orderBy: { assignedAt: 'asc' } })).map(x => x.scriptId), [a.id, b.id, a.id]);
    await send(sent.id, textA);
    const touch = await db.outreachTouch.findFirstOrThrow({ where: { customerId: sent.id } });
    assert.deepEqual([touch.scriptId, touch.matchType], [a.id, 'EXACT']);
    const since = new Date(Date.now() - 7 * 24 * HOUR);
    const before = await outreachDashboard(boss, { range: 'all' });
    assert.equal(before.ranking.find(r => r.id === a.id)?.sent, 1);
    assert.deepEqual((await nonStandardShares(since)).find(p => p.id === sales.id), { id: sales.id, name: sales.name, total: 1, share: 0 });

    await assert.rejects(deleteScript(a.id, me), (e: { status?: number }) => e.status === 403, 'only administrators delete');
    assert.deepEqual(await deleteScript(a.id, boss), { code: a.code, touches: 1 });

    // Gone from the library, the rotation and the numbers; the touch stays linked to it, so it is not 非标准话术 either.
    assert.equal((await listScripts(boss)).some(s => s.id === a.id), false);
    const after = await outreachDashboard(boss, { range: 'all' });
    assert.equal(after.ranking.some(r => r.id === a.id), false);
    assert.deepEqual([after.cards.sent, after.nonStandard.sent], [before.cards.sent - 1, before.nonStandard.sent]);
    assert.equal((await nonStandardShares(since)).some(p => p.id === sales.id), false);
    await processOutreach(sent.id, { ai: false });
    assert.equal((await db.outreachTouch.findUniqueOrThrow({ where: { id: touch.id } })).scriptId, a.id, 'recomputing does not turn the send into an unmatched one');
    assert.equal(await db.whatsAppMessage.count({ where: { customerId: sent.id } }), 1, 'the chat is untouched');
    await assert.rejects(scriptTouches(a.id, boss), (e: { status?: number }) => e.status === 404);
    await assert.rejects(updateScript(a.id, { status: 'TESTING' }, boss), (e: { status?: number }) => e.status === 404);
    await assert.rejects(deleteScript(a.id, boss), (e: { status?: number }) => e.status === 404);

    // The lead waiting on A gets B when the chat opens; A's words are never matched to it again.
    assert.equal((await outreachNextView({ customerId: waiting.id }, me)).script?.id, b.id);
    await send(other.id, textA);
    assert.notEqual((await db.outreachTouch.findFirstOrThrow({ where: { customerId: other.id } })).scriptId, a.id);

    // The code is free again; a script nobody sent is removed outright.
    const again = await createScript({ code: a.code, position: 'T0', grades: ['A'], language: 'en', content: `${textA} v2` }, boss);
    assert.deepEqual(await deleteScript(again.id, boss), { code: a.code, touches: 0 });
    assert.equal(await db.outreachScript.findUnique({ where: { id: again.id } }), null);
  } finally {
    await deleteTestCustomers({ where: { name: { startsWith: marker } } });
    await db.outreachScript.deleteMany({ where: { code: { startsWith: `T0-DL${tag}` } } });
    await db.user.deleteMany({ where: { id: sales.id } });
    await db.setting.update({ where: { id: 'system' }, data: { outreachStartedAt: setting.outreachStartedAt, outreachConfig: setting.outreachConfig === null ? Prisma.DbNull : setting.outreachConfig } });
  }
});
