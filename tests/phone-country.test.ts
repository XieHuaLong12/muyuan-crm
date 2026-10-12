import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import type { Actor } from '../lib/auth';
import { contactNumber, phoneCountry, withPhoneCountry } from '../lib/phone-country';
import { saveCustomer } from '../services/customer-service';
import { fillMissingCountries } from '../services/customer-country-service';
import { customerList } from '../services/customer-list-service';
import { deleteTestCustomers } from './identity-test-cleanup';

test('the country comes from the WhatsApp calling code', () => {
  const country = (whatsapp: string) => phoneCountry({ whatsapp })?.name ?? null;
  assert.equal(country('+8613800138000'), '中国');
  assert.equal(country('8613800138000'), '中国', 'WhatsApp numbers are international even without the plus sign');
  assert.equal(country('0086 138 0013 8000'), '中国');
  assert.equal(country('+33 6 12 34 56 78'), '法国');
  assert.equal(country('+12125551234'), '美国', '+1 is split by area code');
  assert.equal(country('+14165551234'), '加拿大');
  assert.equal(country('+77012345678'), '哈萨克斯坦', '+7 is split too');
  assert.equal(country('+79161234567'), '俄罗斯');
  assert.equal(country('+6281234567890'), '印尼', 'short everyday names');
  assert.equal(country('+966501234567'), '沙特');
  assert.equal(country('12'), null);
  assert.equal(country(''), null);
  // A national phone number says nothing about the country; an international one does.
  assert.equal(phoneCountry({ phone: '13800138000' }), null);
  assert.equal(phoneCountry({ phone: '+86 138 0013 8000' })?.code, 'CN');
  assert.equal(phoneCountry({ whatsapp: '+33612345678', phone: '+8613800138000' })?.code, 'FR', 'WhatsApp wins over the phone');
  // A country somebody entered is kept.
  assert.equal(withPhoneCountry({ country: '德国', whatsapp: '+8613800138000' }).country, '德国');
  assert.equal(withPhoneCountry({ country: ' ', whatsapp: '+8613800138000' }).country, '中国');
});

test('the WhatsApp column shows a readable number, copies the plain one and links to the chat', () => {
  assert.deepEqual(contactNumber({ whatsapp: '8613800138000', phone: '' }), { kind: 'WHATSAPP', display: '+86 138 0013 8000', copy: '+8613800138000', chat: 'https://wa.me/8613800138000' });
  assert.deepEqual(contactNumber({ whatsapp: '', phone: '+33 6 12 34 56 78' }), { kind: 'PHONE', display: '+33 6 12 34 56 78', copy: '+33612345678', chat: 'https://wa.me/33612345678' });
  assert.equal(contactNumber({ whatsapp: '', phone: '0612345678', countryCode: 'FR' })?.copy, '+33612345678', 'a national phone with a country code');
  assert.deepEqual(contactNumber({ whatsapp: '', phone: '0612 345' }), { kind: 'PHONE', display: '0612 345', copy: '0612 345', chat: null }, 'unrecognised numbers are shown as entered');
  assert.equal(contactNumber({ whatsapp: '', phone: '' }), null);
});

test('saving fills a blank country, older customers are filled in the background, the list carries the number', async () => {
  const row = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const admin: Actor = { id: row.id, name: row.name, email: row.email, role: row.role };
  const tag = randomUUID().slice(0, 8);
  const ids: string[] = [];
  try {
    const saved = await saveCustomer({ name: `Country save ${tag}`, ownerId: admin.id, whatsapp: '+8613800138000' }, admin);
    ids.push(saved.id);
    assert.equal(saved.country, '中国');
    assert.equal(saved.countryCode, '', 'only the visible country is filled; the country code keeps matching as entered');
    const kept = await saveCustomer({ name: `Country kept ${tag}`, ownerId: admin.id, whatsapp: '+8613900139000', country: '德国' }, admin);
    ids.push(kept.id);
    assert.equal(kept.country, '德国');

    // Customers saved before this release: blank country, recognisable and unrecognisable numbers.
    const old = await db.customer.create({ data: { name: `Country old ${tag}`, ownerId: admin.id, whatsapp: '971501234567', updatedAt: new Date('2025-01-01T00:00:00Z') } });
    const local = await db.customer.create({ data: { name: `Country local ${tag}`, ownerId: admin.id, phone: '0612345678' } });
    ids.push(old.id, local.id);
    const result = await fillMissingCountries({ id: { in: ids } });
    assert.equal(result.filled, 1);
    const filled = await db.customer.findUniqueOrThrow({ where: { id: old.id } });
    assert.equal(filled.country, '阿联酋');
    assert.equal(filled.updatedAt.toISOString(), '2025-01-01T00:00:00.000Z', 'filling the country is not an edit');
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: local.id } })).country, '');
    assert.equal((await fillMissingCountries({ id: { in: ids } })).filled, 0, 'nothing left to fill');

    const page = await customerList(admin, { q: `Country old ${tag}`, sort: 'whatsapp' });
    assert.equal(page.rows[0].country, '阿联酋');
    assert.equal(page.rows[0].contact?.display, '+971 50 123 4567');
    assert.equal(page.rows[0].contact?.chat, 'https://wa.me/971501234567');
  } finally {
    await deleteTestCustomers({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
