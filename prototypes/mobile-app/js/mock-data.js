/*
 * ⚠️ MOCK DATA — 原型演示用的模拟数据，不来自任何真实数据库或接口。
 *
 * 字段名与取值域沿用 BOS 现有定义，便于后续直接替换为真实 API：
 *   - 阶段 / 来源 / 采购身份 / 跟进方式：lib/constants.ts
 *   - 线索等级 A–D：lib/lead-grade.ts
 *   - 订单状态、付款、生产、发货：lib/order-status.ts
 *   - 任务来源、优先级、状态：lib/task-meta.ts
 *   - 通知种类：services/notification-service.ts（NotificationItem.kind），新增种类在 kindPlanned 中标注
 *   - 客户标签颜色：lib/customer-tags.ts
 * 价格、MOQ、交期为示例值（BOS 规定这些必须来自数据库，原型中一律标注「示例」）。
 * 客户、公司和人名均为虚构。
 */
window.LV = window.LV || {};

LV.NOW = '2026-11-10T10:24';            // 公司时区 Asia/Shanghai，周二
LV.TODAY = '2026-11-10';

LV.CONST = {
  stages: { NEW: '新线索', CONTACTED: '已联系', REPLIED: '已回复', CATALOG_SENT: '已发目录', NEEDS_CONFIRMED: '已确认需求', PRODUCT_CONFIRMED: '已确认款式', QUOTED: '已报价', FOLLOW_UP: '跟进中', ORDER: '确认采购', WON: '已成交', PAUSED: '暂不需要', LOST: '已流失', INVALID: '无效客户' },
  // 手机上阶段按销售推进顺序展示（与 PC 看板一致）
  stageFlow: ['NEW', 'CONTACTED', 'REPLIED', 'CATALOG_SENT', 'NEEDS_CONFIRMED', 'PRODUCT_CONFIRMED', 'QUOTED', 'FOLLOW_UP', 'ORDER', 'WON'],
  closedStages: ['PAUSED', 'LOST', 'INVALID'],
  reasonStages: ['INVALID', 'PAUSED', 'LOST'],
  invalidReasons: ['零售客户', '无采购需求', '联系方式无效', '垃圾询盘', '重复客户', '非目标市场', '其他'],
  sources: { FACEBOOK: 'Facebook', META_CLICK_TO_WHATSAPP: 'Meta 点击 WhatsApp', TIKTOK: 'TikTok', INSTAGRAM: 'Instagram', ALIBABA: 'Alibaba', WEBSITE: '官网', WHATSAPP: 'WhatsApp', EXHIBITION: '展会', REFERRAL: '转介绍', OUTBOUND: '主动开发', OTHER: '其他' },
  purchases: { WHOLESALE: '批发商', IMPORTER: '进口商', DISTRIBUTOR: '经销商', RETAILER: '家具零售', BRAND: '品牌客户', ECOMMERCE: '电商客户', OTHER: '其他' },
  followTypes: { WHATSAPP: 'WhatsApp', PHONE: '电话', EMAIL: '邮件', FACEBOOK: 'Facebook', MEETING: '会议', OTHER: '其他' },
  productLines: ['压缩沙发', '真空压缩床垫', '智能电动床垫'],
  grades: { A: 'A 优质', B: 'B 良好', C: 'C 一般', D: 'D 无效' },
  orderStatus: { PENDING_PAYMENT: '待付款', PRODUCING: '生产中', SHIPPED: '已发货', IN_TRANSIT: '运输中', COMPLETED: '已完成', CANCELLED: '已取消' },
  orderStages: ['下单', '付款', '生产', '发货', '运输', '清关', '收货'],
  statusStage: { PENDING_PAYMENT: 0, PRODUCING: 2, SHIPPED: 3, IN_TRANSIT: 4, COMPLETED: 6 },
  payment: { UNPAID: '未付款', DEPOSIT_PAID: '已付定金', PAID: '已付清' },
  production: { NOT_STARTED: '未开始', IN_PROGRESS: '进行中', DONE: '已完成' },
  shipping: { NOT_SHIPPED: '未发货', SHIPPED: '已发货', IN_TRANSIT: '运输中', CUSTOMS: '清关中', DELIVERED: '已签收' },
  taskSources: { CRM: 'CRM', WORKFLOW: '自动跟进', ORDER: '订单', FINANCE: '财务', ADS: '广告', AI: 'AI', MANUAL: '手动' },
  taskPriority: { HIGH: '高', MEDIUM: '中', LOW: '低' },
  tagColors: {
    green: { bg: '#e3f1e8', ink: '#1d5c3f' }, blue: { bg: '#e1ecfb', ink: '#1c4f99' }, purple: { bg: '#ece6f8', ink: '#553a9a' },
    orange: { bg: '#fbeadb', ink: '#8a4510' }, red: { bg: '#fbe4e2', ink: '#9b2c25' }, yellow: { bg: '#f8f0cf', ink: '#6b5300' },
    teal: { bg: '#dcf1f0', ink: '#14625e' }, gray: { bg: '#ececec', ink: '#4a4a4a' },
  },
  // 通知分类（手机消息中心）。kind 对应 services/notification-service.ts 的现有种类；planned 为需要新增的种类。
  notifyCategories: {
    inquiry: { label: '询盘', icon: 'user-round-plus', kinds: ['POOL_LEAD', 'NEW_LEAD', 'ASSIGNED', 'REPEAT_SUBMISSION'] },
    order: { label: '订单', icon: 'package', kinds: ['ORDER_NEW', 'ORDER_PAYMENT'], planned: true },
    followup: { label: '跟进', icon: 'alarm-clock', kinds: ['TASK_DUE', 'TASK_OVERDUE', 'FIRST_CONTACT_OVERDUE'] },
    approval: { label: '审批', icon: 'stamp', kinds: ['APPROVAL'], planned: true },
    exception: { label: '异常', icon: 'triangle-alert', kinds: ['SHIPPING_LATE', 'LEAD_NEEDS_HUMAN'] },
    system: { label: '公告', icon: 'megaphone', kinds: ['DAILY_BRIEF', 'ANNOUNCEMENT'] },
  },
};

LV.USERS = {
  u1: { id: 'u1', name: '陈立', role: 'ADMIN', email: 'admin@lvanju.example', title: '管理员' },
  u2: { id: 'u2', name: '林晓', role: 'SALES', email: 'linxiao@lvanju.example', title: '销售顾问' },
  u3: { id: 'u3', name: '周敏', role: 'SALES', email: 'zhoumin@lvanju.example', title: '销售顾问' },
  u4: { id: 'u4', name: '陈航', role: 'SALES', email: 'chenhang@lvanju.example', title: '销售顾问' },
  u5: { id: 'u5', name: '王蕾', role: 'SALES', email: 'wanglei@lvanju.example', title: '销售顾问' },
};
LV.DEMO_LOGIN = { ADMIN: 'u1', SALES: 'u2' };

LV.TAGS = {
  t1: { name: '大客户', color: 'green' }, t2: { name: '报价跟进', color: 'orange' }, t3: { name: '要样品', color: 'blue' },
  t4: { name: '价格敏感', color: 'red' }, t5: { name: '广交会', color: 'purple' }, t6: { name: '复购', color: 'teal' },
};

LV.PRODUCTS = {
  'Y-601': { model: 'Y-601', name: '压缩沙发 Y-601 · 模块组合', spec: '三人位 + 贵妃 · 抗压毛绒布', img: 'assets/products/Y-601.jpg' },
  'Y-604': { model: 'Y-604', name: '压缩沙发 Y-604', spec: '120×110×66 / 240×102×66 cm · 高密度海绵 · 抗压毛绒布', img: 'assets/products/Y-604.jpg' },
  'Y-605': { model: 'Y-605', name: '压缩沙发 Y-605 · 2.75 m', spec: '90×96×68 / 180×96×68 / 270×96×68 cm · 雪尼尔面料', img: 'assets/products/Y-605.jpg' },
  'Y-608': { model: 'Y-608', name: '压缩沙发 Y-608 · 3.92 m', spec: '196×98×65 / 294×98×65 cm · 法兰绒', img: 'assets/products/Y-608.jpg' },
  'M-801': { model: 'M-801', name: '真空压缩床垫 M-801', spec: '160×200×25 cm · 独立袋装弹簧', img: 'assets/products/M-801.jpg' },
  'M-805': { model: 'M-805', name: '真空压缩床垫 M-805', spec: '180×200×30 cm · 枕顶 · 记忆棉', img: 'assets/products/M-805.jpg' },
  'D-608': { model: 'D-608', name: '懒人沙发 D-608', spec: '单人 / 双人 · 泰迪绒', img: 'assets/products/D-608.jpg' },
  'C-301': { model: 'C-301', name: '软包床 C-301', spec: '180×200 cm · 科技布', img: 'assets/products/C-301.jpg' },
};

LV.CUSTOMERS = [
  { id: 'c1', name: 'Ahmed Al-Harbi', company: 'Al Noor Furniture Trading', country: '沙特', cc: 'SA', city: 'Riyadh', grade: 'A', gradeReason: '进口商 · 2×40HQ · 1 个月内采购', stage: 'QUOTED', source: 'FACEBOOK', owner: 'u2', tags: ['t1', 't2'],
    product: '压缩沙发', model: 'Y-604', quantity: '2×40HQ', purchase: 'IMPORTER', whatsapp: '+966 55 218 4407', phone: '+966 55 218 4407', email: 'ahmed@alnoor-trading.example', language: '阿拉伯语 / 英语',
    inquiryAt: '2026-11-03T10:02', lastContactAt: '2026-11-10T09:40', nextFollowUpAt: '2026-11-10T14:00', waiting: true, unread: 2, aiScore: 86,
    aiSummary: '报价已发 3 天，客户今早追问 DDP 利雅得运费，关注交期能否在 11 月底前出货。', aiNext: '今天 14:00 前回复 DDP 运费，并附 40HQ 装柜明细。',
    demand: [['采购身份', '进口商'], ['数量', '2×40HQ'], ['采购时间', '1 个月内'], ['目的港', 'Dammam'], ['预算', 'US$ 40,000 左右'], ['关注点', '运费、交期']] },
  { id: 'c2', name: 'Grace Wanjiru', company: 'Nairobi Home Living', country: '肯尼亚', cc: 'KE', city: 'Nairobi', grade: 'B', gradeReason: '家具零售店 · 1×40HQ', stage: 'REPLIED', source: 'META_CLICK_TO_WHATSAPP', owner: 'u2', tags: ['t3'],
    product: '真空压缩床垫', model: 'M-801', quantity: '1×40HQ', purchase: 'RETAILER', whatsapp: '+254 712 403 118', phone: '', email: '', language: '英语',
    inquiryAt: '2026-11-08T19:46', lastContactAt: '2026-11-10T10:16', nextFollowUpAt: '2026-11-10T11:00', waiting: true, unread: 3, aiScore: 72,
    aiSummary: '客户问 160 和 180 两个尺寸各装多少张，想先拿样品。', aiNext: '给出 40HQ 装柜量，说明样品费可在大货中抵扣（需按公司政策确认）。',
    demand: [['采购身份', '家具零售店'], ['数量', '1×40HQ'], ['尺寸', '160×200、180×200'], ['样品', '想先拿 2 张']] },
  { id: 'c3', name: 'Carlos Méndez', company: 'Casa Méndez Muebles', country: '墨西哥', cc: 'MX', city: 'Guadalajara', grade: 'A', gradeReason: '经销商 · 300 件 · 本月下单', stage: 'ORDER', source: 'TIKTOK', owner: 'u3', tags: ['t1'],
    product: '压缩沙发', model: 'Y-605', quantity: '300 件', purchase: 'DISTRIBUTOR', whatsapp: '+52 33 1820 5571', phone: '+52 33 1820 5571', email: 'compras@casamendez.example', language: '西班牙语',
    inquiryAt: '2026-10-21T22:10', lastContactAt: '2026-11-10T09:15', nextFollowUpAt: '2026-11-12T10:00', waiting: false, unread: 0, aiScore: 91,
    aiSummary: '已确认采购 Y-605 300 件，今天上午生成订单，等待 30% 定金。', aiNext: '发送 PI 与收款信息，跟进定金到账时间。', demand: [['采购身份', '经销商'], ['数量', '300 件'], ['颜色', '燕麦色、深灰']] },
  { id: 'c4', name: 'Fatima Zahra', company: 'Zahra Interiors', country: '阿联酋', cc: 'AE', city: 'Dubai', grade: 'A', gradeReason: '进口商 · 1×40HQ · 1 个月内', stage: 'NEW', source: 'FACEBOOK', owner: null, pool: true, tags: [],
    product: '压缩沙发', model: '', quantity: '1×40HQ', purchase: 'IMPORTER', whatsapp: '+971 50 774 2290', phone: '', email: 'fatima@zahrainteriors.example', language: '英语',
    inquiryAt: '2026-11-10T10:12', lastContactAt: null, nextFollowUpAt: null, waiting: false, unread: 0, aiScore: 0, aiSummary: '', aiNext: '', demand: [['采购身份', '进口商'], ['数量', '1×40HQ'], ['采购时间', '1 个月内']] },
  { id: 'c5', name: 'Ivan Petrov', company: 'Steppe Mebel', country: '哈萨克斯坦', cc: 'KZ', city: 'Almaty', grade: 'B', gradeReason: '批发商 · 数量未定', stage: 'CATALOG_SENT', source: 'FACEBOOK', owner: 'u4', tags: ['t4'],
    product: '压缩沙发', model: '', quantity: '', purchase: 'WHOLESALE', whatsapp: '+7 701 552 3018', phone: '', email: '', language: '俄语',
    inquiryAt: '2026-11-06T14:30', lastContactAt: '2026-11-07T11:00', nextFollowUpAt: '2026-11-09T11:00', waiting: false, unread: 0, aiScore: 54, aiSummary: '目录已发，客户未回复。', aiNext: '发送 3 款畅销型号与铁路运输时效。', demand: [] },
  { id: 'c6', name: 'Maria Santos', company: 'MS Home Depot', country: '菲律宾', cc: 'PH', city: 'Manila', grade: 'C', gradeReason: '个人自用可能性高', stage: 'CONTACTED', source: 'WEBSITE', owner: 'u2', tags: [],
    product: '真空压缩床垫', model: '', quantity: '20 张', purchase: 'OTHER', whatsapp: '+63 917 302 8861', phone: '', email: 'maria.santos@example.com', language: '英语',
    inquiryAt: '2026-11-09T08:20', lastContactAt: '2026-11-09T09:02', nextFollowUpAt: '2026-11-10T17:00', waiting: false, unread: 0, aiScore: 38, aiSummary: '首联已发，未回复。', aiNext: '发送新品目录后观察是否回复。', demand: [] },
  { id: 'c7', name: 'Adebayo Okafor', company: 'Okafor & Sons Trading', country: '尼日利亚', cc: 'NG', city: 'Lagos', grade: 'B', gradeReason: '展会名片 · 批发商', stage: 'FOLLOW_UP', source: 'EXHIBITION', owner: 'u5', tags: ['t5', 't6'],
    product: '压缩沙发', model: 'Y-608', quantity: '1×40HQ', purchase: 'WHOLESALE', whatsapp: '+234 803 441 2290', phone: '', email: '', language: '英语',
    inquiryAt: '2026-10-16T15:00', lastContactAt: '2026-11-04T16:30', nextFollowUpAt: '2026-11-14T10:00', waiting: false, unread: 0, aiScore: 66, aiSummary: '老客户，上一单已完成，在谈第二柜。', aiNext: '', demand: [] },
  { id: 'c8', name: 'Tomasz Nowak', company: 'Nowak Meble', country: '波兰', cc: 'PL', city: 'Poznań', grade: 'A', gradeReason: '转介绍 · 品牌客户', stage: 'WON', source: 'REFERRAL', owner: 'u3', tags: ['t1'],
    product: '压缩沙发', model: 'Y-605', quantity: '320 件', purchase: 'BRAND', whatsapp: '+48 601 228 974', phone: '', email: 'tomasz@nowakmeble.example', language: '英语 / 波兰语',
    inquiryAt: '2026-09-28T09:00', lastContactAt: '2026-11-08T15:00', nextFollowUpAt: '2026-11-15T10:00', waiting: false, unread: 0, aiScore: 88, aiSummary: '订单生产中，客户关注质检照片。', aiNext: '', demand: [] },
  { id: 'c9', name: 'Siti Rahman', company: 'Rumah Selesa', country: '马来西亚', cc: 'MY', city: 'Kuala Lumpur', grade: 'B', gradeReason: '电商客户 · 150 件', stage: 'ORDER', source: 'INSTAGRAM', owner: 'u2', tags: [],
    product: '懒人沙发', model: 'D-608', quantity: '150 件', purchase: 'ECOMMERCE', whatsapp: '+60 12 380 5547', phone: '', email: 'siti@rumahselesa.example', language: '马来语 / 英语',
    inquiryAt: '2026-10-25T12:00', lastContactAt: '2026-11-09T16:40', nextFollowUpAt: '2026-11-10T15:30', waiting: false, unread: 0, aiScore: 80, aiSummary: 'PI 已确认，等待 30% 定金。', aiNext: '下午跟进定金付款进度。', demand: [] },
  { id: 'c10', name: 'James Carter', company: 'Carter Outlet', country: '美国', cc: 'US', city: 'Houston', grade: 'C', gradeReason: '数量未说明', stage: 'NEW', source: 'FACEBOOK', owner: 'u2', tags: [],
    product: '压缩沙发', model: '', quantity: '', purchase: 'RETAILER', whatsapp: '+1 713 555 0148', phone: '+1 713 555 0148', email: '', language: '英语',
    inquiryAt: '2026-11-10T10:19', firstContactDueAt: '2026-11-10T10:28', lastContactAt: null, nextFollowUpAt: null, waiting: false, unread: 0, aiScore: 0, aiSummary: '', aiNext: '', demand: [] },
  { id: 'c11', name: 'Valentina Rojas', company: 'Rojas Hogar', country: '智利', cc: 'CL', city: 'Santiago', grade: 'A', gradeReason: '进口商 · 2×40HQ', stage: 'WON', source: 'FACEBOOK', owner: 'u2', tags: ['t1', 't6'],
    product: '真空压缩床垫', model: 'M-805', quantity: '2×40HQ', purchase: 'IMPORTER', whatsapp: '+56 9 8812 4471', phone: '', email: 'valentina@rojashogar.example', language: '西班牙语',
    inquiryAt: '2026-09-12T21:00', lastContactAt: '2026-11-09T22:10', nextFollowUpAt: '2026-11-11T10:00', waiting: false, unread: 0, aiScore: 84, aiSummary: '货物运输中，预计到港已延误 4 天。', aiNext: '联系货代确认到港时间并主动告知客户。', demand: [] },
  { id: 'c12', name: 'Omar Haddad', company: 'Haddad Furnishings', country: '约旦', cc: 'JO', city: 'Amman', grade: 'D', gradeReason: '号码无效', stage: 'INVALID', invalidReason: '联系方式无效', source: 'FACEBOOK', owner: 'u4', tags: [],
    product: '', model: '', quantity: '', purchase: 'OTHER', whatsapp: '+962 7 0000 0000', phone: '', email: '', language: '',
    inquiryAt: '2026-11-05T03:12', lastContactAt: '2026-11-05T09:00', nextFollowUpAt: null, waiting: false, unread: 0, aiScore: 0, aiSummary: '', aiNext: '', demand: [] },
  { id: 'c13', name: 'Nguyen Minh', company: 'Minh Phat Furniture', country: '越南', cc: 'VN', city: 'Ho Chi Minh City', grade: 'B', gradeReason: '经销商 · 小批量', stage: 'QUOTED', source: 'ALIBABA', owner: 'u5', tags: ['t4'],
    product: '真空压缩床垫', model: 'M-805', quantity: '200 张', purchase: 'DISTRIBUTOR', whatsapp: '+84 90 812 3364', phone: '', email: '', language: '越南语 / 英语',
    inquiryAt: '2026-10-29T10:00', lastContactAt: '2026-11-05T14:00', nextFollowUpAt: '2026-11-11T09:30', waiting: false, unread: 0, aiScore: 61, aiSummary: '', aiNext: '', demand: [] },
  { id: 'c14', name: 'Leila Karimi', company: 'Karimi Decor', country: '阿联酋', cc: 'AE', city: 'Sharjah', grade: 'C', gradeReason: '设计 / 工程客户', stage: 'PAUSED', invalidReason: '项目延期到明年', source: 'WEBSITE', owner: 'u2', tags: [],
    product: '软包床', model: 'C-301', quantity: '', purchase: 'OTHER', whatsapp: '+971 55 301 7720', phone: '', email: 'leila@karimidecor.example', language: '英语',
    inquiryAt: '2026-10-02T11:00', lastContactAt: '2026-10-20T11:00', nextFollowUpAt: '2026-12-01T10:00', waiting: false, unread: 0, aiScore: 30, aiSummary: '', aiNext: '', demand: [] },
  { id: 'c15', name: 'Daniel Osei', company: 'Osei Furniture Mart', country: '加纳', cc: 'GH', city: 'Accra', grade: 'B', gradeReason: '家具零售店 · 1×20GP', stage: 'CONTACTED', source: 'META_CLICK_TO_WHATSAPP', owner: 'u2', tags: [],
    product: '压缩沙发', model: '', quantity: '1×20GP', purchase: 'RETAILER', whatsapp: '+233 24 418 2207', phone: '', email: '', language: '英语',
    inquiryAt: '2026-11-10T09:21', lastContactAt: '2026-11-10T09:24', nextFollowUpAt: '2026-11-11T10:00', waiting: false, unread: 0, aiScore: 0, aiSummary: '', aiNext: '', demand: [] },
  { id: 'c16', name: 'Hannah Müller', company: 'Müller Wohnen', country: '德国', cc: 'DE', city: 'Köln', grade: 'B', gradeReason: '老客户再次留资', stage: 'WON', source: 'REFERRAL', owner: 'u3', tags: ['t6'],
    product: '真空压缩床垫', model: 'M-801', quantity: '', purchase: 'RETAILER', whatsapp: '+49 151 2208 7741', phone: '', email: 'hannah@muellerwohnen.example', language: '德语 / 英语',
    inquiryAt: '2026-11-09T17:40', lastContactAt: '2026-11-03T10:00', nextFollowUpAt: '2026-11-10T16:00', waiting: false, unread: 0, aiScore: 70, aiSummary: '', aiNext: '', demand: [] },
];

// 客户动态（跟进记录、WhatsApp、阶段变更、报价、留资），按时间倒序
LV.TIMELINE = {
  c1: [
    { at: '2026-11-10T09:40', type: 'IN', title: '客户发来 WhatsApp', body: 'Can you do DDP Riyadh? I need the total price for 2x40HQ before Thursday.', trans: '能做 DDP 到利雅得吗？我需要周四前拿到 2 个 40HQ 的总价。' },
    { at: '2026-11-07T16:20', type: 'QUOTE', title: '报价单已发送 · Q-20261107-002', body: 'US$ 38,640 · FOB Ningbo · 有效期至 11-21' },
    { at: '2026-11-06T11:05', type: 'FOLLOW', title: '跟进 · WhatsApp', by: 'u2', body: '确认 Y-604 三人位 + 贵妃组合，抗压毛绒布灰色。客户要求 11 月底前出货，需要先看装柜明细。' },
    { at: '2026-11-05T15:30', type: 'STAGE', title: '阶段：已确认款式 → 已报价', by: 'u2' },
    { at: '2026-11-04T10:12', type: 'OUT', title: '发送产品目录', body: 'LVANJU 2026 Compressed Sofa Catalog.pdf' },
    { at: '2026-11-03T10:06', type: 'OUT', title: '首次联系 · 4 分钟', body: 'WhatsApp 模板 lvanju_hi_sofa' },
    { at: '2026-11-03T10:02', type: 'LEAD', title: 'Meta 表单留资 · A 级', body: '进口商 · 2×40HQ · 1 个月内采购 · 已从中国进口' },
  ],
  c2: [
    { at: '2026-11-10T10:16', type: 'IN', title: '客户发来 WhatsApp', body: 'How many pieces of 160 and 180 fit in one 40HQ? Can I get 2 samples first?', trans: '一个 40HQ 能装多少张 160 和 180？可以先要 2 张样品吗？' },
    { at: '2026-11-09T09:30', type: 'FOLLOW', title: '跟进 · WhatsApp', by: 'u2', body: '发送 M-801 规格与真空压缩包装视频。' },
    { at: '2026-11-08T19:50', type: 'OUT', title: '首次联系 · 4 分钟', body: '点击广告进入的会话，自动欢迎语之后人工回复' },
    { at: '2026-11-08T19:46', type: 'LEAD', title: 'Meta 点击 WhatsApp · B 级', body: '家具零售店 · 1×40HQ' },
  ],
};

LV.QUOTES = [
  { id: 'q1', no: 'Q-20261107-002', customer: 'c1', status: 'SENT', sentAt: '2026-11-07T16:20', createdAt: '2026-11-07T15:40', createdBy: 'u2', currency: 'USD', incoterm: 'FOB Ningbo', validUntil: '2026-11-21', destination: 'Dammam, SA',
    items: [{ model: 'Y-604', qty: 120, price: 168, cbm: 0.42 }, { model: 'Y-601', qty: 80, price: 231, cbm: 0.58 }], freight: 0, other: 0 },
  { id: 'q2', no: 'Q-20261110-001', customer: 'c2', status: 'DRAFT', sentAt: null, createdAt: '2026-11-10T10:02', createdBy: 'u2', currency: 'USD', incoterm: 'CIF Mombasa', validUntil: '2026-11-24', destination: 'Mombasa, KE',
    items: [{ model: 'M-801', qty: 260, price: 61, cbm: 0.21, listPrice: 65.7 }], freight: 2850, other: 0, approval: 'ap1' },
  { id: 'q3', no: 'Q-20261109-002', customer: 'c3', status: 'SENT', sentAt: '2026-11-09T11:30', createdAt: '2026-11-09T10:50', createdBy: 'u3', currency: 'USD', incoterm: 'FOB Shenzhen', validUntil: '2026-11-23', destination: 'Manzanillo, MX',
    items: [{ model: 'Y-605', qty: 300, price: 82, cbm: 0.36 }], freight: 0, other: 0 },
  { id: 'q4', no: 'Q-20261104-003', customer: 'c13', status: 'SENT', sentAt: '2026-11-04T17:10', createdAt: '2026-11-04T16:30', createdBy: 'u5', currency: 'USD', incoterm: 'CIF Ho Chi Minh', validUntil: '2026-11-18', destination: 'Cat Lai, VN',
    items: [{ model: 'M-805', qty: 200, price: 88, cbm: 0.27 }], freight: 1600, other: 0 },
  { id: 'q5', no: 'Q-20261108-004', customer: 'c9', status: 'SENT', sentAt: '2026-11-08T10:00', createdAt: '2026-11-08T09:20', createdBy: 'u2', currency: 'USD', incoterm: 'FOB Ningbo', validUntil: '2026-11-22', destination: 'Port Klang, MY',
    items: [{ model: 'D-608', qty: 150, price: 96, cbm: 0.31 }], freight: 0, other: 0 },
];

LV.ORDERS = [
  { id: 'o1', no: 'LV20261110-001', customer: 'c3', owner: 'u3', amountRMB: 168000, currency: 'USD', source: 24600, status: 'PENDING_PAYMENT', payment: 'UNPAID', production: 'NOT_STARTED', shipping: 'NOT_SHIPPED', orderDate: '2026-11-10', eta: '2027-01-15', product: '压缩沙发', model: 'Y-605', qty: 300, quote: 'q3', notes: '30% 定金后排产，燕麦色 180 件、深灰 120 件。' },
  { id: 'o2', no: 'LV20261109-001', customer: 'c9', owner: 'u2', amountRMB: 96500, currency: 'USD', source: 14400, status: 'PENDING_PAYMENT', payment: 'UNPAID', production: 'NOT_STARTED', shipping: 'NOT_SHIPPED', orderDate: '2026-11-09', eta: '2026-12-28', product: '懒人沙发', model: 'D-608', qty: 150, quote: 'q5', notes: 'PI 已确认，客户承诺本周付定金。' },
  { id: 'o3', no: 'LV20261108-001', customer: 'c8', owner: 'u3', amountRMB: 286400, currency: 'EUR', source: 37200, status: 'PRODUCING', payment: 'DEPOSIT_PAID', production: 'IN_PROGRESS', shipping: 'NOT_SHIPPED', orderDate: '2026-11-08', eta: '2026-12-20', product: '压缩沙发', model: 'Y-605', qty: 320, notes: '客户要求出货前发质检照片。' },
  { id: 'o4', no: 'LV20261105-002', customer: 'c13', owner: 'u5', amountRMB: 72900, currency: 'USD', source: 10880, status: 'PRODUCING', payment: 'DEPOSIT_PAID', production: 'IN_PROGRESS', shipping: 'NOT_SHIPPED', orderDate: '2026-11-05', eta: '2026-12-10', product: '真空压缩床垫', model: 'M-805', qty: 200, notes: '' },
  { id: 'o5', no: 'LV20261102-002', customer: 'c11', owner: 'u2', amountRMB: 412800, currency: 'USD', source: 61600, status: 'IN_TRANSIT', payment: 'PAID', production: 'DONE', shipping: 'IN_TRANSIT', orderDate: '2026-10-02', eta: '2026-11-06', product: '真空压缩床垫', model: 'M-805', qty: 1100, notes: '船期 MSC ANNA 已延误，货代预计 11-14 到港。' },
  { id: 'o6', no: 'LV20261028-001', customer: 'c16', owner: 'u3', amountRMB: 198350, currency: 'EUR', source: 25760, status: 'SHIPPED', payment: 'PAID', production: 'DONE', shipping: 'SHIPPED', orderDate: '2026-09-28', eta: '2026-11-30', product: '真空压缩床垫', model: 'M-801', qty: 680, notes: '' },
  { id: 'o7', no: 'LV20261015-003', customer: 'c7', owner: 'u5', amountRMB: 154200, currency: 'USD', source: 23010, status: 'COMPLETED', payment: 'PAID', production: 'DONE', shipping: 'DELIVERED', orderDate: '2026-08-15', eta: '2026-10-15', product: '压缩沙发', model: 'Y-608', qty: 210, notes: '' },
  { id: 'o8', no: 'LV20261020-001', customer: 'c5', owner: 'u4', amountRMB: 133000, currency: 'USD', source: 19850, status: 'CANCELLED', payment: 'UNPAID', production: 'NOT_STARTED', shipping: 'NOT_SHIPPED', orderDate: '2026-10-20', eta: null, product: '压缩沙发', model: 'Y-604', qty: 260, notes: '客户资金未到位，取消。', cancelReason: '客户资金未到位' },
];

// ⚠️ 规划能力：BOS 目前没有审批流程。以下审批单仅为交互示意，触发规则需业务确认。
LV.APPROVALS = [
  { id: 'ap1', type: '报价审批', title: 'Q-20261110-001 · Grace Wanjiru', reason: 'M-801 单价 US$ 61.00，低于价格表 US$ 65.70（-7.2%）', applicant: 'u2', at: '2026-11-10T10:05', status: 'PENDING', amount: 'US$ 18,710', quote: 'q2' },
  { id: 'ap2', type: '成交更正', title: 'LV20261105-002 · Nguyen Minh', reason: '成交金额 ¥72,900 → ¥70,400，客户追加 2% 折扣', applicant: 'u5', at: '2026-11-09T17:42', status: 'PENDING', amount: '¥70,400', order: 'o4' },
  { id: 'ap3', type: '付款条件', title: 'Q-20261109-002 · Carlos Méndez', reason: '定金比例 30% → 20%', applicant: 'u3', at: '2026-11-09T11:10', status: 'APPROVED', amount: 'US$ 24,600', quote: 'q3' },
];

LV.TASKS = [
  { id: 'k1', title: '首次联系 James Carter', desc: '广告留资 24 小时内，须在 5 分钟内首次联系。', customer: 'c10', due: '2026-11-10T10:28', priority: 'HIGH', status: 'TODO', source: 'WORKFLOW', assignee: 'u2', reason: '新线索首联倒计时' },
  { id: 'k2', title: '回复 Grace：40HQ 装柜量与样品', desc: '客户在等回复：160 / 180 两个尺寸各装多少张，样品 2 张。', customer: 'c2', due: '2026-11-10T11:00', priority: 'HIGH', status: 'DOING', source: 'CRM', assignee: 'u2', reason: '客户已回复 8 分钟' },
  { id: 'k3', title: '跟进 Ahmed 报价', desc: '报价已发 3 天，客户追问 DDP 利雅得运费。', customer: 'c1', due: '2026-11-10T14:00', priority: 'HIGH', status: 'TODO', source: 'AI', assignee: 'u2', reason: '报价后 3 天未确认', amount: 'US$ 38,640' },
  { id: 'k4', title: '催 Siti 支付 30% 定金', desc: 'PI 已确认，订单 LV20261109-001 待付款。', customer: 'c9', due: '2026-11-10T15:30', priority: 'MEDIUM', status: 'TODO', source: 'ORDER', assignee: 'u2', order: 'o2', amount: '¥96,500' },
  { id: 'k5', title: '给 Maria 发送新品目录', desc: '', customer: 'c6', due: '2026-11-10T17:00', priority: 'LOW', status: 'TODO', source: 'MANUAL', assignee: 'u2' },
  { id: 'k6', title: '首次联系 Daniel Osei', desc: '', customer: 'c15', due: '2026-11-10T09:26', priority: 'HIGH', status: 'DONE', source: 'WORKFLOW', assignee: 'u2', doneAt: '2026-11-10T09:24' },
  { id: 'k7', title: '给 Ahmed 发 DDP 利雅得运费', desc: '找货代询 Dammam → Riyadh 内陆运输。', customer: 'c1', due: '2026-11-09T18:00', priority: 'HIGH', status: 'TODO', source: 'CRM', assignee: 'u2' },
  { id: 'k8', title: 'Valentina 物流跟进', desc: '联系货代确认 MSC ANNA 到港时间，并告知客户。', customer: 'c11', due: '2026-11-11T10:00', priority: 'MEDIUM', status: 'TODO', source: 'ORDER', assignee: 'u2', order: 'o5' },
  { id: 'k9', title: '回访 Leila（项目延期）', desc: '暂不需要，12 月初回访。', customer: 'c14', due: '2026-12-01T10:00', priority: 'LOW', status: 'TODO', source: 'WORKFLOW', assignee: 'u2' },
  { id: 'k10', title: '分配 2 条待分配线索', desc: '包括 A 级 Fatima Zahra（阿联酋）。', customer: null, due: '2026-11-10T10:30', priority: 'HIGH', status: 'TODO', source: 'CRM', assignee: 'u1' },
  { id: 'k11', title: '审批报价 Q-20261110-001', desc: '单价低于价格表 7.2%。', customer: 'c2', due: '2026-11-10T12:00', priority: 'MEDIUM', status: 'TODO', source: 'MANUAL', assignee: 'u1' },
  { id: 'k12', title: '复核 11 月团队目标', desc: '', customer: null, due: '2026-11-12T18:00', priority: 'LOW', status: 'TODO', source: 'MANUAL', assignee: 'u1' },
  { id: 'k13', title: '确认 Tomasz 质检照片', desc: '', customer: 'c8', due: '2026-11-10T16:00', priority: 'MEDIUM', status: 'TODO', source: 'ORDER', assignee: 'u3', order: 'o3' },
  { id: 'k14', title: '回访 Adebayo 第二柜', desc: '', customer: 'c7', due: '2026-11-14T10:00', priority: 'MEDIUM', status: 'TODO', source: 'CRM', assignee: 'u5' },
  { id: 'k15', title: '给 Hannah 回电（再次留资）', desc: '', customer: 'c16', due: '2026-11-10T16:00', priority: 'HIGH', status: 'TODO', source: 'WORKFLOW', assignee: 'u3' },
];

// 通知：audience 'ADMIN' | 'OWNER'（客户负责人）| 'ALL'
LV.NOTIFICATIONS = [
  { id: 'n1', kind: 'POOL_LEAD', cat: 'inquiry', priority: 'urgent', audience: 'ADMIN', at: '2026-11-10T10:12', title: 'A 级新线索待分配', body: 'Fatima Zahra · 阿联酋 · 进口商 · 1×40HQ · 1 个月内', route: ['customers', 'customer', { id: 'c4' }] },
  { id: 'n2', kind: 'FIRST_CONTACT_OVERDUE', cat: 'followup', priority: 'urgent', audience: 'OWNER', owner: 'u2', at: '2026-11-10T10:20', title: '首次联系即将超时', body: 'James Carter · 美国 · 10:28 前需完成首联', route: ['customers', 'customer', { id: 'c10' }] },
  { id: 'n3', kind: 'ASSIGNED', cat: 'inquiry', priority: 'high', audience: 'OWNER', owner: 'u2', at: '2026-11-10T09:21', title: '新分配客户 · B 级', body: 'Daniel Osei · 加纳 · 请在 5 分钟内联系', route: ['customers', 'customer', { id: 'c15' }], read: true },
  { id: 'n4', kind: 'ORDER_NEW', cat: 'order', priority: 'normal', audience: 'ADMIN', at: '2026-11-10T09:15', title: '新订单 LV20261110-001', body: 'Carlos Méndez · ¥168,000 · 等待 30% 定金', route: ['orders', 'order', { id: 'o1' }], planned: true },
  { id: 'n5', kind: 'SHIPPING_LATE', cat: 'exception', priority: 'high', audience: 'OWNER', owner: 'u2', at: '2026-11-10T08:30', title: '物流异常 · 已超预计到货 4 天', body: 'LV20261102-002 · Valentina Rojas · 运输中', route: ['orders', 'order', { id: 'o5' }] },
  { id: 'n6', kind: 'DAILY_BRIEF', cat: 'system', priority: 'normal', audience: 'ADMIN', at: '2026-11-10T08:00', title: '今日简报', body: '昨日新增线索 23 条（A/B 级 9 条），首联平均 4 分钟；1 条 A 级首联超时。', route: ['home', 'analytics', {}] },
  { id: 'n7', kind: 'APPROVAL', cat: 'approval', priority: 'high', audience: 'ADMIN', at: '2026-11-10T10:05', title: '报价待审批', body: 'Q-20261110-001 · 单价低于价格表 7.2% · 林晓提交', route: ['orders', 'approval', { id: 'ap1' }], planned: true },
  { id: 'n8', kind: 'APPROVAL', cat: 'approval', priority: 'normal', audience: 'OWNER', owner: 'u2', at: '2026-11-10T10:05', title: '报价审批已提交', body: 'Q-20261110-001 等待管理员审批', route: ['orders', 'approval', { id: 'ap1' }], planned: true },
  { id: 'n9', kind: 'TASK_OVERDUE', cat: 'followup', priority: 'high', audience: 'OWNER', owner: 'u2', at: '2026-11-09T18:00', title: '任务已到期', body: '给 Ahmed 发 DDP 利雅得运费', route: ['home', 'task', { id: 'k7' }] },
  { id: 'n10', kind: 'REPEAT_SUBMISSION', cat: 'inquiry', priority: 'high', audience: 'ADMIN', at: '2026-11-09T17:40', title: '老客户再次留资', body: 'Hannah Müller · 德国 · 负责人 周敏', route: ['customers', 'customer', { id: 'c16' }], read: true },
  { id: 'n11', kind: 'FIRST_CONTACT_OVERDUE', cat: 'exception', priority: 'high', audience: 'ADMIN', at: '2026-11-09T14:42', title: 'A/B 级线索首联超时', body: 'Ivan Petrov · 哈萨克斯坦 · 负责人 陈航 · 超时 12 分钟', route: ['customers', 'customer', { id: 'c5' }], read: true },
  { id: 'n12', kind: 'ORDER_PAYMENT', cat: 'order', priority: 'normal', audience: 'ALL', at: '2026-11-08T15:10', title: '已收定金', body: 'LV20261108-001 · Tomasz Nowak · 30% 定金到账', route: ['orders', 'order', { id: 'o3' }], read: true, planned: true },
  { id: 'n13', kind: 'TASK_DUE', cat: 'followup', priority: 'normal', audience: 'OWNER', owner: 'u2', at: '2026-11-10T10:30', title: '任务即将到期', body: '回复 Grace：40HQ 装柜量与样品 · 11:00', route: ['home', 'task', { id: 'k2' }] },
  { id: 'n14', kind: 'ANNOUNCEMENT', cat: 'system', priority: 'low', audience: 'ALL', at: '2026-11-07T18:00', title: '系统维护通知', body: '11 月 15 日 22:00–23:00 系统升级，期间无法登录。', route: null, read: true, planned: true },
];

// WhatsApp 会话（消息页「会话」）
LV.CHATS = {
  c1: [
    { dir: 'out', at: '2026-11-07T16:20', text: 'Hi Ahmed, please find our quotation Q-20261107-002 attached. FOB Ningbo, valid until Nov 21.', file: 'Q-20261107-002.pdf', status: 'read' },
    { dir: 'in', at: '2026-11-10T09:38', text: 'Thanks. The price is ok for us.', trans: '谢谢，价格我们可以接受。' },
    { dir: 'in', at: '2026-11-10T09:40', text: 'Can you do DDP Riyadh? I need the total price for 2x40HQ before Thursday.', trans: '能做 DDP 到利雅得吗？我需要周四前拿到 2 个 40HQ 的总价。' },
  ],
  c2: [
    { dir: 'out', at: '2026-11-09T09:30', text: 'Hello Grace, here is the M-801 spec sheet and our vacuum packing video.', status: 'read' },
    { dir: 'in', at: '2026-11-10T10:12', text: 'Thank you, looks good.', trans: '谢谢，看起来不错。' },
    { dir: 'in', at: '2026-11-10T10:14', text: 'How many pieces of 160 and 180 fit in one 40HQ?', trans: '一个 40HQ 能装多少张 160 和 180？' },
    { dir: 'in', at: '2026-11-10T10:16', text: 'Can I get 2 samples first?', trans: '可以先要 2 张样品吗？' },
  ],
};
LV.QUICK_REPLIES = ['Thank you! Let me check and get back to you within 30 minutes.', 'Could you share your destination port?', 'Here is our latest catalog.', 'Our MOQ is 10 pcs per model.'];

// 经营数据（管理员口径：全公司；销售口径：本人）。人民币，按成交日期；其他币种不折算，单独列出。
LV.METRICS = {
  ADMIN: {
    today: { newCustomers: 23, newDelta: 4, pendingFollow: 18, overdueFollow: 5, pendingOrders: 6, todayRevenue: 168000, todayDeals: 1, poolCount: 2, poolOldestMin: 12 },
    month: { revenue: 1286450, prevRevenue: 1088300, target: 2000000, orders: 14, prevOrders: 11, grossProfit: 338900, inquiries: 412, qualified: 137, quoted: 46, won: 14, avgFirstContact: 4, otherCurrency: 'EUR 8,400 未折算' },
    // 本月 1–10 日每日成交额（千元），上月同期
    trend: { days: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], cur: [96, 0, 182, 64, 141, 0, 88, 286, 260, 168.45], prev: [110, 120, 0, 135, 84, 160, 0, 150, 188, 141.3] },
    ranking: [{ u: 'u3', revenue: 486200, deals: 5 }, { u: 'u2', revenue: 412800, deals: 4 }, { u: 'u4', revenue: 246050, deals: 3 }, { u: 'u5', revenue: 141400, deals: 2 }],
    payments: { PAID: 5, DEPOSIT_PAID: 4, UNPAID: 3 },
    sources: [{ k: 'Facebook', v: 251 }, { k: 'Meta 点击 WhatsApp', v: 91 }, { k: 'TikTok', v: 37 }, { k: '官网', v: 19 }, { k: '其他', v: 14 }],
  },
  SALES: {
    today: { todayWork: 7, overdueWork: 2, pendingFirst: 1, waitingReply: 2, todayRevenue: 0, todayDeals: 0 },
    month: { revenue: 412800, prevRevenue: 356000, target: 600000, orders: 4, prevOrders: 3, inquiries: 52, qualified: 18, quoted: 9, won: 3, avgFirstContact: 4, otherCurrency: '' },
    trend: { days: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], cur: [0, 0, 120, 0, 100, 0, 96.3, 0, 96.5, 0], prev: [0, 140, 0, 0, 0, 120, 0, 0, 96, 0] },
    payments: { PAID: 1, DEPOSIT_PAID: 0, UNPAID: 1 },
  },
};

LV.DEVICES = [
  { name: 'Pixel 8 · Android 15', place: '本机', at: '当前', current: true },
  { name: 'HUAWEI Mate 60 · HarmonyOS 5.0', place: '上海', at: '2 天前' },
  { name: 'Chrome · Windows', place: '上海', at: '今天 08:56' },
];
