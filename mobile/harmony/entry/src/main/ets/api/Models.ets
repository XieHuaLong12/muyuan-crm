/**
 * Response shapes of the existing BOS endpoints the app uses. Field names match the server JSON exactly.
 * Only the fields the app reads are declared; the server may send more. Prisma Decimal values arrive as strings,
 * dates as ISO strings.
 */

// ── Auth ────────────────────────────────────────────────── POST /api/auth/login, GET /api/bootstrap
export interface LoginBody {
  email: string;
  password: string;
}

export interface LoginUser {
  id: string;
  name: string;
  role: string;
}

export interface BootstrapUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Bootstrap {
  user: BootstrapUser;
}

// ── Notifications ───────────────────────────────────────── GET /api/notifications (services/notification-service.ts)
export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  at: string;
  urgent: boolean;
  ring?: string;
}

export interface NotificationCounts {
  reminders: number;
  pendingFirstContact: number;
  overdueFirstContact: number;
  pool: number;
  poolOldestAt: string | null;
  today?: number;
  todayOverdue?: number;
  unreadConversations: number;
}

export interface NotificationFeed {
  at: string;
  adLeadMinutes: number;
  counts: NotificationCounts;
  items: NotificationItem[];
}

// ── Work queues ─────────────────────────────────────────── GET /api/bos/sales?queue= (services/bos-sales-service.ts)
export interface DueTask {
  title: string;
  dueDate: string;
}

export interface QueueCustomer {
  id: string;
  name: string;
  companyName: string;
  country: string;
  source: string;
  productInterest: string;
  stage: string;
  leadGrade: string;
  leadGradeReason: string;
  nextFollowUpAt: string | null;
  firstContactDueAt: string | null;
  firstContactAt: string | null;
  lastContactAt: string | null;
  lastInboundAt: string | null;
  reasons: string[];
  dueTasks: DueTask[];
}

export interface QueueCount {
  key: string;
  count: number;
}

export interface SalesQueue {
  total: number;
  pageSize: number;
  counts: QueueCount[];
  customers: QueueCustomer[];
}

// ── Customer list (pool) ────────────────────────────────── GET /api/customers?assign=pending
export interface OwnerName {
  name: string;
}

export interface ListCustomerRow {
  id: string;
  name: string;
  companyName: string;
  country: string;
  stage: string;
  leadGrade: string;
  leadGradeReason: string;
  inquiryAt: string | null;
  createdAt: string;
  nextFollowUpAt: string | null;
  owner: OwnerName | null;
}

export interface CustomerListPage {
  rows: ListCustomerRow[];
  total: number;
  pool: number;
}

// ── Customer detail ─────────────────────────────────────── GET /api/customers/:id
export interface FollowUpRow {
  id: string;
  type: string;
  content: string;
  followUpAt: string;
  nextFollowUpAt: string | null;
  createdBy: string;
}

export interface StageChange {
  id: string;
  fromStage: string | null;
  toStage: string;
  changedAt: string;
  note: string;
}

export interface DealOrder {
  id: string;
  orderNo: string;
  status: string;
}

export interface DealRow {
  id: string;
  dealAmount: string;
  currency: string;
  dealDate: string;
  orderNumber: string;
  order: DealOrder | null;
}

export interface CustomerDetail {
  id: string;
  name: string;
  companyName: string;
  country: string;
  city: string;
  phone: string;
  whatsapp: string;
  email: string;
  language: string;
  source: string;
  stage: string;
  leadGrade: string;
  leadGradeReason: string;
  purchaseType: string;
  productInterest: string;
  productModel: string;
  quantity: number | null;
  invalidReason: string;
  inquiryAt: string | null;
  createdAt: string;
  nextFollowUpAt: string | null;
  lastContactAt: string | null;
  firstContactDueAt: string | null;
  firstContactAt: string | null;
  aiSummary: string;
  aiNextAction: string;
  notes: string;
  pendingAssignment: boolean;
  owner: OwnerName | null;
  followUps: FollowUpRow[];
  stageHistory: StageChange[];
  deals: DealRow[];
}

/** POST /api/customers/:id/followups (lib/validation.ts followSchema). */
export interface FollowUpBody {
  type: string;
  content: string;
  followUpAt: string;
  nextFollowUpAt: string | null;
}

// ── Orders ──────────────────────────────────────────────── GET /api/orders, GET /api/orders/:id
export interface OrderCustomer {
  id: string;
  name: string;
  companyName: string;
  country: string;
}

export interface OrderProgress {
  done: boolean[];
  cancelled: boolean;
}

export interface OrderRow {
  id: string;
  orderNo: string;
  amountRMB: string;
  currency: string;
  sourceAmount: string | null;
  status: string;
  statusLabel: string;
  paymentStatus: string;
  paymentLabel: string;
  productionLabel: string;
  shippingLabel: string;
  orderDate: string;
  estimatedDelivery: string | null;
  overdue: boolean;
  customer: OrderCustomer;
  progress: OrderProgress;
}

export interface OrderTab {
  key: string;
  label: string;
  count: number;
}

export interface OrderReminders {
  pendingPayment: number;
  pendingShipment: number;
  shippingException: number;
  pendingCollection: number;
}

export interface OrderListPage {
  total: number;
  pageSize: number;
  tabs: OrderTab[];
  allCount: number;
  reminders: OrderReminders;
  orders: OrderRow[];
}

export interface OrderDeal {
  product: string;
  productModel: string;
  quantity: number;
  dealAmount: string;
  currency: string;
  dealDate: string;
}

export interface OrderQuotation {
  id: string;
  quoteNumber: string;
  product: string;
  amount: string;
  currency: string;
  status: string;
  sentAt: string | null;
}

export interface OrderDetail {
  id: string;
  orderNo: string;
  amountRMB: string;
  currency: string;
  sourceAmount: string | null;
  status: string;
  statusLabel: string;
  paymentLabel: string;
  productionLabel: string;
  shippingLabel: string;
  deposit: string;
  balance: string;
  orderDate: string;
  estimatedDelivery: string | null;
  notes: string;
  /** For the compare-and-swap of 推进状态 / 取消订单. */
  updatedAt: string;
  progress: OrderProgress;
  customer: OrderCustomer;
  deal: OrderDeal | null;
  quotations: OrderQuotation[];
}

// ── Tasks ───────────────────────────────────────────────── GET /api/tasks, POST /api/tasks/:id/complete
export interface TaskCustomer {
  id: string;
  name: string;
  country: string;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  status: string;
  priority: string;
  source: string;
  type?: string;
  customer: TaskCustomer | null;
}

export interface TaskListPage {
  tasks: TaskRow[];
  total: number;
  nextCursor: string | null;
}

export interface EmptyBody {
  ok?: boolean;
}

// ── WhatsApp conversations ──────────────────────────────── GET /api/inbox/conversations (services/inbox-service.ts)
export interface PersonRef {
  id: string;
  name: string;
}

export interface LastMessage {
  preview: string;
  direction: string;
  status: string;
}

export interface ChatWindow {
  /** OPEN: free text allowed until expiresAt. CLOSED / UNKNOWN: only approved templates (sent from the PC). */
  status: string;
  expiresAt: string | null;
}

export interface Conversation {
  id: string;
  name: string;
  companyName: string;
  country: string;
  stage: string;
  owner: PersonRef | null;
  lastMessageAt: string;
  unread: number;
  awaiting: boolean;
  firstContactOverdue: boolean;
  lastMessage: LastMessage | null;
  window: ChatWindow;
  grade: string;
}

export interface ConversationPage {
  conversations: Conversation[];
  hasMore: boolean;
  pendingTotal: number;
  todoTotal: number;
}

// ── One conversation ────────────────────────────────────── GET /api/inbox/thread?customerId=
export interface Translation {
  kind: string;
  text: string;
}

export interface ChatMessage {
  id: string;
  direction: string;
  messageType: string;
  content: string;
  status: string;
  sentAt: string;
  fileName: string | null;
  mimeType?: string | null;
  /** Where the picture or file can be fetched (signed-in), or null. */
  mediaHref?: string | null;
  translation: Translation | null;
}

export interface ThreadCustomer {
  id: string;
  name: string;
  companyName: string;
  country: string;
  stage: string;
  leadGrade: string;
  whatsapp: string;
  owner: PersonRef | null;
}

export interface ThreadSending {
  /** Free text can be sent (inside the 24-hour window). */
  configured: boolean;
  /** Approved templates can be sent (Gupshup template API configured). */
  templates: boolean;
  optedOut: boolean;
}

export interface Thread {
  customer: ThreadCustomer;
  messages: ChatMessage[];
  nextCursor: string | null;
  window: ChatWindow;
  sending: ThreadSending;
}

/** POST /api/whatsapp/send (services/whatsapp-message-service.ts sendMessageSchema). */
export interface SendBody {
  customerId: string;
  content: string;
  requestId: string;
  /** A file already uploaded for this customer (POST /api/whatsapp/media or /api/inbox/materials). */
  mediaAssetId?: string;
  /** The Chinese the salesperson wrote before 译成客户语言 / AI, kept with the message. */
  original?: string;
}

export interface SentMessage {
  message: ChatMessage;
}

/** POST /api/whatsapp/read. */
export interface ReadBody {
  customerId: string;
  readAt: string;
}

// ── Stage change ────────────────────────────────────────── PATCH /api/bos/crm-stage (services/bos-crm-service.ts)
export interface StageBody {
  customerId: string;
  fromStage: string;
  toStage: string;
  reason: string;
}

export interface StageResult {
  stage: string;
}

// ── Performance ─────────────────────────────────────────── GET /api/sales-team/performance (sales-team-service.ts)
export interface TargetRef {
  amount: string;
}

export interface PerformanceRow {
  id: string;
  name: string;
  isActive: boolean;
  newCustomers: number;
  assigned: number;
  /** Customers this person marked 无效 / 暂不需要 / 流失 this month (for the administrator's review). */
  closedByOwner: number;
  contacted: number;
  qualified: number;
  quoted: number;
  deals: number;
  revenue: string;
  conversion: number | null;
  averageFirstContactMinutes: number | null;
  pendingFirstContact: number;
  overdueFirstContact: number;
  firstContactOnTime: number | null;
  target: TargetRef | null;
  completion: number | null;
}

export interface CompanyTotals {
  newCustomers: number;
  qualified: number;
  deals: number;
  revenue: string;
}

export interface TargetSummary {
  personal: string;
  company: string | null;
}

export interface Performance {
  month: string;
  currency: string;
  firstContactHours: number;
  pendingTotal: number;
  rows: PerformanceRow[];
  company: CompanyTotals | null;
  targetSummary: TargetSummary | null;
}

// ── Templates ───────────────────────────────────────────── GET/POST /api/whatsapp/templates (whatsapp-template-service.ts)
/** A Meta-approved text template, read live from Gupshup; {{1}}…{{n}} are its variables. */
export interface WaTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  variables: number;
}

/** One variable filled from the customer record (value '' when the server could not tell; note says why). */
export interface VariableFill {
  label: string;
  context: string;
  value: string;
  note: string;
}

export interface TemplateSuggestion {
  templateId: string;
}

export interface TemplateList {
  /** CONNECTED or NOT_CONNECTED. */
  status: string;
  templates: WaTemplate[];
  suggestion: TemplateSuggestion | null;
  fills: Record<string, VariableFill[]>;
}

export interface TemplateBody {
  customerId: string;
  templateId: string;
  params: string[];
  requestId: string;
}

export interface TemplateSent {
  message: ChatMessage;
  /** Set when Gupshup refused the message or the result is unknown (the message is kept as FAILED / UNKNOWN). */
  error?: string;
}

// ── Chat assistants (DeepSeek on the server; nothing is sent from these) ───────────────────────────────────────
/** POST /api/whatsapp/ai-reply (services/whatsapp-ai-service.ts). */
export interface AiReplyBody {
  customerId: string;
  previous?: string;
}

export interface AiReply {
  reply: string;
  replyZh: string;
  nextStep: string;
  warnings: string[];
}

/** POST /api/inbox/polish (services/reply-polish-service.ts): three ways to say the line in the input box. */
export interface PolishBody {
  customerId: string;
  text: string;
  avoid: string[];
}

export interface PolishSuggestion {
  angle: string;
  text: string;
  zh: string;
  why: string;
  warnings: string[];
}

export interface PolishResult {
  suggestions: PolishSuggestion[];
  priceAsked: boolean;
}

/** POST /api/inbox/translate-out: the salesperson's Chinese in the customer's language. */
export interface TranslateOutBody {
  customerId: string;
  text: string;
}

export interface TranslateOut {
  text: string;
  language: string;
}

/** POST /api/inbox/translate {messageId} → Chinese of one customer message (stored for everyone). */
export interface TranslateBody {
  messageId: string;
}

/** POST /api/inbox/translate-batch {customerId, messageIds ≤ 10}. */
export interface TranslateBatchBody {
  customerId: string;
  messageIds: string[];
}

export interface TranslateBatch {
  translations: Record<string, Translation>;
  unavailable: boolean;
}

// ── Quick replies ───────────────────────────────────────── GET /api/quick-replies?customerId= (quick-reply-service.ts)
export interface QuickReply {
  id: string;
  scope: string;
  title: string;
  category: string;
  zh: string;
  /** fr / en / ar → text; {客户名} and {我的名字} are filled in the app. */
  bodies: Record<string, string>;
  top: boolean;
}

export interface QuickReplyCustomer {
  language: string;
  firstName: string;
}

export interface QuickReplyList {
  replies: QuickReply[];
  customer: QuickReplyCustomer | null;
  me: string;
}

// ── Product materials ───────────────────────────────────── GET/POST /api/inbox/materials (sales-material-service.ts)
export interface MaterialFile {
  id: string;
  title: string;
  category: string;
  language: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface ProductImage {
  id: string;
  hero: boolean;
  /** Signed-in path, e.g. /media/products/… */
  src: string;
}

export interface ProductMaterial {
  id: string;
  model: string;
  name: string;
  images: ProductImage[];
}

export interface RecentFile {
  id: string;
  fileName: string;
  mimeType: string;
  to: string;
}

export interface MaterialPicker {
  language: string;
  files: MaterialFile[];
  products: ProductMaterial[];
  recent: RecentFile[];
}

/** kind: MATERIAL | PRODUCT_IMAGE | RECENT. */
export interface AttachItem {
  kind: string;
  id: string;
}

export interface AttachBody {
  customerId: string;
  items: AttachItem[];
}

export interface MediaAsset {
  id: string;
  fileName: string;
  mimeType: string;
}

export interface AttachResult {
  assets: MediaAsset[];
}

// ── Server additions for the app (services/mobile-app-service.ts, app/api/bos/cockpit) ────────────────────────
export interface CockpitSelected {
  range: string;
  label: string;
  startKey: string;
  endKey: string;
  trend: string;
}

export interface CockpitKpis {
  periodRevenue: number;
  quotedAmount: number;
  grossProfit: number | null;
  periodOrders: number;
  newCustomers: number;
  completion: number | null;
}

export interface CockpitGoal {
  periodGoal: number | null;
  periodRevenue: number;
  completion: number | null;
}

export interface TrendPoint {
  label: string;
  revenue: number;
  orders: number;
}

export interface CockpitTrend {
  view: string;
  label: string;
  points: TrendPoint[];
}

export interface FunnelStage {
  label: string;
  count: number;
  conversion: number | null;
}

export interface CockpitChannel {
  id: string;
  name: string;
  customers: number;
  revenue: number;
  roi: number | null;
}

export interface CockpitSuggestion {
  kind: string;
  title: string;
  detail: string;
  href: string;
}

/** GET /api/bos/cockpit?range= — the PC 驾驶舱 (sales: own customers, no profit). */
export interface Cockpit {
  scope: string;
  currency: string;
  selected: CockpitSelected;
  kpis: CockpitKpis;
  goal: CockpitGoal;
  trend: CockpitTrend;
  funnel: FunnelStage[];
  channels: CockpitChannel[];
  suggestions: CockpitSuggestion[];
}

export interface SeenState {
  seenAt: string | null;
}

export interface SeenBody {
  seenAt: string;
}

export interface AppLatest {
  versionName: string;
  versionCode: number;
  url: string;
  notes: string;
}

export interface AppVersion {
  platform: string;
  latest: AppLatest | null;
  minVersionCode: number | null;
}

export interface PasswordBody {
  currentPassword: string;
  newPassword: string;
}

export interface Done {
  changed?: boolean;
  signedOut?: boolean;
}

// ── Writes the PC already offers ────────────────────────────────────────────────────────────────────────────
/** POST /api/tasks (services/task-service.ts taskInput). */
export interface TaskBody {
  customerId: string | null;
  title: string;
  description: string;
  type: string;
  priority: string;
  dueDate: string;
}

/** PATCH /api/tasks/:id. */
export interface TaskPatch {
  status?: string;
  dueDate?: string;
  priority?: string;
}

/** PATCH /api/orders/:id — PENDING_PAYMENT | PRODUCING | SHIPPED | IN_TRANSIT | COMPLETED (completion: administrators). */
export interface MilestoneBody {
  status: string;
  expectedUpdatedAt: string;
}

export interface MilestoneResult {
  status: string;
  statusLabel: string;
  updatedAt: string;
}

/** POST /api/orders/:id/cancel (administrators). */
export interface CancelBody {
  reason: string;
  expectedUpdatedAt: string;
}

/** GET /api/quotations?customerId= — the customer's quotations, newest first. */
export interface Quotation {
  id: string;
  quoteNumber: string;
  product: string;
  quantity: number;
  unitPrice: string;
  totalAmount: string | null;
  currency: string;
  incoterm: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
}

/** POST /api/customers (lib/validation.ts customerSchema; the rest take their defaults). */
export interface NewCustomerBody {
  name: string;
  companyName: string;
  country: string;
  whatsapp: string;
  phone: string;
  email: string;
  source: string;
  productInterest: string;
  purchaseType: string;
  quantity: number | null;
  notes: string;
  ownerId: string;
  forceDuplicate?: boolean;
}

export interface CreatedCustomer {
  id: string;
  name: string;
}

/** GET /api/sales-team/accounts (administrators). */
export interface SalesAccount {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  customerCount: number;
}

/** POST /api/customers/assign (administrators). */
export interface AssignBody {
  ids: string[];
  ownerId: string;
  reason: string;
}
