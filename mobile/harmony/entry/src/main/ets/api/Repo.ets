import { util } from '@kit.ArkTS';
import { Api } from './Http';
import { Session } from './Session';
import {
  Bootstrap, ConversationPage, CustomerDetail, CustomerListPage, EmptyBody, FollowUpBody, LoginBody, LoginUser,
  NotificationFeed, OrderDetail, OrderListPage, Performance, ReadBody, SalesQueue, SendBody, SentMessage, StageBody,
  StageResult, TaskListPage, TemplateBody, TemplateList, TemplateSent, Thread
} from './Models';

/** Query objects in one place, so a request and its cached copy (Api.peek) always use the same key. */
function queueQuery(queue: string, q: string, page: number): Record<string, string> {
  const query: Record<string, string> = { 'queue': queue, 'q': q, 'page': `${page}` };
  return query;
}

function poolQuery(q: string): Record<string, string> {
  const query: Record<string, string> = { 'assign': 'pending', 'q': q, 'pageSize': '50', 'sort': 'priority' };
  return query;
}

function ordersQuery(tab: string, q: string, page: number): Record<string, string> {
  const query: Record<string, string> = { 'tab': tab, 'q': q, 'page': `${page}` };
  return query;
}

function tasksQuery(view: string, status: string): Record<string, string> {
  const query: Record<string, string> = { 'view': view, 'status': status };
  return query;
}

function conversationsQuery(filter: string, q: string, page: number): Record<string, string> {
  const query: Record<string, string> = { 'filter': filter, 'q': q, 'page': `${page}` };
  return query;
}

function threadQuery(customerId: string, before: string): Record<string, string> {
  const query: Record<string, string> = { 'customerId': customerId, 'before': before };
  return query;
}

/** Typed calls to the existing BOS endpoints. No server change is needed for these (docs/mobile-app/NATIVE_PLAN.md). */
export class Repo {
  static async login(email: string, password: string): Promise<LoginUser> {
    const body: LoginBody = { email: email, password: password };
    const user = await Api.post<LoginUser>('/api/auth/login', body);
    await Session.rememberUser(user.name, user.role, email);
    return user;
  }

  static async logout(): Promise<void> {
    const body: EmptyBody = {};
    try {
      await Api.post<EmptyBody>('/api/auth/logout', body);
    } finally {
      await Session.clear();
    }
  }

  static async me(): Promise<Bootstrap> {
    const boot = await Api.get<Bootstrap>('/api/bootstrap');
    await Session.rememberUser(boot.user.name, boot.user.role, boot.user.email);
    return boot;
  }

  static notifications(): Promise<NotificationFeed> {
    return Api.get<NotificationFeed>('/api/notifications');
  }

  static peekNotifications(): NotificationFeed | null {
    return Api.peek<NotificationFeed>('/api/notifications');
  }

  /** This month: revenue, deals, target completion (sales: own row; administrators: every salesperson + company). */
  static performance(): Promise<Performance> {
    return Api.get<Performance>('/api/sales-team/performance');
  }

  static peekPerformance(): Performance | null {
    return Api.peek<Performance>('/api/sales-team/performance');
  }

  // ── WhatsApp (the PC 消息中心: services/inbox-service.ts, services/whatsapp-message-service.ts) ──
  /** filter: all | unread | awaiting. */
  static conversations(filter: string, q: string, page: number): Promise<ConversationPage> {
    return Api.get<ConversationPage>('/api/inbox/conversations', conversationsQuery(filter, q, page));
  }

  static peekConversations(filter: string): ConversationPage | null {
    return Api.peek<ConversationPage>('/api/inbox/conversations', conversationsQuery(filter, '', 1));
  }

  /** Newest 50 messages (oldest first); `before` = nextCursor for the 50 before them. */
  static thread(customerId: string, before: string): Promise<Thread> {
    return Api.get<Thread>('/api/inbox/thread', threadQuery(customerId, before));
  }

  static peekThread(customerId: string): Thread | null {
    return Api.peek<Thread>('/api/inbox/thread', threadQuery(customerId, ''));
  }

  /** Free text inside the 24-hour window. requestId makes a retried send idempotent on the server. */
  static sendWhatsApp(customerId: string, content: string, requestId: string): Promise<SentMessage> {
    const body: SendBody = { customerId: customerId, content: content, requestId: requestId };
    return Api.post<SentMessage>('/api/whatsapp/send', body);
  }

  static newRequestId(): string {
    return util.generateRandomUUID(false);
  }

  /** Approved templates for this customer, with variables filled from the customer record and a suggested greeting. */
  static templates(customerId: string): Promise<TemplateList> {
    const query: Record<string, string> = { 'customerId': customerId };
    return Api.get<TemplateList>('/api/whatsapp/templates', query);
  }

  /**
   * Starts (or restarts) a conversation outside the 24-hour window. The server applies the PC rules: approved
   * templates only, every variable filled, a gap between unanswered touches, never after the customer said stop.
   */
  static sendTemplate(customerId: string, templateId: string, params: string[], requestId: string): Promise<TemplateSent> {
    const body: TemplateBody = { customerId: customerId, templateId: templateId, params: params, requestId: requestId };
    return Api.post<TemplateSent>('/api/whatsapp/templates', body);
  }

  static markRead(customerId: string): Promise<EmptyBody> {
    const body: ReadBody = { customerId: customerId, readAt: new Date().toISOString() };
    return Api.post<EmptyBody>('/api/whatsapp/read', body);
  }

  /** queue: today | new | waiting | high | recent. */
  static queue(queue: string, q: string, page: number): Promise<SalesQueue> {
    return Api.get<SalesQueue>('/api/bos/sales', queueQuery(queue, q, page));
  }

  static peekQueue(queue: string): SalesQueue | null {
    return Api.peek<SalesQueue>('/api/bos/sales', queueQuery(queue, '', 1));
  }

  /** Leads waiting in the assignment pool (administrators). */
  static pool(q: string): Promise<CustomerListPage> {
    return Api.get<CustomerListPage>('/api/customers', poolQuery(q));
  }

  static peekPool(): CustomerListPage | null {
    return Api.peek<CustomerListPage>('/api/customers', poolQuery(''));
  }

  static customer(id: string): Promise<CustomerDetail> {
    return Api.get<CustomerDetail>(`/api/customers/${encodeURIComponent(id)}`);
  }

  static peekCustomer(id: string): CustomerDetail | null {
    return Api.peek<CustomerDetail>(`/api/customers/${encodeURIComponent(id)}`);
  }

  /** Same compare-and-swap rule as the PC kanban: fromStage must still be the current stage. */
  static moveStage(customerId: string, fromStage: string, toStage: string, reason: string): Promise<StageResult> {
    const body: StageBody = { customerId: customerId, fromStage: fromStage, toStage: toStage, reason: reason };
    return Api.patch<StageResult>('/api/bos/crm-stage', body);
  }

  static addFollowUp(id: string, body: FollowUpBody): Promise<EmptyBody> {
    return Api.post<EmptyBody>(`/api/customers/${encodeURIComponent(id)}/followups`, body);
  }

  /** tab: ALL | PENDING_PAYMENT | PRODUCING | SHIPPED | IN_TRANSIT | COMPLETED | CANCELLED. */
  static orders(tab: string, q: string, page: number): Promise<OrderListPage> {
    return Api.get<OrderListPage>('/api/orders', ordersQuery(tab, q, page));
  }

  static peekOrders(tab: string): OrderListPage | null {
    return Api.peek<OrderListPage>('/api/orders', ordersQuery(tab, '', 1));
  }

  static order(id: string): Promise<OrderDetail> {
    return Api.get<OrderDetail>(`/api/orders/${encodeURIComponent(id)}`);
  }

  static peekOrder(id: string): OrderDetail | null {
    return Api.peek<OrderDetail>(`/api/orders/${encodeURIComponent(id)}`);
  }

  /** view: TODAY | OVERDUE | (empty = all); status: OPEN | DONE | ALL. */
  static tasks(view: string, status: string): Promise<TaskListPage> {
    return Api.get<TaskListPage>('/api/tasks', tasksQuery(view, status));
  }

  static peekTasks(view: string, status: string): TaskListPage | null {
    return Api.peek<TaskListPage>('/api/tasks', tasksQuery(view, status));
  }

  static todayTasks(): Promise<TaskListPage> {
    return Repo.tasks('TODAY', 'OPEN');
  }

  static overdueTasks(): Promise<TaskListPage> {
    return Repo.tasks('OVERDUE', '');
  }

  static completeTask(id: string): Promise<EmptyBody> {
    const body: EmptyBody = {};
    return Api.post<EmptyBody>(`/api/tasks/${encodeURIComponent(id)}/complete`, body);
  }
}
