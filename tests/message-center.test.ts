import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { db } from '../lib/db';
import { parseGupshup } from '../lib/gupshup';
import { hashPassword } from '../lib/auth';
import { ingestWhatsAppWebhook } from '../services/whatsapp-webhook-service';
import { archiveInboundMedia, inboundMediaRef, messageMediaAsset, messageMediaHref, signedMediaUrl } from '../services/whatsapp-media-service';
import { inboxConversations, inboxThread, linkCandidates, linkUnmatchedNumber, retryUnmatchedNumbers, unreadConversationCount } from '../services/inbox-service';
import { identityKey } from '../lib/contact-identity';
import { listTemplates, renderTemplate, sendTemplateMessage, templateVariables } from '../services/whatsapp-template-service';
import { recipientNumber, sendWhatsAppMessage } from '../services/whatsapp-message-service';
import { notificationFeed } from '../services/notification-service';
import { workspaceNavigation } from '../lib/role-workspace';
import { GET as mediaRoute } from '../app/api/whatsapp/media/[id]/route';
import { deleteTestCustomers } from './identity-test-cleanup';

const business = '+19195550303';
const v2 = (id: string, phone: string, type: string, payload: Record<string, unknown>, at = Date.now()) =>
  ({ app: 'INBOX_TEST', type: 'message', version: 2, timestamp: at, payload: { id, source: phone, type, sender: { phone, name: `Inbox ${phone.slice(-4)}` }, payload } });
const cloud = (message: Record<string, unknown>) => ({ object: 'whatsapp_business_account', gs_app_id: 'inbox-test-app', entry: [{ changes: [{ field: 'messages', value: {
  metadata: { display_phone_number: business, phone_number_id: 'inbox-phone-id' }, contacts: [{ wa_id: String(message.from).slice(1), profile: { name: 'Inbox V3' } }], messages: [message] } }] }] });
const actorOf = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

async function withEnv<T>(values: Record<string, string>, run: () => Promise<T>) {
  const saved = { ...process.env };
  Object.assign(process.env, values);
  try { return await run(); } finally { for (const key of Object.keys(values)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
}

test('the sidebar opens the message center for both roles', () => {
  assert.equal(workspaceNavigation('SALES')[1].href, '/messages');
  assert.equal(workspaceNavigation('ADMIN').find(s => s.href === '/messages')?.badge, 'messages');
});

test('Gupshup V2 files keep their name and content type', () => {
  const parsed = parseGupshup(v2('file-name', '+33600000001', 'file', { url: 'https://filemanager.gupshup.io/wa/x.pdf', contentType: 'application/pdf', name: 'Specs.pdf' }));
  assert.equal(parsed.kind, 'message');
  if (parsed.kind === 'message') { assert.equal(parsed.fileName, 'Specs.pdf'); assert.equal(parsed.content, 'Specs.pdf'); assert.equal(parsed.messageType, 'DOCUMENT'); }
  assert.equal(templateVariables('Hi {{1}}, this is {{2}}. {{1}}'), 2);
  assert.equal(renderTemplate('Hi {{1}}, this is {{ 2 }}.', ['Yuki', 'Lin']), 'Hi Yuki, this is Lin.');
});

test('received photos, voice notes, videos and documents are copied into storage once', async t => {
  const storage = await mkdtemp(path.join(tmpdir(), 'inbox-media-'));
  const marker = randomUUID().slice(0, 8), phone = `+3361${String(Date.now()).slice(-7)}`;
  await withEnv({ GUPSHUP_SOURCE_NUMBER: business, GUPSHUP_APP_NAME: 'INBOX_TEST', GUPSHUP_API_KEY: 'inbox-key', MEDIA_STORAGE_DIR: storage }, async () => {
    const requests: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
      const url = String(input); requests.push(url);
      if (url.includes('voice.ogg')) return new Response(new Uint8Array([79, 103, 103, 83]), { headers: { 'content-type': 'audio/ogg; codecs=opus' } });
      if (url.includes('huge.mp4')) return new Response(new Uint8Array(4), { headers: { 'content-length': String(40 * 1024 * 1024) } });
      if (url.includes('expired')) return new Response('gone', { status: 404 });
      if (url.includes('moved.jpg')) return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/internal' } });
      if (url.startsWith('https://graph.facebook.com/')) return Response.json({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'image/jpeg' });
      if (url.startsWith('https://lookaside.fbsbx.com/')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } });
      return new Response('unexpected', { status: 500 });
    });
    try {
      const result = await ingestWhatsAppWebhook(v2(`voice-${marker}`, phone, 'audio', { url: 'https://filemanager.gupshup.io/wa/voice.ogg', contentType: 'audio/ogg; codecs=opus' }));
      assert.equal(result.mediaMessageIds.length, 1);
      const voice = await db.whatsAppMessage.findUniqueOrThrow({ where: { id: result.mediaMessageIds[0] } });
      assert.equal(voice.messageType, 'AUDIO');
      assert.equal(messageMediaHref(voice), `/api/whatsapp/messages/${voice.id}/media`);
      const assetId = await archiveInboundMedia(voice.id);
      assert.equal(await archiveInboundMedia(voice.id), assetId, 'second copy reuses the first');
      const archived = await db.whatsAppMessage.findUniqueOrThrow({ where: { id: voice.id } });
      assert.equal(archived.mediaUrl, `/api/whatsapp/media/${assetId}`);
      assert.equal(archived.mimeType, 'audio/ogg; codecs=opus');
      const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
      assert.equal(asset.createdBy, 'SYSTEM'); assert.equal(asset.customerId, voice.customerId); assert.match(asset.fileName, /\.ogg$/);
      assert.deepEqual([...await readFile(path.join(storage, asset.storageKey))], [79, 103, 103, 83]);
      assert.equal(requests.filter(url => url.includes('voice.ogg')).length, 1);

      // Safari plays audio/video only with byte ranges; SVG and other documents are never rendered inline.
      const signed = new URL(signedMediaUrl(assetId, 'http://localhost'));
      const partial = await mediaRoute(new NextRequest(signed, { headers: { range: 'bytes=1-2' } }), { params: Promise.resolve({ id: assetId }) });
      assert.equal(partial.status, 206); assert.equal(partial.headers.get('content-range'), 'bytes 1-2/4');
      assert.deepEqual([...new Uint8Array(await partial.arrayBuffer())], [103, 103]);
      assert.match(partial.headers.get('content-disposition') || '', /^inline/);

      // A file that is gone or larger than 32 MB is reported, not stored; other hosts are never fetched.
      const video = (await ingestWhatsAppWebhook(v2(`video-${marker}`, phone, 'video', { url: 'https://filemanager.gupshup.io/wa/huge.mp4', contentType: 'video/mp4' }))).mediaMessageIds[0];
      await assert.rejects(archiveInboundMedia(video), (e: { status?: number }) => e.status === 413);
      const gone = (await ingestWhatsAppWebhook(v2(`image-${marker}`, phone, 'image', { url: 'https://filemanager.gupshup.io/wa/expired.jpg', contentType: 'image/jpeg', caption: 'showroom' }))).mediaMessageIds[0];
      await assert.rejects(archiveInboundMedia(gone), (e: { status?: number }) => e.status === 404);
      const moved = (await ingestWhatsAppWebhook(v2(`moved-${marker}`, phone, 'image', { url: 'https://filemanager.gupshup.io/wa/moved.jpg', contentType: 'image/jpeg' }))).mediaMessageIds[0];
      await assert.rejects(archiveInboundMedia(moved), (e: { status?: number }) => e.status === 502, 'a redirect off HTTPS is not followed');
      assert.ok(!requests.some(url => url.startsWith('http://127.0.0.1')));
      const foreign = (await ingestWhatsAppWebhook(v2(`doc-${marker}`, phone, 'file', { url: 'https://evil.example.com/a.pdf', contentType: 'application/pdf', name: 'a.pdf' }))).mediaMessageIds[0];
      await assert.rejects(archiveInboundMedia(foreign), (e: { status?: number }) => e.status === 400);
      assert.ok(!requests.some(url => url.includes('evil.example.com')));
      assert.equal((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: foreign } })).fileName, 'a.pdf');

      // Gupshup's Meta-format (V3) callback carries the download link next to the media id.
      const v3 = await ingestWhatsAppWebhook(cloud({ id: `v3-${marker}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'audio',
        audio: { id: 'meta-media-id', mime_type: 'audio/ogg; codecs=opus', voice: true, url: 'https://filemanager.gupshup.io/wa/voice.ogg' } }));
      const v3Message = await db.whatsAppMessage.findUniqueOrThrow({ where: { id: v3.mediaMessageIds[0] } });
      assert.equal(v3Message.mediaUrl, 'https://filemanager.gupshup.io/wa/voice.ogg');
      assert.equal(inboundMediaRef(v3Message)?.mediaId, 'meta-media-id');

      // Meta Cloud API only sends an id: the file is fetched with the connected account's token.
      const cloudMessage = await db.whatsAppMessage.create({ data: { customerId: voice.customerId, source: 'cloud_api', direction: 'INBOUND', messageType: 'IMAGE', content: '[图片]', status: 'RECEIVED', sentAt: new Date(),
        raw: JSON.stringify({ id: 'wamid', type: 'image', image: { id: '1234567890', mime_type: 'image/jpeg' } }) } });
      await assert.rejects(archiveInboundMedia(cloudMessage.id), (e: { status?: number }) => e.status === 404, 'no connected Cloud API account');
      assert.ok(!requests.some(url => url.startsWith('https://graph.facebook.com/')));

      // Opening someone else's customer's file is refused before anything is fetched.
      const outsider = await db.user.create({ data: { name: 'Media outsider', email: `media-${marker}@example.com`, role: 'SALES', passwordHash: hashPassword('x') } });
      try { await assert.rejects(messageMediaAsset(voice.id, actorOf(outsider)), (e: { status?: number }) => e.status === 404); }
      finally { await db.user.delete({ where: { id: outsider.id } }); }
    } finally {
      await deleteTestCustomers({ where: { whatsappNormalized: phone.slice(1) } });
      await rm(storage, { recursive: true, force: true });
    }
  });
});

test('message center: own conversations, unread until opened or answered, awaiting reply, notifications', async () => {
  const marker = `Inbox${randomUUID().slice(0, 6)}`;
  const [admin, sales, other] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }),
    db.user.create({ data: { name: `${marker} Seller`, email: `${marker}-a@example.com`, role: 'SALES', passwordHash: hashPassword('x') } }),
    db.user.create({ data: { name: `${marker} Other`, email: `${marker}-b@example.com`, role: 'SALES', passwordHash: hashPassword('x') } }),
  ]);
  const me = actorOf(sales), adminActor = actorOf(admin);
  const minutes = (n: number) => new Date(Date.now() - n * 60000);
  const customer = (name: string, ownerId: string) => db.customer.create({ data: { name: `${marker} ${name}`, ownerId, country: '法国', countryCode: 'FR' } });
  const message = (customerId: string, direction: string, sentAt: Date, source = 'gupshup', content = 'hello') =>
    db.whatsAppMessage.create({ data: { customerId, direction, sentAt, source, content, status: direction === 'INBOUND' ? 'RECEIVED' : 'READ', raw: '{}' } });
  try {
    const [waiting, answered, archive, foreign] = await Promise.all([customer('Waiting', sales.id), customer('Answered', sales.id), customer('Archive', sales.id), customer('Foreign', other.id)]);
    await message(waiting.id, 'OUTBOUND', minutes(30));
    await message(waiting.id, 'INBOUND', minutes(10), 'gupshup', 'Price for 2x40HQ?');
    await message(waiting.id, 'INBOUND', minutes(5), 'gupshup', '[IMAGE]').then(m => db.whatsAppMessage.update({ where: { id: m.id }, data: { messageType: 'IMAGE' } }));
    await message(answered.id, 'INBOUND', minutes(20));
    await message(answered.id, 'OUTBOUND', minutes(15));
    await message(archive.id, 'INBOUND', minutes(3), 'whatsapp_web');
    await message(foreign.id, 'INBOUND', minutes(1));

    const all = await inboxConversations(me, { q: marker });
    assert.deepEqual(all.conversations.map(c => c.name), [`${marker} Archive`, `${marker} Waiting`, `${marker} Answered`], 'newest first, own customers only');
    const byName = Object.fromEntries(all.conversations.map(c => [c.name.split(' ')[1], c]));
    assert.equal(byName.Waiting.unread, 2); assert.equal(byName.Waiting.awaiting, true); assert.equal(byName.Waiting.lastMessage?.preview, '[图片]');
    assert.equal(byName.Answered.unread, 0, 'a reply after the message counts as read'); assert.equal(byName.Answered.awaiting, false);
    assert.equal(byName.Archive.unread, 0, 'local-sync history is an archive, never unread');
    assert.deepEqual((await inboxConversations(me, { q: marker, filter: 'unread' })).conversations.map(c => c.name), [`${marker} Waiting`]);
    assert.deepEqual((await inboxConversations(me, { q: marker, filter: 'awaiting' })).conversations.map(c => c.name), [`${marker} Archive`, `${marker} Waiting`]);
    assert.equal((await inboxConversations(me, { q: marker, ownerId: other.id })).conversations.length, 3, 'salespeople cannot widen their scope');
    assert.equal(await unreadConversationCount(me), 1);

    // Administrators see everyone (or one salesperson); their own reading does not clear the owner's unread.
    assert.equal((await inboxConversations(adminActor, { q: marker })).conversations.length, 4);
    assert.deepEqual((await inboxConversations(adminActor, { q: marker, ownerId: other.id })).conversations.map(c => c.name), [`${marker} Foreign`]);
    const feed = await notificationFeed(me);
    const notice = feed.items.find(item => item.kind === 'NEW_MESSAGE' && item.href.includes(waiting.id));
    assert.ok(notice); assert.equal(notice.body, '[图片]', 'one notice per conversation with its newest message');
    assert.equal(feed.items.filter(item => item.kind === 'NEW_MESSAGE' && item.href.includes(foreign.id)).length, 0);
    assert.equal(feed.counts.unreadConversations, 1);

    await db.whatsAppReadState.create({ data: { customerId: waiting.id, userId: sales.id, readAt: new Date() } });
    assert.equal((await inboxConversations(me, { q: marker })).conversations.find(c => c.id === waiting.id)?.unread, 0);
    assert.equal(await unreadConversationCount(me), 0);
    assert.equal((await notificationFeed(me)).items.filter(item => item.kind === 'NEW_MESSAGE' && item.href.includes(marker)).length, 0);

    // The thread exposes stored files through our own links and never the raw provider payload.
    const thread = await inboxThread(me, { customerId: waiting.id });
    assert.equal(thread.messages.length, 3);
    assert.equal(thread.messages.at(-1)?.mediaHref, `/api/whatsapp/messages/${thread.messages.at(-1)?.id}/media`);
    assert.ok(!('raw' in thread.messages[0]));
    assert.equal(thread.customer.owner.id, sales.id);
    await assert.rejects(inboxThread(me, { customerId: foreign.id }), (e: { status?: number }) => e.status === 404);
    await assert.rejects(sendWhatsAppMessage({ customerId: foreign.id, content: 'hi', requestId: randomUUID() }, me), (e: { status?: number }) => e.status === 404);
    await assert.rejects(inboxConversations(me, { filter: 'unmatched' }), (e: { status?: number }) => e.status === 403);
    await assert.rejects(linkCandidates(me, { key: '+33600000000' }), (e: { status?: number }) => e.status === 403);
  } finally {
    await deleteTestCustomers({ where: { name: { startsWith: marker } } });
    await db.user.deleteMany({ where: { id: { in: [sales.id, other.id] } } });
  }
});

test('administrators link a shared number; every pending message moves to the chosen customer', async () => {
  const marker = randomUUID().slice(0, 8), phone = `+4479${String(Date.now()).slice(-8)}`;
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }), actor = actorOf(admin);
  const [first, second] = await Promise.all(['A', 'B'].map(s => db.customer.create({ data: { name: `Shared ${marker} ${s}`, ownerId: admin.id, phone, whatsapp: phone, phoneE164: phone, whatsappNormalized: phone.slice(1) } })));
  try {
    await withEnv({ GUPSHUP_SOURCE_NUMBER: business, GUPSHUP_APP_NAME: 'INBOX_TEST', GUPSHUP_API_KEY: 'inbox-key' }, async () => {
      for (const n of [1, 2]) await ingestWhatsAppWebhook(v2(`shared-${marker}-${n}`, phone, 'text', { text: `Shared number message ${n}` }));
    });
    const pending = await inboxConversations(actor, { filter: 'unmatched' });
    const number = pending.numbers.find(n => n.peerPhone === phone);
    assert.equal(number?.count, 2); assert.equal(number?.reason, 'AMBIGUOUS');
    const candidates = (await linkCandidates(actor, { key: phone })).candidates;
    assert.deepEqual(new Set(candidates.filter(c => c.samePhone).map(c => c.id)), new Set([first.id, second.id]));
    assert.equal((await linkUnmatchedNumber(actor, { key: phone, customerId: second.id })).linked, 2);
    assert.equal(await db.whatsAppMessage.count({ where: { customerId: second.id } }), 2);
    assert.equal(await db.whatsAppUnmatchedMessage.count({ where: { peerPhone: phone, status: 'PENDING' } }), 0);
    await assert.rejects(linkUnmatchedNumber(actor, { key: phone, customerId: second.id }), (e: { status?: number }) => e.status === 404);
  } finally {
    await db.whatsAppUnmatchedMessage.deleteMany({ where: { peerPhone: phone } });
    await deleteTestCustomers({ where: { id: { in: [first.id, second.id] } } });
  }
});

test('templates: approved list read from Gupshup, variables required, sent by a person and recorded', async t => {
  const marker = randomUUID().slice(0, 8), phone = `+3368${String(Date.now()).slice(-7)}`;
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }), actor = actorOf(admin);
  await withEnv({ GUPSHUP_SOURCE_NUMBER: business, GUPSHUP_APP_NAME: 'INBOX_TEST', GUPSHUP_API_KEY: 'inbox-key', GUPSHUP_APP_ID: '' }, async () => {
    await ingestWhatsAppWebhook(v2(`tpl-${marker}`, phone, 'text', { text: 'Hello' }, Date.now() - 3 * 86400000));
    const customer = await db.customer.findFirstOrThrow({ where: { whatsappNormalized: phone.slice(1) } });
    try {
      delete process.env.GUPSHUP_APP_ID;
      assert.deepEqual(await listTemplates(actor, { customerId: customer.id }), { status: 'NOT_CONNECTED', templates: [], suggestion: null });
      process.env.GUPSHUP_APP_ID = `app-${marker}`;
      const sent: URLSearchParams[] = [];
      t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === `https://api.gupshup.io/wa/app/app-${marker}/template`) return Response.json({ status: 'success', templates: [
          { id: 'tpl-ok', elementName: 'follow_up_general', languageCode: 'en', category: 'MARKETING', status: 'APPROVED', templateType: 'TEXT', data: 'Hi {{1}}, this is {{2}} from LVANJU.' },
          { id: 'tpl-pending', elementName: 'pending', status: 'PENDING', templateType: 'TEXT', data: 'Pending' },
          { id: 'tpl-image', elementName: 'image', status: 'APPROVED', templateType: 'IMAGE', data: 'Photo' }] });
        if (url === 'https://api.gupshup.io/wa/api/v1/template/msg') { sent.push(new URLSearchParams(String(init?.body))); return Response.json({ status: 'submitted', messageId: `gs-${marker}` }); }
        return new Response('unexpected', { status: 500 });
      });
      const list = await listTemplates(actor, { customerId: customer.id, refresh: '1' });
      assert.deepEqual(list.templates.map(item => [item.id, item.variables]), [['tpl-ok', 2]]);
      await assert.rejects(sendTemplateMessage({ customerId: customer.id, templateId: 'tpl-ok', params: ['Yuki'], requestId: randomUUID() }, actor), (e: { status?: number }) => e.status === 400);
      await assert.rejects(sendTemplateMessage({ customerId: customer.id, templateId: 'tpl-pending', params: [], requestId: randomUUID() }, actor), (e: { status?: number }) => e.status === 404);
      const requestId = randomUUID();
      const result = await sendTemplateMessage({ customerId: customer.id, templateId: 'tpl-ok', params: ['Yuki', 'Lin'], requestId }, actor);
      assert.equal(result.message.messageType, 'TEMPLATE'); assert.equal(result.message.status, 'ENQUEUED');
      assert.equal(result.message.content, 'Hi Yuki, this is Lin from LVANJU.');
      assert.equal(sent.length, 1); assert.deepEqual(JSON.parse(sent[0].get('template')!), { id: 'tpl-ok', params: ['Yuki', 'Lin'] });
      assert.equal(sent[0].get('destination'), phone.slice(1)); assert.equal(sent[0].get('src.name'), 'INBOX_TEST');
      assert.equal((await sendTemplateMessage({ customerId: customer.id, templateId: 'tpl-ok', params: ['Yuki', 'Lin'], requestId }, actor)).message.id, result.message.id, 'retry is idempotent');
      assert.equal(sent.length, 1);
      // Free text stays blocked outside the 24-hour window.
      await assert.rejects(sendWhatsAppMessage({ customerId: customer.id, content: 'hi', requestId: randomUUID() }, actor), (e: { status?: number }) => e.status === 409);
      await db.customer.update({ where: { id: customer.id }, data: { whatsappOptInStatus: 'OPTED_OUT' } });
      await assert.rejects(sendTemplateMessage({ customerId: customer.id, templateId: 'tpl-ok', params: ['A', 'B'], requestId: randomUUID() }, actor), (e: { status?: number }) => e.status === 409);
    } finally {
      await deleteTestCustomers({ where: { id: customer.id } });
    }
  });
});

test('inbound numbers: "+" optional, deleted customers ignored, waiting messages re-matched into new customers', async () => {
  const digits = () => `86158${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const typed = digits(), retired = digits(), waiting = digits();
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }), actor = actorOf(admin);
  const ids: string[] = [];
  const phones = [typed, retired, waiting];
  try {
    await withEnv({ GUPSHUP_SOURCE_NUMBER: business, GUPSHUP_APP_NAME: 'INBOX_TEST', GUPSHUP_API_KEY: 'inbox-key' }, async () => {
      // Typed without "+" and with spaces in the phone field only: the same number, so no duplicate customer.
      const existing = await db.customer.create({ data: { name: 'Typed without plus', ownerId: admin.id, phone: `${typed.slice(0, 2)} ${typed.slice(2, 5)} ${typed.slice(5)}`, contactKeysAt: new Date() } });
      ids.push(existing.id);
      const first = await ingestWhatsAppWebhook(v2(`typed-${typed}`, typed, 'text', { text: 'Hello, same number' }));
      assert.equal(first.createdCustomers, 0); assert.equal(first.matchedCustomers, 1);
      assert.equal((await db.whatsAppMessage.findUniqueOrThrow({ where: { waMessageId: `typed-${typed}` } })).customerId, existing.id);

      // A number whose only customer is in the recycle bin is a new customer, not a conflict.
      const gone = await db.customer.create({ data: { name: 'Deleted earlier', ownerId: admin.id, whatsapp: `+${retired}`, whatsappNormalized: retired, phoneE164: `+${retired}`, contactKeysAt: new Date(), deletedAt: new Date() } });
      ids.push(gone.id);
      const second = await ingestWhatsAppWebhook(v2(`retired-${retired}`, retired, 'text', { text: 'Hi again' }));
      assert.equal(second.createdCustomers, 1);
      const fresh = await db.whatsAppMessage.findUniqueOrThrow({ where: { waMessageId: `retired-${retired}` } });
      assert.notEqual(fresh.customerId, gone.id);
      assert.equal((await db.customer.findUniqueOrThrow({ where: { id: fresh.customerId } })).deletedAt, null);
      assert.equal(await recipientNumber(await db.customer.findUniqueOrThrow({ where: { id: fresh.customerId } }), 'gupshup', business), retired, 'replies are not blocked by the deleted record');

      // Messages that waited under the old rule are re-matched on request and open the 24-hour window.
      const old = await db.customer.create({ data: { name: 'Deleted too', ownerId: admin.id, whatsapp: `+${waiting}`, whatsappNormalized: waiting, phoneE164: `+${waiting}`, contactKeysAt: new Date(), deletedAt: new Date() } });
      ids.push(old.id);
      const sentAt = new Date(Date.now() - 60_000);
      await db.whatsAppUnmatchedMessage.create({ data: { sourceKey: identityKey('retry-test', waiting), provider: 'gupshup', providerAccountId: business, userId: admin.id, accountPhone: 'primary',
        conversationId: waiting, sourceMessageId: `waiting-${waiting}`, peerPhone: `+${waiting}`, peerName: 'Waiting buyer', direction: 'inbound', sentAt, content: 'Price please',
        attachments: JSON.stringify({ messageType: 'TEXT', raw: { id: `waiting-${waiting}`, type: 'text', payload: { text: 'Price please' } } }), reason: 'AMBIGUOUS' } });
      const retry = await retryUnmatchedNumbers(actor, {});
      assert.ok(retry.createdCustomers >= 1); assert.ok(retry.imported >= 1);
      const moved = await db.whatsAppMessage.findFirstOrThrow({ where: { sourceMessageId: `waiting-${waiting}` }, include: { customer: true, conversation: true } });
      assert.equal(moved.customer.name, 'Waiting buyer'); assert.equal(moved.customer.deletedAt, null);
      assert.equal(moved.conversation?.lastCustomerMessageAt?.getTime(), sentAt.getTime());
      assert.equal(await db.whatsAppUnmatchedMessage.count({ where: { peerPhone: `+${waiting}`, status: 'PENDING' } }), 0);
      await assert.rejects(retryUnmatchedNumbers({ ...actor, role: 'SALES' }, {}), (e: { status?: number }) => e.status === 403);
    });
  } finally {
    await db.whatsAppUnmatchedMessage.deleteMany({ where: { peerPhone: { in: phones.map(p => `+${p}`) } } });
    await deleteTestCustomers({ where: { OR: [{ id: { in: ids } }, { whatsappNormalized: { in: phones } }] } });
  }
});
