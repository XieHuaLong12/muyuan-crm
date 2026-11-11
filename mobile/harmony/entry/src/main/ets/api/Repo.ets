import { Api } from './Http';
import { Session } from './Session';
import {
  Bootstrap, CustomerDetail, CustomerListPage, EmptyBody, FollowUpBody, LoginBody, LoginUser, NotificationFeed,
  OrderDetail, OrderListPage, SalesQueue, TaskListPage
} from './Models';

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

  /** queue: today | new | waiting | high | recent. */
  static queue(queue: string, q: string, page: number): Promise<SalesQueue> {
    return Api.get<SalesQueue>('/api/bos/sales', { 'queue': queue, 'q': q, 'page': `${page}` });
  }

  /** Leads waiting in the assignment pool (administrators). */
  static pool(q: string): Promise<CustomerListPage> {
    return Api.get<CustomerListPage>('/api/customers', { 'assign': 'pending', 'q': q, 'pageSize': '50', 'sort': 'priority' });
  }

  static customer(id: string): Promise<CustomerDetail> {
    return Api.get<CustomerDetail>(`/api/customers/${encodeURIComponent(id)}`);
  }

  static addFollowUp(id: string, body: FollowUpBody): Promise<EmptyBody> {
    return Api.post<EmptyBody>(`/api/customers/${encodeURIComponent(id)}/followups`, body);
  }

  /** tab: ALL | PENDING_PAYMENT | PRODUCING | SHIPPED | IN_TRANSIT | COMPLETED | CANCELLED. */
  static orders(tab: string, q: string, page: number): Promise<OrderListPage> {
    return Api.get<OrderListPage>('/api/orders', { 'tab': tab, 'q': q, 'page': `${page}` });
  }

  static order(id: string): Promise<OrderDetail> {
    return Api.get<OrderDetail>(`/api/orders/${encodeURIComponent(id)}`);
  }

  static todayTasks(): Promise<TaskListPage> {
    return Api.get<TaskListPage>('/api/tasks', { 'view': 'TODAY', 'status': 'OPEN' });
  }

  static overdueTasks(): Promise<TaskListPage> {
    return Api.get<TaskListPage>('/api/tasks', { 'view': 'OVERDUE' });
  }

  static completeTask(id: string): Promise<EmptyBody> {
    const body: EmptyBody = {};
    return Api.post<EmptyBody>(`/api/tasks/${encodeURIComponent(id)}/complete`, body);
  }
}
