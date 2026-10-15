import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { buyerTypeOf, buysForThemselves, buysSoon, quantityOf } from '../lib/lead-answers';
import { formAnswers, ruleGrade, type GradeInput } from '../lib/lead-grade';
import { mapLeadFields, type LeadField } from '../lib/meta-lead-fields';
import { normalizeCustomerType } from '../services/meta-import-service';
import { gradeUngradedLeads } from '../services/lead-grade-service';
import { deleteTestCustomers } from './identity-test-cleanup';

// A mattress form as Meta returns it: field names as questions, choice keys as answers (contact details made up).
const mattressForm: [string, string][] = [
  ['full_name', 'Form Buyer'],
  ['what_type_of_business_are_you?', 'furniture_/_mattress_wholesaler_or_distributor'],
  ['how_many_pieces_for_your_first_order?', '50–200_pcs'],
  ['would_you_like_to_combine_mattresses_and_sofas_in_one_container?', 'yes,_mattresses_+_sofas'],
  ['which_mattress_type_are_you_interested_in?', 'memory_foam_/_high-density_foam'],
  ['when_do_you_plan_to_place_your_order?', 'within_1_month'],
  ['phone_number', '+966500000001'],
  ['what_matters_most_when_choosing_a_supplier?', 'best_price'],
  ['whatsapp_number', '+966500000001'],
];
const graph = (pairs: [string, string][]) => JSON.stringify({ id: 'lead-1', field_data: pairs.map(([name, value]) => ({ name, values: [value] })) });
const fields = (pairs: [string, string][]): LeadField[] => pairs.map(([name, value]) => ({ name, label: name, value }));
const base: Omit<GradeInput, 'answers'> = { purchaseType: 'OTHER', quantity: null, productInterest: '', country: '', hasPhone: true, hasEmail: false, testLead: false };
const grade = (pairs: [string, string][], extra: Partial<GradeInput> = {}) => ruleGrade({ ...base, answers: formAnswers(graph(pairs)), ...extra });

test('answers are read by what they mean, whatever the form calls them', () => {
  assert.equal(buyerTypeOf('furniture_/_mattress_wholesaler_or_distributor'), 'WHOLESALE');
  assert.equal(buyerTypeOf('Importer / wholesale'), 'IMPORTER', 'the type written first wins');
  assert.equal(buyerTypeOf('Grossiste'), 'WHOLESALE');
  assert.equal(buyerTypeOf('Mayorista de muebles'), 'WHOLESALE');
  assert.equal(buyerTypeOf('مستورد'), 'IMPORTER');
  assert.equal(buyerTypeOf('online_seller_/_e-commerce'), 'ECOMMERCE');
  assert.equal(buyerTypeOf('furniture_retailer'), 'RETAILER');
  assert.equal(buyerTypeOf('interior_designer_/_project_business'), 'PROJECT');
  assert.equal(buyerTypeOf('i_am_buying_for_personal_use'), '');
  assert.equal(buysForThemselves('i_am_buying_for_personal_use'), true);

  assert.deepEqual(quantityOf('50–200_pcs'), { min: 50, container: false, label: '50–200 件', exact: false });
  assert.deepEqual(quantityOf('200+_pcs'), { min: 200, container: false, label: '200 件以上', exact: false });
  assert.deepEqual(quantityOf('1,000 pieces'), { min: 1000, container: false, label: '1000 件', exact: true });
  assert.deepEqual(quantityOf('1x40HQ'), { min: null, container: true, label: '1 个货柜', exact: false });
  assert.equal(quantityOf('40HQ')?.label, '整柜');
  assert.equal(quantityOf('less_than_20'), null, 'too little to count');
  assert.equal(quantityOf('yes'), null);

  assert.equal(buysSoon('within_1_month'), true);
  assert.equal(buysSoon('immediately'), true);
  assert.equal(buysSoon('Dans le mois'), true);
  assert.equal(buysSoon('1-3_months'), null);
  assert.equal(buysSoon('3-6_months'), false);
  assert.equal(buysSoon('just_researching'), false);
  assert.equal(buysSoon('not_ready_yet'), false);

  // The smart import knows more than its fixed list of answer keys.
  assert.equal(normalizeCustomerType('furniture_/_mattress_wholesaler_or_distributor'), '批发商');
  assert.equal(normalizeCustomerType('grossiste'), '批发商');
  assert.equal(normalizeCustomerType('interior_designer_/_project_business'), '其他');
  assert.equal(normalizeCustomerType('something else'), '');
});

test('a form that words its questions differently still fills the profile and gets a fair grade', () => {
  const mapped = mapLeadFields(fields(mattressForm));
  assert.equal(mapped.purchaseType, 'WHOLESALE');
  assert.equal(mapped.quantity, null, 'a range is not written as one number');
  assert.equal(mapped.purchaseTimeline, 'within 1 month');
  assert.equal(mapped.productInterest, 'memory_foam_/_high-density_foam');
  assert.ok(mapped.notes.includes('how_many_pieces_for_your_first_order?：50–200_pcs'), 'the original answer stays in the notes');
  // "Which best describes your company?" is the buyer type, not the company name.
  const company = mapLeadFields(fields([['full_name', 'X'], ['which_best_describes_your_company?', 'Distributor'], ['company_name', 'Casa SA']]));
  assert.deepEqual([company.purchaseType, company.companyName], ['DISTRIBUTOR', 'Casa SA']);

  // Wholesaler, 50–200 pieces, ordering within a month: A, even before the profile was filled (purchase type OTHER).
  assert.deepEqual(grade(mattressForm, { country: '沙特' }), { grade: 'A', reason: '批发商；采购 50–200 件；1 个月内下单；沙特', source: 'RULE' });
  const researching = mattressForm.map(([q, a]): [string, string] => q.startsWith('when_') ? [q, 'just_researching'] : [q, a]);
  assert.equal(grade(researching).grade, 'B', 'a business buyer with volume, no plan yet');
  assert.deepEqual(grade([['what_type_of_business_are_you?', 'i_am_buying_for_personal_use'], ['how_many_pieces_for_your_first_order?', '1–5_pcs']]),
    { grade: 'C', reason: '个人自用；采购 1–5 件', source: 'RULE' });
  assert.deepEqual(grade([['Vous êtes ?', 'Grossiste'], ['Quantité par modèle', '30'], ['Importez-vous des meubles de Chine ?', 'Oui']]),
    { grade: 'A', reason: '批发商；每款 30 件；已从中国进口', source: 'RULE' });
  assert.equal(grade([['how_many_containers_per_order?', '2']]).grade, 'B', 'two containers from an unknown buyer');
  assert.equal(grade([['what_type_of_business_are_you?', 'interior_designer_/_project_business'], ['how_many_pieces?', '60'], ['when_will_you_order?', 'immediately']]).grade, 'A');
  assert.equal(grade([['what_type_of_business_are_you?', 'other_business']]).grade, 'C');
});

test('leads graded by the first rules are read again once: profile filled, grade made again', async () => {
  const tag = randomUUID().slice(0, 8);
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const longAgo = new Date('2026-10-01T00:00:00Z');
  const lead = async (name: string, source: string) => {
    const c = await db.customer.create({ data: { name: `${name} ${tag}`, ownerId: admin.id, whatsapp: '+966500000001', country: '沙特', source: 'FACEBOOK',
      purchaseType: 'OTHER', quantity: null, leadGrade: 'C', leadGradeReason: '买家类型不明；未填写数量；沙特', leadGradeSource: source, leadGradedAt: longAgo, updatedAt: longAgo } });
    await db.leadSubmission.create({ data: { customerId: c.id, eventKey: `regrade-${tag}-${name}`, ordinal: 1, occurredAt: longAgo, values: '{}', raw: graph(mattressForm),
      filename: 'Meta webhook', fileHash: '', translationPending: '[]' } });
    return c;
  };
  try {
    const old = await lead('Regrade', 'RULE');
    const byAi = await lead('ByAI', 'AI');
    assert.ok((await gradeUngradedLeads()).regraded >= 1);
    const after = await db.customer.findUniqueOrThrow({ where: { id: old.id } });
    assert.deepEqual([after.leadGrade, after.leadGradeSource, after.leadGradeReason], ['A', 'RULE', '批发商；采购 50–200 件；1 个月内下单；沙特']);
    assert.deepEqual([after.purchaseType, after.quantity, after.purchaseTimeline], ['WHOLESALE', null, 'within 1 month'], 'the profile shows what the form said');
    assert.equal(after.updatedAt.getTime(), longAgo.getTime(), 'a re-grade is not an edit');
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: byAi.id } })).leadGrade, 'C', 'AI grades are left alone');
    await gradeUngradedLeads();
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: old.id } })).leadGradedAt?.getTime(), after.leadGradedAt?.getTime(), 'only once');
  } finally {
    await deleteTestCustomers({ where: { name: { endsWith: ` ${tag}` } } });
    await db.$disconnect();
  }
});
