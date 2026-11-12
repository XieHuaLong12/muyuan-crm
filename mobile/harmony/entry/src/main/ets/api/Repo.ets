import { util } from '@kit.ArkTS';
import { http } from '@kit.NetworkKit';
import { Api } from './Http';
import { Session } from './Session';
import {
  AppVersion, AssignBody, CancelBody, Cockpit, CreatedCustomer, Done, MilestoneBody, MilestoneResult, NewCustomerBody,
  PasswordBody, Quotation, SalesAccount, SeenBody, SeenState, TaskBody, TaskPatch, TaskRow,
  AiReply, AiReplyBody, AttachBody, AttachItem, AttachResult, MaterialPicker, MediaAsset, PolishBody, PolishResult,
  QuickReplyList, TranslateBatch, TranslateBatchBody, TranslateBody, TranslateOut, TranslateOutBody, Translation,
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
    await Session.rememberUserId(user.id);
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
    await Session.rememberUserId(boot.user.id);
    return boot;
  }

  static notifications(): Promise<NotificationFeed> {
    return Api.get<NotificationFeed>('/api/notifications');
  }

  static peekNotifications(): NotificationFeed | null {
    return Api.peek<NotificationFeed>('/api/notifications');
  }

  /** This month: revenue, deals, target completion (sales: own row; administrators: every salesperson + company). */
  /** month: 'YYYY-MM', or '' for the current month. */
  static performance(month: string = ''): Promise<Performance> {
    const query: Record<string, string> = { 'month': month };
    return Api.get<Performance>('/api/sales-team/performance', query);
  }

  static peekPerformance(month: string = ''): Performance | null {
    const query: Record<string, string> = { 'month': month };
    return Api.peek<Performance>('/api/sales-team/performance', query);
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

  /**
   * Free text inside the 24-hour window. requestId makes a retried send idempotent on the server; original is the
   * Chinese the text was translated or drafted from, kept with the message as on the PC.
   */
  static sendWhatsApp(customerId: string, content: string, requestId: string, original: string = ''): Promise<SentMessage> {
    const body: SendBody = { customerId: customerId, content: content, requestId: requestId };
    if (original.length > 0) {
      body.original = original;
    }
    return Api.post<SentMessage>('/api/whatsapp/send', body);
  }

  /** A picture or file already uploaded for this customer, through the normal send (window, opt-out, records). */
  static sendMedia(customerId: string, assetId: string, requestId: string): Promise<SentMessage> {
    const body: SendBody = { customerId: customerId, content: '', requestId: requestId, mediaAssetId: assetId };
    return Api.post<SentMessage>('/api/whatsapp/send', body, 60000);
  }

  /** Stores a picture or file for this customer (≤ 20 MB, the server's allowed types); send it with sendMedia. */
  static uploadMedia(customerId: string, fileName: string, mimeType: string, data: ArrayBuffer): Promise<MediaAsset> {
    const file: http.MultiFormData = { name: 'file', contentType: mimeType, remoteFileName: fileName, data: data };
    const owner: http.MultiFormData = { name: 'customerId', contentType: 'text/plain', data: customerId };
    return Api.upload<MediaAsset>('/api/whatsapp/media', [file, owner]);
  }

  // ── Chat assistants (the PC chat's AI 回复 / 优化话术 / 翻译; nothing is sent by these) ──
  /** A reply drafted from the conversation; `previous` asks for a different one. */
  static aiReply(customerId: string, previous: string): Promise<AiReply> {
    const body: AiReplyBody = { customerId: customerId };
    if (previous.length > 0) {
      body.previous = previous;
    }
    return Api.post<AiReply>('/api/whatsapp/ai-reply', body, 100000);
  }

  /** Three better ways to say what is in the input box; `avoid` = the versions already shown (换一批). */
  static polish(customerId: string, text: string, avoid: string[]): Promise<PolishResult> {
    const body: PolishBody = { customerId: customerId, text: text, avoid: avoid };
    return Api.post<PolishResult>('/api/inbox/polish', body, 100000);
  }

  /** The salesperson's Chinese in the customer's language, for the input box. */
  static translateOut(customerId: string, text: string): Promise<TranslateOut> {
    const body: TranslateOutBody = { customerId: customerId, text: text };
    return Api.post<TranslateOut>('/api/inbox/translate-out', body, 60000);
  }

  /** Chinese of one customer message (stored, so everyone sees it next time). */
  static translate(messageId: string): Promise<Translation> {
    const body: TranslateBody = { messageId: messageId };
    return Api.post<Translation>('/api/inbox/translate', body, 60000);
  }

  /** Chinese of up to 10 messages at once (the chat's automatic translation). */
  static translateBatch(customerId: string, messageIds: string[]): Promise<TranslateBatch> {
    const body: TranslateBatchBody = { customerId: customerId, messageIds: messageIds };
    return Api.post<TranslateBatch>('/api/inbox/translate-batch', body, 90000);
  }

  static quickReplies(customerId: string): Promise<QuickReplyList> {
    const query: Record<string, string> = { 'customerId': customerId };
    return Api.get<QuickReplyList>('/api/quick-replies', query);
  }

  static peekQuickReplies(customerId: string): QuickReplyList | null {
    const query: Record<string, string> = { 'customerId': customerId };
    return Api.peek<QuickReplyList>('/api/quick-replies', query);
  }

  /** 产品资料: library files (customer's language first), product photos, files I sent recently. */
  static materials(customerId: string, q: string): Promise<MaterialPicker> {
    const query: Record<string, string> = { 'customerId': customerId, 'q': q };
    return Api.get<MaterialPicker>('/api/inbox/materials', query);
  }

  /** Copies chosen library items into the customer's attachments (≤ 10); each is then sent with sendMedia. */
  static attachMaterials(customerId: string, items: AttachItem[]): Promise<AttachResult> {
    const body: AttachBody = { customerId: customerId, items: items };
    return Api.post<AttachResult>('/api/inbox/materials', body, 60000);
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

  static createTask(body: TaskBody): Promise<TaskRow> {
    return Api.post<TaskRow>('/api/tasks', body);
  }

  /** 改期 / 重新打开 / 改优先级. */
  static updateTask(id: string, patch: TaskPatch): Promise<TaskRow> {
    return Api.patch<TaskRow>(`/api/tasks/${encodeURIComponent(id)}`, patch);
  }

  static deleteTask(id: string): Promise<EmptyBody> {
    return Api.del<EmptyBody>(`/api/tasks/${encodeURIComponent(id)}`);
  }

  // ── Orders and quotations ──
  /** Moves the order to a stage; expectedUpdatedAt stops two people overwriting each other. */
  static orderMilestone(id: string, status: string, expectedUpdatedAt: string): Promise<MilestoneResult> {
    const body: MilestoneBody = { status: status, expectedUpdatedAt: expectedUpdatedAt };
    return Api.patch<MilestoneResult>(`/api/orders/${encodeURIComponent(id)}`, body);
  }

  static cancelOrder(id: string, reason: string, expectedUpdatedAt: string): Promise<EmptyBody> {
    const body: CancelBody = { reason: reason, expectedUpdatedAt: expectedUpdatedAt };
    return Api.post<EmptyBody>(`/api/orders/${encodeURIComponent(id)}/cancel`, body);
  }

  static quotations(customerId: string): Promise<Quotation[]> {
    const query: Record<string, string> = { 'customerId': customerId };
    return Api.get<Quotation[]>('/api/quotations', query);
  }

  static peekQuotations(customerId: string): Quotation[] | null {
    const query: Record<string, string> = { 'customerId': customerId };
    return Api.peek<Quotation[]>('/api/quotations', query);
  }

  // ── Customers: create, filter, assign, delete ──
  /** forceDuplicate: administrators only, after the server listed the existing customers with the same contact. */
  static createCustomer(body: NewCustomerBody): Promise<CreatedCustomer> {
    return Api.post<CreatedCustomer>('/api/customers', body);
  }

  /** The PC customer list with filters (stage, source, grade, sort); pageSize 50. */
  static customers(filters: Record<string, string>, page: number): Promise<CustomerListPage> {
    const query: Record<string, string> = { 'pageSize': '50', 'page': `${page}` };
    Object.keys(filters).forEach((key: string) => {
      query[key] = filters[key];
    });
    return Api.get<CustomerListPage>('/api/customers', query);
  }

  static salesAccounts(): Promise<SalesAccount[]> {
    return Api.get<SalesAccount[]>('/api/sales-team/accounts');
  }

  static assign(ids: string[], ownerId: string, reason: string): Promise<EmptyBody> {
    const body: AssignBody = { ids: ids, ownerId: ownerId, reason: reason };
    return Api.post<EmptyBody>('/api/customers/assign', body);
  }

  static deleteCustomer(id: string): Promise<EmptyBody> {
    return Api.del<EmptyBody>(`/api/customers/${encodeURIComponent(id)}`);
  }

  // ── Server additions for the app ──
  /** range: today | week | month | quarter | year, or custom with startDate / endDate (YYYY-MM-DD, not after today). */
  static cockpit(range: string, startDate: string = '', endDate: string = ''): Promise<Cockpit> {
    const query: Record<string, string> = { 'range': range, 'startDate': startDate, 'endDate': endDate };
    return Api.get<Cockpit>('/api/bos/cockpit', query);
  }

  static peekCockpit(range: string, startDate: string = '', endDate: string = ''): Cockpit | null {
    const query: Record<string, string> = { 'range': range, 'startDate': startDate, 'endDate': endDate };
    return Api.peek<Cockpit>('/api/bos/cockpit', query);
  }

  static notificationsSeen(): Promise<SeenState> {
    return Api.get<SeenState>('/api/notifications/seen');
  }

  static markNotificationsSeen(at: string): Promise<SeenState> {
    const body: SeenBody = { seenAt: at };
    return Api.put<SeenState>('/api/notifications/seen', body);
  }

  static appVersion(): Promise<AppVersion> {
    const query: Record<string, string> = { 'platform': 'harmony' };
    return Api.get<AppVersion>('/api/app/version', query);
  }

  /** The server signs this device in again (new cookie); other devices keep working until 退出其他设备. */
  static changePassword(currentPassword: string, newPassword: string): Promise<Done> {
    const body: PasswordBody = { currentPassword: currentPassword, newPassword: newPassword };
    return Api.post<Done>('/api/auth/password', body);
  }

  static signOutOtherDevices(): Promise<Done> {
    const body: EmptyBody = {};
    return Api.post<Done>('/api/auth/logout-others', body);
  }

  static completeTask(id: string): Promise<EmptyBody> {
    const body: EmptyBody = {};
    return Api.post<EmptyBody>(`/api/tasks/${encodeURIComponent(id)}/complete`, body);
  }
}
