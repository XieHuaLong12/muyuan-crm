import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../services/customer-service';
import { periodRange,dayKey } from '../lib/time';
import { customerSchema,dealSchema } from '../lib/validation';
test('电话规范化识别空格、括号和国际区号前缀',()=>{assert.equal(normalizePhone('+33 (6) 12-34'),normalizePhone('003361234'));});
test('上海周一边界与 ISO 跨年周',()=>{const range=periodRange('WEEK','2026-09-10','Asia/Shanghai');assert.equal(range.start.toISOString(),'2026-09-06T16:00:00.000Z');assert.equal(range.end.toISOString(),'2026-09-13T16:00:00.000Z');assert.equal(dayKey('2026-09-10T18:00:00Z'),'2026-09-11');assert.equal(periodRange('WEEK','2027-01-01','Asia/Shanghai').key,'WEEK-2026-53');});
test('表单校验拒绝负金额、缺失成本与无效原因',()=>{assert.equal(dealSchema.safeParse({dealAmount:100,dealDate:'2026-09-10'}).success,false);assert.equal(dealSchema.safeParse({dealAmount:-1,productCost:0,dealDate:'2026-09-10'}).success,false);assert.equal(customerSchema.safeParse({name:'John',ownerId:'owner',isQualified:false}).success,false);assert.equal(customerSchema.safeParse({name:'John',ownerId:'owner',email:'bad'}).success,false);});
