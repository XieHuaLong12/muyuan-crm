import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../lib/db';
import { resolveWhatsAppCustomer } from '../services/whatsapp-identity-service';

test('WhatsApp身份识别：号码匹配后绑定 waId', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const customer = await db.customer.create({
    data: {
      name: 'WA Identity Single',
      ownerId: admin.id,
      whatsapp: '+966 50 700 1001',
      whatsappNormalized: '966507001001',
    },
  });

  try {
    const result = await resolveWhatsAppCustomer({
      phone: '+966 50 700 1001',
      waId: '966507001001',
    });

    assert.deepEqual(result, {
      status: 'MATCHED',
      customerId: customer.id,
      matchedBy: 'NUMBER',
    });

    const updated = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(updated.waId, '966507001001');

    const second = await resolveWhatsAppCustomer({ waId: '966507001001' });
    assert.equal(second.status, 'MATCHED');
    if (second.status === 'MATCHED') assert.equal(second.matchedBy, 'WA_ID');
  } finally {
    await db.customer.delete({ where: { id: customer.id } });
    await db.$disconnect();
  }
});

test('WhatsApp身份识别：重复号码返回冲突而不是随便绑定', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const created = await Promise.all(
    ['A', 'B'].map((suffix) =>
      db.customer.create({
        data: {
          name: `WA Identity Duplicate ${suffix}`,
          ownerId: admin.id,
          whatsapp: '+971 50 700 2002',
          whatsappNormalized: '971507002002',
        },
      })
    )
  );

  try {
    const result = await resolveWhatsAppCustomer({ phone: '+971 50 700 2002' });
    assert.equal(result.status, 'AMBIGUOUS');
    if (result.status === 'AMBIGUOUS') {
      assert.equal(result.customerIds.length, 2);
      assert.deepEqual(new Set(result.customerIds), new Set(created.map((c) => c.id)));
    }
  } finally {
    await db.customer.deleteMany({ where: { id: { in: created.map((c) => c.id) } } });
    await db.$disconnect();
  }
});
