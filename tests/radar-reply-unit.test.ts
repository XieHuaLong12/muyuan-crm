import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, readGmailMessage, returnDateFrom, screenMessage, stripQuoted, threadLink } from '../lib/radar-reply';
import { gmailMessage } from './radar-test-helpers';

test('radar replies: a Gmail message as text, HTML when there is no plain part, headers read', () => {
  const mail = readGmailMessage(gmailMessage({ id: 'r1', threadId: 't1', from: '"Marie Dupont" <Marie@Shop.fr>', subject: 'Re: Canapés', text: 'Bonjour,\r\nEnvoyez le catalogue.',
    headers: { 'In-Reply-To': '<m1@mail.gmail.com>', References: '<m0@mail.gmail.com> <m1@mail.gmail.com>' } }));
  assert.deepEqual([mail.from, mail.fromName, mail.subject, mail.inReplyTo, mail.references], ['marie@shop.fr', 'Marie Dupont', 'Re: Canapés', '<m1@mail.gmail.com>', ['<m0@mail.gmail.com>', '<m1@mail.gmail.com>']]);
  assert.equal(mail.text, 'Bonjour,\nEnvoyez le catalogue.');
  assert.equal(mail.date?.toISOString(), '2026-10-28T09:00:00.000Z');
  const html = readGmailMessage(gmailMessage({ id: 'r2', threadId: 't2', from: 'a@b.fr', subject: 'x', html: '<div>Bonjour&nbsp;Jason,</div><p>Prix&nbsp;pour 50 pièces&nbsp;?</p><style>p{}</style>' }));
  assert.equal(html.text, 'Bonjour Jason,\nPrix pour 50 pièces ?');
  assert.equal(htmlToText('a<br>b &amp; c &#233;'), 'a\nb & c é');
});

test('radar replies: the quoted original is cut (Gmail English and French, Outlook, ">" lines)', () => {
  assert.equal(stripQuoted('Yes please send prices.\n\nOn Wed, 28 Oct 2026 at 10:00, Jason <jason@lvanju-mail.com> wrote:\n> Hello,\n> Do you sell sofas?'), 'Yes please send prices.');
  assert.equal(stripQuoted('Oui, envoyez le catalogue.\n\nLe mer. 28 oct. 2026 à 10:00, Jason <jason@lvanju-mail.com> a\nécrit :\n> Bonjour'), 'Oui, envoyez le catalogue.');
  assert.equal(stripQuoted('Merci, pas pour le moment.\n\nDe : Jason <jason@lvanju-mail.com>\nEnvoyé : mercredi 28 octobre 2026 10:00\nÀ : contact@shop.fr\nObjet : Canapés'), 'Merci, pas pour le moment.');
  assert.equal(stripQuoted('Call me.\n-----Original Message-----\nFrom: x'), 'Call me.');
  assert.equal(stripQuoted('Ligne 1\n> citée\nLigne 2'), 'Ligne 1\nLigne 2');
  assert.equal(stripQuoted('Le prix ?\nMerci'), 'Le prix ?\nMerci', 'a line starting with "Le" alone is not an attribution');
});

test('radar replies: bounces and auto-replies are screened by rules', () => {
  const gmailBounce = readGmailMessage(gmailMessage({ id: 'b1', threadId: 't1', from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'Delivery Status Notification (Failure)',
    text: "Address not found\nYour message wasn't delivered to achat@shop.fr because the address couldn't be found.\nThe response was:\n550 5.1.1 The email account that you tried to reach does not exist.",
    headers: { 'X-Failed-Recipients': 'achat@shop.fr', 'Content-Type': 'multipart/report; report-type=delivery-status' },
    report: 'Final-Recipient: rfc822; achat@shop.fr\nAction: failed\nStatus: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 user unknown', original: 'From: jason@lvanju-mail.com\nMessage-ID: <m1@mail.gmail.com>\nSubject: Canapés' }));
  assert.deepEqual(screenMessage(gmailBounce), { screen: 'HARD_BOUNCE', recipient: 'achat@shop.fr', detail: 'smtp; 550 5.1.1 user unknown', originalMessageId: '<m1@mail.gmail.com>' });
  const delay = readGmailMessage(gmailMessage({ id: 'b2', threadId: 't1', from: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Delay)', text: 'Message temporarily rejected, will retry. 451 4.7.1 Try again later' }));
  assert.equal(screenMessage(delay).screen, 'SOFT_BOUNCE');
  const outlookNdr = readGmailMessage(gmailMessage({ id: 'b3', threadId: 't9', from: 'postmaster@outlook.com', subject: 'Undeliverable: Canapés', text: "Your message to x@shop.com couldn't be delivered. Remote Server returned '550 5.4.1 Recipient address rejected'" }));
  assert.equal(screenMessage(outlookNdr).screen, 'HARD_BOUNCE');
  const ooo = readGmailMessage(gmailMessage({ id: 'a1', threadId: 't1', from: 'achat@shop.fr', subject: 'Réponse automatique : Canapés', text: "Je suis absent jusqu'au 4 novembre." }));
  assert.equal(screenMessage(ooo).screen, 'AUTO_REPLY');
  const header = readGmailMessage(gmailMessage({ id: 'a2', threadId: 't1', from: 'info@shop.ae', subject: 'Re: Sofas', text: 'Thank you for your email.', headers: { 'Auto-Submitted': 'auto-replied' } }));
  assert.equal(screenMessage(header).screen, 'AUTO_REPLY');
  const human = readGmailMessage(gmailMessage({ id: 'h1', threadId: 't1', from: 'achat@shop.fr', subject: 'Re: Canapés', text: 'Quel est votre prix pour 50 canapés ?', headers: { 'Auto-Submitted': 'no' } }));
  assert.equal(screenMessage(human).screen, 'NONE');
  assert.equal(screenMessage(readGmailMessage(gmailMessage({ id: 'h2', threadId: 't1', from: 'a@b.fr', subject: 'Re: Absence de catalogue ?', text: 'x' }))).screen, 'NONE', '"Absence" inside a subject is not an out-of-office prefix');
});

test('radar replies: the return date of an out-of-office message', () => {
  const received = new Date('2026-10-28T09:00:00Z');
  assert.equal(returnDateFrom("Je suis absent jusqu'au 4 novembre inclus.", received)?.toISOString().slice(0, 10), '2026-11-04');
  assert.equal(returnDateFrom('Absent du 28/10 au 03/11/2026, retour le 04/11.', received)?.toISOString().slice(0, 10), '2026-11-04', 'the latest date: back on');
  assert.equal(returnDateFrom("I'm out of the office until November 9th and will reply on my return.", received)?.toISOString().slice(0, 10), '2026-11-09');
  assert.equal(returnDateFrom('Back on 2026-11-12.', received)?.toISOString().slice(0, 10), '2026-11-12');
  assert.equal(returnDateFrom('Je serai de retour le 5 janvier.', received)?.toISOString().slice(0, 10), '2027-01-05', 'a month already past means next year');
  assert.equal(returnDateFrom('Merci pour votre message.', received), null);
  assert.equal(returnDateFrom('Retour le 15 juillet 2027.', received), null, 'more than 90 days ahead is not a holiday return');
  assert.equal(threadLink('jason@lvanju-mail.com', '18c2f'), 'https://mail.google.com/mail/u/jason%40lvanju-mail.com/#all/18c2f');
});
