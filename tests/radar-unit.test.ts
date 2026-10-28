import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RADAR_CONFIG, addressesToCheck, cleanEmail, contactabilityScore, emailKind, gradeOf, isFreeMail, mailability, nameCityKey,
  normalizeDomain, rankEmails, readRadarConfig, scoreTotal, clampParts, timezoneFor, verifiedFacts,
} from '../lib/radar';

test('radar: domains are the company\'s own site, without www, never a social page or a directory', () => {
  assert.equal(normalizeDomain('https://www.Meubles-Dupont.fr/contact?x=1'), 'meubles-dupont.fr');
  assert.equal(normalizeDomain('meubles-dupont.fr'), 'meubles-dupont.fr');
  assert.equal(normalizeDomain('http://www2.shop.example.com.au/'), 'shop.example.com.au');
  assert.equal(normalizeDomain('https://www.facebook.com/meublesdupont'), '');
  assert.equal(normalizeDomain('https://m.facebook.com/meublesdupont'), '');
  assert.equal(normalizeDomain('https://www.pagesjaunes.fr/pros/123'), '');
  assert.equal(normalizeDomain('not a url'), '');
  assert.equal(normalizeDomain(''), '');
  assert.equal(isFreeMail('gmail.com'), true);
  assert.equal(isFreeMail('orange.fr'), true);
  assert.equal(isFreeMail('hotmail.fr'), true);
  assert.equal(isFreeMail('outlook.com.au'), true);
  assert.equal(isFreeMail('meubles-dupont.fr'), false);
});

test('radar: addresses found on a site are cleaned, junk dropped, and sorted direct before shared', () => {
  assert.equal(cleanEmail('mailto:Achat@Meubles-Dupont.fr?subject=Bonjour'), 'achat@meubles-dupont.fr');
  assert.equal(cleanEmail(' <contact@shop.fr>. '), 'contact@shop.fr');
  assert.equal(cleanEmail('contact%40shop.fr'), 'contact@shop.fr');
  assert.equal(cleanEmail('logo@2x.png'), null, 'retina image names are not addresses');
  assert.equal(cleanEmail('abc123@sentry.io'), null);
  assert.equal(cleanEmail('noreply@shop.fr'), null, 'nobody reads a no-reply inbox');
  assert.equal(cleanEmail('rgpd@shop.fr'), null);
  assert.equal(cleanEmail('jobs@shop.fr'), null);
  assert.equal(cleanEmail('not-an-email'), null);
  assert.equal(emailKind('achat@shop.fr'), 'DIRECT');
  assert.equal(emailKind('purchasing@shop.com.au'), 'DIRECT');
  assert.equal(emailKind('jean.dupont@shop.fr'), 'DIRECT', 'first.last is a person');
  assert.equal(emailKind('service-client@shop.fr'), 'GENERIC', 'a hyphenated shared inbox is still shared');
  assert.equal(emailKind('contact@shop.fr'), 'GENERIC');
  assert.equal(emailKind('info@shop.ae'), 'GENERIC');
  const ranked = rankEmails([
    { address: 'info@gmail.com', kind: 'GENERIC', verifyStatus: 'VALID' },
    { address: 'contact@shop.fr', kind: 'GENERIC', verifyStatus: 'VALID' },
    { address: 'achat@shop.fr', kind: 'DIRECT', verifyStatus: 'VALID' },
    { address: 'boss@shop.fr', kind: 'DIRECT', verifyStatus: 'INVALID' },
    { address: 'old@shop.fr', kind: 'DIRECT', verifyStatus: 'VALID', bouncedAt: new Date() },
    { address: 'maybe@shop.fr', kind: 'DIRECT', verifyStatus: 'RISKY' },
  ], 'shop.fr');
  assert.deepEqual(ranked.map(e => e.address), ['achat@shop.fr', 'contact@shop.fr', 'info@gmail.com', 'maybe@shop.fr', 'boss@shop.fr', 'old@shop.fr']);
});

test('radar: at most two different addresses per prospect are checked; a failed check is retried', () => {
  const e = (address: string, kind: string, verifyStatus = '', verifyAttempts = 0) => ({ address, kind, verifyStatus, verifyAttempts });
  const fresh = [e('contact@shop.fr', 'GENERIC'), e('achat@shop.fr', 'DIRECT'), e('info@shop.fr', 'GENERIC')];
  assert.deepEqual(addressesToCheck(fresh, 'shop.fr').map(x => x.address), ['achat@shop.fr', 'contact@shop.fr']);
  assert.equal(mailability(fresh), 'PENDING');
  const oneInvalid = [e('achat@shop.fr', 'DIRECT', 'INVALID', 1), e('contact@shop.fr', 'GENERIC'), e('info@shop.fr', 'GENERIC')];
  assert.deepEqual(addressesToCheck(oneInvalid, 'shop.fr').map(x => x.address), ['contact@shop.fr'], 'one slot left');
  const twoInvalid = [e('achat@shop.fr', 'DIRECT', 'INVALID', 1), e('contact@shop.fr', 'GENERIC', 'INVALID', 1), e('info@shop.fr', 'GENERIC')];
  assert.deepEqual(addressesToCheck(twoInvalid), [], 'both slots used: the third address is never paid for');
  assert.equal(mailability(twoInvalid), 'NONE');
  const unknown = [e('achat@shop.fr', 'DIRECT', 'UNKNOWN', 1), e('contact@shop.fr', 'GENERIC', 'INVALID', 1), e('info@shop.fr', 'GENERIC')];
  assert.deepEqual(addressesToCheck(unknown).map(x => x.address), ['achat@shop.fr'], 'a failed check is retried in its own slot');
  assert.deepEqual(addressesToCheck([e('achat@shop.fr', 'DIRECT', 'UNKNOWN', 3)]), [], 'three failed checks: give up');
  assert.equal(mailability([e('contact@shop.fr', 'GENERIC', 'RISKY', 1)]), 'HAS');
  assert.equal(mailability([]), 'NONE');
});

test('radar: score parts are clamped, contactability follows the best address, grades at 70 and 50', () => {
  assert.equal(scoreTotal({ type: 40, category: 20, scale: 15, contactability: 15, intent: 10 }), 100);
  assert.equal(scoreTotal({ type: 99, category: -3, scale: 7.6, contactability: 15, intent: Number.NaN }), 40 + 0 + 8 + 15 + 0);
  assert.deepEqual(clampParts({ type: 50, intent: 4 }), { type: 40, category: 0, scale: 0, contactability: 0, intent: 4 });
  assert.equal(gradeOf(70), 'A'); assert.equal(gradeOf(69), 'B'); assert.equal(gradeOf(50), 'B'); assert.equal(gradeOf(49), 'C');
  const e = (kind: string, verifyStatus: string) => ({ address: `${kind}@shop.fr`, kind, verifyStatus });
  assert.equal(contactabilityScore([e('DIRECT', 'VALID')], {}), 15);
  assert.equal(contactabilityScore([e('GENERIC', 'VALID')], {}), 12);
  assert.equal(contactabilityScore([e('DIRECT', '')], {}), 13, 'not yet checked counts a little less');
  assert.equal(contactabilityScore([e('GENERIC', 'RISKY')], {}), 6);
  assert.equal(contactabilityScore([e('DIRECT', 'INVALID')], { whatsapp: '+33600000000' }), 6, 'an invalid address is no address');
  assert.equal(contactabilityScore([], { phone: '0102030405' }), 5);
  assert.equal(contactabilityScore([], {}), 0);
});

test('radar: names collapse with their legal form and accents; time zones follow the city', () => {
  assert.equal(nameCityKey('Meubles Dupont S.A.R.L.', 'Lyon'), nameCityKey('MEUBLES DUPONT', 'lyon'));
  assert.equal(nameCityKey('Gulf Home Furniture L.L.C', 'Dubai'), nameCityKey('Gulf Home Furniture', 'Dubai'));
  assert.equal(nameCityKey('Literie Élégance', 'Saint-Étienne'), 'literie elegance|saint etienne');
  assert.notEqual(nameCityKey('Meubles Dupont', 'Lyon'), nameCityKey('Meubles Dupont', 'Paris'));
  assert.equal(nameCityKey('SARL', 'Paris'), '|paris', 'a name made only of a legal form is empty');
  assert.equal(timezoneFor('AU', 'Perth', DEFAULT_RADAR_CONFIG), 'Australia/Perth');
  assert.equal(timezoneFor('AU', 'perth', DEFAULT_RADAR_CONFIG), 'Australia/Perth');
  assert.equal(timezoneFor('AU', 'Melbourne', DEFAULT_RADAR_CONFIG), 'Australia/Sydney');
  assert.equal(timezoneFor('SA', 'Riyadh', DEFAULT_RADAR_CONFIG), 'Asia/Riyadh');
  assert.equal(timezoneFor('ZZ', 'x', DEFAULT_RADAR_CONFIG), 'UTC');
  assert.deepEqual(DEFAULT_RADAR_CONFIG.countries.SA.workdays, [0, 1, 2, 3, 4], 'Saudi weekend is Friday and Saturday');
});

test('radar: a fact reaches the opening line only when its quote is really on the site', () => {
  const site = 'Bienvenue chez Meubles Dupont.  Nos 3 magasins à Lyon proposent canapés et literie depuis 1985.';
  const facts = verifiedFacts([
    { fact: '里昂有 3 家门店', quote: 'Nos 3 magasins à  Lyon' },
    { fact: '有 20 家门店', quote: 'Nos 20 magasins' },
    { fact: '太短', quote: 'Lyon' },
    { fact: '1985 年成立', quote: 'depuis 1985' },
    { fact: '第三条', quote: 'canapés et literie' },
  ], site);
  assert.deepEqual(facts.map(f => f.fact), ['里昂有 3 家门店', '1985 年成立'], 'made-up and too-short quotes are dropped; two at most');
  assert.deepEqual(verifiedFacts([{ fact: 'x', quote: 'anything at all' }], null), []);
});

test('radar: stored settings fall back to the defaults when they no longer validate', () => {
  assert.equal(readRadarConfig(null).searchesPerDay, 20);
  assert.equal(readRadarConfig({ searchesPerDay: 35 }).searchesPerDay, 35);
  assert.deepEqual(readRadarConfig({ searchesPerDay: -1 }), DEFAULT_RADAR_CONFIG);
  assert.deepEqual(readRadarConfig({ intervalMin: 20, intervalMax: 10 }), DEFAULT_RADAR_CONFIG);
  const custom = readRadarConfig({ countries: { FR: { ...DEFAULT_RADAR_CONFIG.countries.FR, holidays: ['2026-11-11'] } } });
  assert.deepEqual(Object.keys(custom.countries), ['FR'], 'a saved country list replaces the defaults');
  assert.deepEqual(readRadarConfig({ countries: { FR: { ...DEFAULT_RADAR_CONFIG.countries.FR, timezone: 'Mars/Olympus' } } }), DEFAULT_RADAR_CONFIG);
});
