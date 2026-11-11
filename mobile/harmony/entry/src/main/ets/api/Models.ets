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
