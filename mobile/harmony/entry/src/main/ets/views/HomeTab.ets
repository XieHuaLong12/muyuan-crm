import { RouteParam, Routes, StoreKeys } from '../common/Config';
import { Fmt, DueLabel } from '../common/Format';
import { Api } from '../api/Http';
import { Inbox } from '../api/Inbox';
import { Repo } from '../api/Repo';
import { Session } from '../api/Session';
import {
  Cockpit, CockpitSuggestion, QueueCustomer, TrendPoint, CompanyTotals, NotificationFeed, OrderListPage, OrderReminders, Performance, PerformanceRow, QueueCount, SalesQueue,
  TaskListPage, TaskRow
} from '../api/Models';
import { LvIcon } from '../components/LvIcon';
import { Avatar, SectionHead, StatTile, StateView } from '../components/Ui';
import { BarChart } from '../components/BarChart';
import { TaskEditor } from './task/TaskEditor';

/** One section of the page: a failure is noted and the other sections still load. */
async function attempt<T>(name: string, call: Promise<T>, failures: string[]): Promise<T | null> {
  try {
    return await call;
  } catch (e) {
    failures.push(`${name}：${Api.message(e)}`);
    return null;
  }
}

/**
 * 工作台. Everything here comes from endpoints BOS already has:
 *   today's work and queue counts  GET /api/bos/sales   (same numbers as the PC 「今日跟进」)
 *   pool / first contact / badges  GET /api/notifications
 *   order reminders                GET /api/orders      (待付款 / 待发货 / 物流异常 / 待收尾款)
 *   my tasks                       GET /api/tasks?view=TODAY and OVERDUE
 *   this month's revenue / target  GET /api/sales-team/performance (same numbers as the PC 销售业绩)
 * Every section shows its last answer at once (Api cache) and refreshes underneath.
 */
@Component
export struct HomeTab {
  @Consume('pathStack') pathStack: NavPathStack;
  @StorageProp('userName') userName: string = '';
  @StorageProp('userRole') userRole: string = '';
  @State state: string = 'loading';
  @State error: string = '';
  @State refreshing: boolean = false;
  @State feed: NotificationFeed | null = null;
  @State counts: QueueCount[] = [];
  @State reminders: OrderReminders | null = null;
  @State tasks: TaskRow[] = [];
  @State updatedAt: string = '';
  /** Sections that did not load this time; the rest of the page still shows. */
  @State warning: string = '';
  @State performance: Performance | null = null;
  @State cockpit: Cockpit | null = null;
  @State waitingList: QueueCustomer[] = [];
  /** Bumped on every new snapshot: the page body is rebuilt with it (builder parameters do not refresh). */
  @State rev: number = 0;
  @State showTask: boolean = false;
  @StorageProp('dataChanged') @Watch('onDataChanged') dataChanged: number = 0;

  onDataChanged(): void {
    this.load();
  }

  aboutToAppear(): void {
    this.showCached();
    this.load();
  }

  /** Last known numbers, so the page is never blank while the network answers. */
  private showCached(): void {
    const feed = Repo.peekNotifications();
    const queue = Repo.peekQueue('waiting');
    const orders = Repo.peekOrders('ALL');
    const today = Repo.peekTasks('TODAY', 'OPEN');
    const late = Repo.peekTasks('OVERDUE', '');
    const performance = Repo.peekPerformance();
    const cockpit = Repo.peekCockpit('month');
    if (cockpit !== null) {
      this.cockpit = cockpit;
    }
    if (feed === null && queue === null && orders === null && today === null && late === null && performance === null) {
      return;
    }
    this.apply(feed, queue, orders, today, late, performance);
    this.state = 'ready';
  }

  private apply(feed: NotificationFeed | null, queue: SalesQueue | null, orders: OrderListPage | null,
    today: TaskListPage | null, late: TaskListPage | null, performance: Performance | null): void {
    if (feed !== null) {
      this.feed = feed;
      Inbox.lastFeed = feed;
      Inbox.applyBadges(feed);
    }
    if (queue !== null) {
      this.counts = queue.counts;
      this.waitingList = queue.customers.slice(0, 3);
    }
    if (orders !== null) {
      this.reminders = orders.reminders;
    }
    if (performance !== null) {
      this.performance = performance;
    }
    if (today !== null || late !== null) {
      let all: TaskRow[] = [];
      if (late !== null) {
        all = all.concat(late.tasks);
      }
      if (today !== null) {
        all = all.concat(today.tasks);
      }
      const seen: string[] = [];
      const merged: TaskRow[] = [];
      all.forEach((t: TaskRow) => {
        if (t.status !== 'DONE' && seen.indexOf(t.id) < 0) {
          seen.push(t.id);
          merged.push(t);
        }
      });
      this.tasks = merged;
    }
    this.rev++;
  }

  private async load(): Promise<void> {
    const failures: string[] = [];
    const performanceCall = attempt<Performance>('本月业绩', Repo.performance(), failures);
    const feedCall = attempt<NotificationFeed>('提醒', Repo.notifications(), failures);
    // The 等你回复 queue answers with every queue's count too, so one call fills both the numbers and the list.
    const queueCall = attempt<SalesQueue>('跟进队列', Repo.queue('waiting', '', 1), failures);
    // Optional extras (reminders, trend): a server without GET /api/bos/cockpit yet just leaves them out.
    const optional: string[] = [];
    const cockpitCall = attempt<Cockpit>('经营提醒', Repo.cockpit('month'), optional);
    const ordersCall = attempt<OrderListPage>('订单', Repo.orders('ALL', '', 1), failures);
    const todayCall = attempt<TaskListPage>('今日待办', Repo.todayTasks(), failures);
    const lateCall = attempt<TaskListPage>('逾期待办', Repo.overdueTasks(), failures);
    const feed = await feedCall;
    const queue = await queueCall;
    const orders = await ordersCall;
    const today = await todayCall;
    const late = await lateCall;
    const performance = await performanceCall;
    const cockpit = await cockpitCall;
    if (cockpit !== null) {
      this.cockpit = cockpit;
    }
    try {
      this.apply(feed, queue, orders, today, late, performance);
    } catch (e) {
      failures.push(`显示：${Api.message(e)}`);
    }
    this.refreshing = false;
    if (feed === null && queue === null && orders === null && today === null && late === null && performance === null) {
      this.error = failures.join('\n');
      if (this.state !== 'ready') {
        this.state = 'error';
      } else {
        this.toast(failures.length > 0 ? failures[0] : '加载失败');
      }
      return;
    }
    this.warning = failures.join('\n');
    this.updatedAt = Fmt.time(new Date());
    this.state = 'ready';
  }

  @Builder
  warningCard() {
    Row({ space: 10 }) {
      LvIcon({ name: 'circle-alert', iconColor: $r('app.color.warning'), iconSize: 18 })
      Column({ space: 3 }) {
        Text('部分数据没有加载出来，点这里重试').fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        Text(this.warning).fontSize(12).fontColor($r('app.color.ink2')).lineHeight(18)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .padding(12)
    .borderRadius(16)
    .backgroundColor($r('app.color.surface'))
    .border({ width: 1, color: $r('app.color.warning') })
    .onClick(() => {
      this.refreshing = true;
      this.load();
    })
  }

  private count(key: string): number {
    const found = this.counts.find((c: QueueCount): boolean => c.key === key);
    return found === undefined ? 0 : found.count;
  }

  private orderWork(): number {
    const r = this.reminders;
    return r === null ? 0 : r.pendingPayment + r.pendingShipment + r.shippingException;
  }

  private openQueue(queue: string): void {
    AppStorage.setOrCreate<string>(StoreKeys.CUSTOMERS_QUEUE, queue);
    AppStorage.setOrCreate<number>(StoreKeys.CURRENT_TAB, 1);
  }

  private toast(message: string): void {
    this.getUIContext().getPromptAction().showToast({ message: message, duration: 2000 });
  }

  private async complete(task: TaskRow): Promise<void> {
    try {
      await Repo.completeTask(task.id);
      this.tasks = this.tasks.filter((t: TaskRow): boolean => t.id !== task.id);
      this.toast(`已完成：${task.title}`);
    } catch (e) {
      this.toast(Api.message(e));
    }
  }

  @Builder
  alertCard(title: string, text: string, queue: string) {
    Row({ space: 12 }) {
      Row() {
        LvIcon({ name: 'bell', iconColor: Color.White, iconSize: 18 })
      }
      .width(36).height(36).borderRadius(11).justifyContent(FlexAlign.Center).backgroundColor($r('app.color.danger'))

      Column({ space: 2 }) {
        Text(title).fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.danger'))
        Text(text).fontSize(13).fontColor($r('app.color.ink2')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      LvIcon({ name: 'chevron-right', iconColor: $r('app.color.danger'), iconSize: 18 })
    }
    .width('100%')
    .padding(12)
    .borderRadius(16)
    .backgroundColor($r('app.color.danger_bg'))
    .onClick(() => this.openQueue(queue))
  }

  @Builder
  hero() {
    Column({ space: 10 }) {
      Row() {
        Text(Session.isAdmin() ? '今日需要跟进（全公司）' : '今日需要跟进').fontSize(14).fontColor('#CFE3D8')
        Blank()
        if (this.overdueCount() > 0) {
          Text(Session.isAdmin() ? `首联超时 ${this.overdueCount()}` : `${this.overdueCount()} 位已逾期`)
            .fontSize(12).fontColor(Color.White).backgroundColor('#24FFFFFF')
            .borderRadius(6).padding({ left: 8, right: 8, top: 3, bottom: 3 })
        }
      }
      .width('100%')

      Row({ space: 6 }) {
        Text(`${this.count('today')}`).fontSize(34).fontWeight(FontWeight.Bold).fontColor(Color.White)
        Text('位客户').fontSize(15).fontColor('#CFE3D8').margin({ bottom: 6 })
      }
      .alignItems(VerticalAlign.Bottom)

      Row({ space: 8 }) {
        this.heroSplit(`${this.count('new')}`, '待首联', 'new')
        this.heroSplit(`${this.count('waiting')}`, '等你回复', 'waiting')
        this.heroSplit(`${this.orderWork()}`, '订单待办', '')
      }
      .width('100%')
    }
    .width('100%')
    .padding({ left: 18, right: 18, top: 18, bottom: 16 })
    .borderRadius(20)
    .backgroundColor($r('app.color.brand'))
    .alignItems(HorizontalAlign.Start)
    .onClick(() => this.openQueue('today'))
  }

  @Builder
  heroSplit(value: string, title: string, queue: string) {
    Column({ space: 2 }) {
      Text(value).fontSize(18).fontWeight(FontWeight.Bold).fontColor(Color.White)
      Text(title).fontSize(12).fontColor('#CFE3D8')
    }
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 12, right: 12, top: 10, bottom: 10 })
    .borderRadius(12)
    .backgroundColor('#1AFFFFFF')
    .layoutWeight(1)
    .onClick(() => {
      if (queue.length > 0) {
        this.openQueue(queue);
      } else {
        AppStorage.setOrCreate<number>(StoreKeys.CURRENT_TAB, 2);
      }
    })
  }

  private overdueCount(): number {
    const feed = this.feed;
    if (feed === null) return 0;
    if (Session.isAdmin()) return feed.counts.overdueFirstContact;
    return feed.counts.todayOverdue === undefined ? 0 : feed.counts.todayOverdue;
  }

  @Builder
  taskRow(task: TaskRow) {
    Row({ space: 10 }) {
      Row()
        .width(24).height(24).borderRadius(12)
        .border({ width: 2, color: $r('app.color.ink3') })
        .onClick(() => {
          this.complete(task);
        })

      Column({ space: 3 }) {
        Text(task.title).fontSize(15).fontColor($r('app.color.ink')).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        Row({ space: 10 }) {
          Text(this.dueText(task.dueDate).text)
            .fontSize(12)
            .fontColor(this.dueText(task.dueDate).late ? $r('app.color.danger') : this.dueText(task.dueDate).soon ? $r('app.color.warning') : $r('app.color.ink3'))
            .fontWeight(this.dueText(task.dueDate).late ? FontWeight.Medium : FontWeight.Normal)
          if (task.customer !== null) {
            Text(task.customer.name).fontSize(12).fontColor($r('app.color.ink3'))
          }
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      .onClick(() => {
        if (task.customer !== null) {
          this.pathStack.pushPathByName(Routes.CUSTOMER, new RouteParam(task.customer.id));
        }
      })

      if (task.priority === 'HIGH') {
        Text('高').fontSize(12).fontColor($r('app.color.danger')).backgroundColor($r('app.color.danger_bg'))
          .borderRadius(6).padding({ left: 6, right: 6, top: 2, bottom: 2 })
      }
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: 12, bottom: 12 })
  }

  private dueText(iso: string): DueLabel {
    return Fmt.due(iso);
  }

  /** Sales: their own row. Administrators: the company line. */
  private mine(p: Performance): PerformanceRow | null {
    return p.rows.length > 0 ? p.rows[0] : null;
  }

  private monthTitle(p: Performance): string {
    const month = Number(p.month.slice(5, 7));
    return isNaN(month) || month === 0 ? '本月' : `${month} 月`;
  }

  /** Target completion in percent, or -1 when no target is set. */
  private completion(p: Performance): number {
    if (Session.isAdmin()) {
      const summary = p.targetSummary;
      const company = p.company;
      if (summary === null || summary.company === null || company === null) return -1;
      const target = Number(summary.company);
      return target > 0 ? Math.round(Number(company.revenue) / target * 1000) / 10 : -1;
    }
    const row = this.mine(p);
    return row !== null && row.completion !== null ? row.completion : -1;
  }

  private targetText(p: Performance): string {
    if (Session.isAdmin()) {
      const summary = p.targetSummary;
      return summary !== null && summary.company !== null ? Fmt.money(summary.company, p.currency) : '';
    }
    const row = this.mine(p);
    return row !== null && row.target !== null ? Fmt.money(row.target.amount, p.currency) : '';
  }

  private ranking(p: Performance): PerformanceRow[] {
    return p.rows.filter((r: PerformanceRow): boolean => r.isActive)
      .sort((a: PerformanceRow, b: PerformanceRow): number => Number(b.revenue) - Number(a.revenue))
      .slice(0, 5);
  }

  @Builder
  perfFigure(value: string, title: string) {
    Column({ space: 2 }) {
      Text(value).fontSize(17).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
      Text(title).fontSize(12).fontColor($r('app.color.ink3'))
    }
    .alignItems(HorizontalAlign.Start)
    .layoutWeight(1)
  }

  @Builder
  performanceCard(p: Performance) {
    Column({ space: 12 }) {
      Row({ space: 6 }) {
        LvIcon({ name: 'trending-up', iconColor: $r('app.color.brand_ink'), iconSize: 18 })
        Text(Session.isAdmin() ? `${this.monthTitle(p)}全公司业绩` : `${this.monthTitle(p)}我的业绩`)
          .fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        Blank()
        Text('数据分析').fontSize(13).fontColor($r('app.color.brand_ink'))
        LvIcon({ name: 'chevron-right', iconColor: $r('app.color.brand_ink'), iconSize: 16 })
      }
      .width('100%')
      .onClick(() => {
        this.pathStack.pushPathByName(Routes.ANALYTICS, new RouteParam(''));
      })

      Text(Fmt.money(Session.isAdmin() ? (p.company !== null ? p.company.revenue : '0') : (this.mine(p) !== null ? (this.mine(p) as PerformanceRow).revenue : '0'), p.currency))
        .fontSize(28).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))

      if (this.completion(p) >= 0) {
        Column({ space: 6 }) {
          Stack({ alignContent: Alignment.Start }) {
            Row().width('100%').height(8).borderRadius(4).backgroundColor($r('app.color.surface2'))
            Row().width(`${Math.min(100, this.completion(p))}%`).height(8).borderRadius(4).backgroundColor($r('app.color.brand'))
          }
          .width('100%')
          Text(`目标 ${this.targetText(p)} · 完成 ${this.completion(p)}%`).fontSize(13).fontColor($r('app.color.ink2'))
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
      } else {
        Text(Session.isAdmin() ? '本月还没有设置公司目标（电脑端「目标」里设置）' : '本月还没有设置个人目标').fontSize(13).fontColor($r('app.color.ink3'))
      }

      if (Session.isAdmin() && p.company !== null) {
        Row() {
          this.perfFigure(`${(p.company as CompanyTotals).deals}`, '成交单数')
          this.perfFigure(`${(p.company as CompanyTotals).newCustomers}`, '新客户')
          this.perfFigure(`${(p.company as CompanyTotals).qualified}`, '有效客户')
        }
        .width('100%')
      } else if (this.mine(p) !== null) {
        Row() {
          this.perfFigure(`${(this.mine(p) as PerformanceRow).deals}`, '成交单数')
          this.perfFigure(`${(this.mine(p) as PerformanceRow).newCustomers}`, '新客户')
          this.perfFigure((this.mine(p) as PerformanceRow).firstContactOnTime !== null ? `${(this.mine(p) as PerformanceRow).firstContactOnTime}%` : '—', '首联准时')
        }
        .width('100%')
      }

      if (Session.isAdmin() && this.ranking(p).length > 0) {
        Column() {
          ForEach(this.ranking(p), (r: PerformanceRow, index: number) => {
            Row({ space: 10 }) {
              Text(`${index + 1}`).fontSize(13).fontWeight(FontWeight.Bold)
                .fontColor(index === 0 ? $r('app.color.brand_ink') : $r('app.color.ink3')).width(16)
              Text(r.name).fontSize(14).fontColor($r('app.color.ink')).layoutWeight(1)
                .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(`${r.deals} 单`).fontSize(13).fontColor($r('app.color.ink3'))
              Text(Fmt.money(r.revenue, p.currency)).fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
              if (r.completion !== null) {
                Text(`${r.completion}%`).fontSize(12).fontColor($r('app.color.brand_ink'))
              }
            }
            .width('100%')
            .padding({ top: 8, bottom: 8 })
            .border({ width: { top: index === 0 ? 0 : 0.5 }, color: $r('app.color.line_soft') })
          }, (r: PerformanceRow): string => r.id)
        }
        .width('100%')
        .padding({ top: 4 })
        .border({ width: { top: 0.5 }, color: $r('app.color.line_soft') })
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(16)
    .borderRadius(16)
    .backgroundColor($r('app.color.surface'))
  }

  /** 重要提醒 beyond the lead alerts: logistics exceptions and the cockpit's warnings (overdue tasks, stalled quotes). */
  private important(): CockpitSuggestion[] {
    const list: CockpitSuggestion[] = [];
    const r = this.reminders;
    if (r !== null && r.shippingException > 0) {
      const s: CockpitSuggestion = { kind: 'warning', title: `物流异常 ${r.shippingException} 单`, detail: '预计到货已过还没签收，联系货代确认。', href: 'orders' };
      list.push(s);
    }
    const c = this.cockpit;
    if (c !== null) {
      c.suggestions.forEach((item: CockpitSuggestion) => {
        if (item.kind === 'warning') {
          list.push(item);
        }
      });
    }
    return list.slice(0, 3);
  }

  private openSuggestion(item: CockpitSuggestion): void {
    if (item.href === 'orders') {
      AppStorage.setOrCreate<number>(StoreKeys.CURRENT_TAB, 2);
    } else if (item.href.startsWith('/tasks')) {
      this.pathStack.pushPathByName(Routes.TASKS, new RouteParam(''));
    } else if (item.href.startsWith('/sales') || item.href.startsWith('/crm')) {
      this.openQueue('today');
    } else {
      this.pathStack.pushPathByName(Routes.ANALYTICS, new RouteParam(''));
    }
  }

  private trendValues(): number[] {
    const c = this.cockpit;
    return c === null ? [] : c.trend.points.map((p: TrendPoint): number => p.revenue);
  }

  private trendTotal(): number {
    const c = this.cockpit;
    return c === null ? 0 : c.kpis.periodRevenue;
  }

  @Builder
  importantList() {
    Column() {
      ForEach(this.important(), (item: CockpitSuggestion, index: number) => {
        Row({ space: 12 }) {
          Row() {
            LvIcon({ name: item.href === 'orders' ? 'truck' : 'triangle-alert', iconColor: $r('app.color.warning'), iconSize: 18 })
          }
          .width(34).height(34).borderRadius(10).justifyContent(FlexAlign.Center).backgroundColor($r('app.color.warning_bg'))
          Column({ space: 2 }) {
            Text(item.title).fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
            Text(item.detail).fontSize(12).fontColor($r('app.color.ink3')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          LvIcon({ name: 'chevron-right', iconColor: $r('app.color.ink3'), iconSize: 18 })
        }
        .width('100%')
        .padding({ left: 14, right: 14, top: 12, bottom: 12 })
        .border({ width: { top: index === 0 ? 0 : 0.5 }, color: $r('app.color.line_soft') })
        .onClick(() => this.openSuggestion(item))
      }, (item: CockpitSuggestion): string => item.title)
    }
    .width('100%')
    .borderRadius(16)
    .backgroundColor($r('app.color.surface'))
  }

  @Builder
  quickAction(icon: string, title: string, action: () => void) {
    Column({ space: 6 }) {
      Row() {
        LvIcon({ name: icon, iconColor: $r('app.color.brand_ink'), iconSize: 21 })
      }
      .width(46).height(46).borderRadius(14).justifyContent(FlexAlign.Center).backgroundColor($r('app.color.surface'))
      Text(title).fontSize(12).fontColor($r('app.color.ink2'))
    }
    .layoutWeight(1)
    .onClick(() => action())
  }

  @Builder
  quickActions() {
    Row() {
      this.quickAction('user-plus', '新建客户', () => {
        this.pathStack.pushPathByName(Routes.NEW_CUSTOMER, new RouteParam(''));
      })
      this.quickAction('list-todo', '新建任务', () => {
        this.showTask = true;
      })
      this.quickAction('pencil', '写跟进', () => this.openQueue('today'))
      this.quickAction('message-circle', 'WhatsApp', () => {
        AppStorage.setOrCreate<number>(StoreKeys.CURRENT_TAB, 3);
      })
    }
    .width('100%')
  }

  @Builder
  waitingCard() {
    Column({ space: 8 }) {
      SectionHead({ title: '客户在等你回复', sub: `${this.count('waiting')} 位`, link: '全部', onLink: () => this.openQueue('waiting') })
      Column() {
        ForEach(this.waitingList, (c: QueueCustomer, index: number) => {
          Row({ space: 12 }) {
            Avatar({ name: c.name, grade: c.leadGrade, avatarSize: 40 })
            Column({ space: 2 }) {
              Text(c.name).fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
                .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(c.reasons.length > 0 ? c.reasons.join(' · ') : `${c.country} · 最近来信 ${Fmt.ago(c.lastInboundAt)}`)
                .fontSize(12).fontColor($r('app.color.ink3')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)
            Text('回复').fontSize(13).fontColor($r('app.color.on_brand')).backgroundColor($r('app.color.brand'))
              .borderRadius(14).height(28).padding({ left: 12, right: 12 })
          }
          .width('100%')
          .padding({ left: 14, right: 14, top: 10, bottom: 10 })
          .border({ width: { top: index === 0 ? 0 : 0.5 }, color: $r('app.color.line_soft') })
          .onClick(() => {
            this.pathStack.pushPathByName(Routes.CHAT, new RouteParam(c.id));
          })
        }, (c: QueueCustomer): string => c.id)
      }
      .width('100%')
      .borderRadius(16)
      .backgroundColor($r('app.color.surface'))
    }
  }

  @Builder
  trendCard() {
    Column({ space: 10 }) {
      Row() {
        Text(Session.isAdmin() ? '本月成交趋势（全公司）' : '本月我的成交趋势').fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).layoutWeight(1)
        Text(Fmt.money(this.trendTotal(), this.cockpit !== null ? (this.cockpit as Cockpit).currency : 'CNY'))
          .fontSize(15).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
      }
      .width('100%')
      BarChart({
        values: this.trendValues(),
        startLabel: this.cockpit !== null && (this.cockpit as Cockpit).trend.points.length > 0 ? (this.cockpit as Cockpit).trend.points[0].label : '',
        endLabel: this.cockpit !== null && (this.cockpit as Cockpit).trend.points.length > 0
          ? (this.cockpit as Cockpit).trend.points[(this.cockpit as Cockpit).trend.points.length - 1].label : '',
        chartHeight: 90,
        highlightLast: true
      })
    }
    .width('100%')
    .padding(16)
    .borderRadius(16)
    .backgroundColor($r('app.color.surface'))
    .onClick(() => {
      this.pathStack.pushPathByName(Routes.ANALYTICS, new RouteParam(''));
    })
  }

  @Builder
  content() {
    Column({ space: 20 }) {
      if (this.warning.length > 0) {
        this.warningCard()
      }
      if (this.feed !== null && Session.isAdmin() && this.feed.counts.pool > 0) {
        this.alertCard(`${this.feed.counts.pool} 条线索待分配`, `最早进入：${Fmt.ago(this.feed.counts.poolOldestAt)}`, 'pool')
      }
      if (this.feed !== null && !Session.isAdmin() && this.feed.counts.pendingFirstContact > 0) {
        this.alertCard(`${this.feed.counts.pendingFirstContact} 位新客户待首次联系`, this.feed.counts.overdueFirstContact > 0 ? `其中 ${this.feed.counts.overdueFirstContact} 位已超时` : '请尽快联系', 'new')
      }

      if (this.important().length > 0) {
        this.importantList()
      }

      this.hero()

      this.quickActions()

      Column({ space: 10 }) {
        Row({ space: 10 }) {
          StatTile({ label: '待首联', icon: 'timer', value: `${this.count('new')}`, foot: '分配后还没联系', onTap: () => this.openQueue('new') })
          StatTile({ label: '等你回复', icon: 'message-circle', value: `${this.count('waiting')}`, foot: '客户发来消息还没回', footWarn: this.count('waiting') > 0, onTap: () => this.openQueue('waiting') })
        }
        Row({ space: 10 }) {
          StatTile({
            label: '待处理订单', icon: 'package', value: `${this.orderWork()}`,
            foot: this.reminders === null ? '' : `待付款 ${this.reminders.pendingPayment} · 异常 ${this.reminders.shippingException}`,
            footWarn: this.reminders !== null && this.reminders.shippingException > 0,
            onTap: () => AppStorage.setOrCreate<number>(StoreKeys.CURRENT_TAB, 2)
          })
          StatTile({ label: '高意向', icon: 'sparkles', value: `${this.count('high')}`, foot: 'AI 评分 80 以上', onTap: () => this.openQueue('high') })
        }
      }

      if (this.waitingList.length > 0) {
        this.waitingCard()
      }

      Column({ space: 8 }) {
        SectionHead({ title: '我的待办', sub: '今天与逾期', link: '全部', onLink: () => {
          this.pathStack.pushPathByName(Routes.TASKS, new RouteParam(''));
        } })
        if (this.tasks.length === 0) {
          Text('今天的待办都完成了').fontSize(14).fontColor($r('app.color.ink3'))
            .width('100%').textAlign(TextAlign.Center).padding(20)
            .backgroundColor($r('app.color.surface')).borderRadius(16)
        } else {
          Column() {
            ForEach(this.tasks.slice(0, 6), (task: TaskRow, index: number) => {
              if (index > 0) {
                Divider().color($r('app.color.line_soft')).margin({ left: 48 })
              }
              this.taskRow(task)
            }, (task: TaskRow): string => task.id)
          }
          .backgroundColor($r('app.color.surface'))
          .borderRadius(16)
        }
      }

      if (this.cockpit !== null && (this.cockpit as Cockpit).trend.points.length > 1) {
        this.trendCard()
      }

      if (this.performance !== null) {
        this.performanceCard(this.performance as Performance)
      }
    }
    .padding({ left: 16, right: 16 })
  }

  build() {
    Refresh({ refreshing: $$this.refreshing }) {
      Scroll() {
        Column({ space: 14 }) {
          Column({ space: 2 }) {
            Text(`${Fmt.greeting()}，${this.userName}`).fontSize(24).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
            Text(`${Fmt.today()} · ${Session.isAdmin() ? '全公司' : '我的客户'}${this.updatedAt.length > 0 ? ` · 数据截至 ${this.updatedAt}` : ''}`)
              .fontSize(13).fontColor($r('app.color.ink3'))
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
          .padding({ left: 16, right: 16, top: 16 })

          if (this.state === 'ready') {
            // One item per data snapshot: refreshed numbers rebuild the cards (builder parameters do not refresh).
            ForEach([this.rev], (r: number) => {
              this.content()
            }, (r: number): string => `${r}`)
          } else if (this.state === 'error') {
            StateView({ kind: 'error', message: this.error, actionText: '重新加载', onAction: () => {
              this.state = 'loading';
              this.load();
            } })
          } else {
            StateView({ kind: 'loading' })
          }
        }
        .padding({ bottom: 24 })
      }
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
      .height('100%')
    }
    .onRefreshing(() => {
      this.load();
    })
    .backgroundColor($r('app.color.bg'))
    .bindSheet($$this.showTask, this.taskSheet(), { detents: [SheetSize.LARGE], dragBar: true })
  }

  @Builder
  taskSheet() {
    TaskEditor({
      task: null,
      onDone: () => {
        this.showTask = false;
        this.load();
      },
      onClose: () => {
        this.showTask = false;
      }
    })
  }
}
