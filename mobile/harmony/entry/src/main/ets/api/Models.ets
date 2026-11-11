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
