import { RouteParam, Routes, StoreKeys } from '../common/Config';
import { Fmt, DueLabel } from '../common/Format';
import { Api } from '../data/Http';
import { Inbox } from '../data/Inbox';
import { Repo } from '../data/Repo';
import { Session } from '../data/Session';
import { NotificationFeed, OrderReminders, QueueCount, TaskRow } from '../data/Models';
import { LvIcon } from '../components/LvIcon';
import { SectionHead, StatTile, StateView } from '../components/Ui';

/**
 * 工作台. Everything here comes from endpoints BOS already has:
 *   today's work and queue counts  GET /api/bos/sales   (same numbers as the PC 「今日跟进」)
 *   pool / first contact / badges  GET /api/notifications
 *   order reminders                GET /api/orders      (待付款 / 待发货 / 物流异常 / 待收尾款)
 *   my tasks                       GET /api/tasks?view=TODAY and OVERDUE
 * Revenue and target need a read-only endpoint on the server first (NATIVE_PLAN §2 S1); the card says so.
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

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    try {
      const feedCall = Repo.notifications();
      const queueCall = Repo.queue('today', '', 1);
      const ordersCall = Repo.orders('ALL', '', 1);
      const todayCall = Repo.todayTasks();
      const lateCall = Repo.overdueTasks();
      const feed = await feedCall;
      const queue = await queueCall;
      const orders = await ordersCall;
      const today = await todayCall;
      const late = await lateCall;
      this.feed = feed;
      Inbox.lastFeed = feed;
      Inbox.applyBadges(feed);
      this.counts = queue.counts;
      this.reminders = orders.reminders;
      const seen: string[] = [];
      const merged: TaskRow[] = [];
      late.tasks.concat(today.tasks).forEach((t: TaskRow) => {
        if (t.status !== 'DONE' && seen.indexOf(t.id) < 0) {
          seen.push(t.id);
          merged.push(t);
        }
      });
      this.tasks = merged;
      this.updatedAt = Fmt.time(new Date());
      this.state = 'ready';
    } catch (e) {
      this.error = Api.message(e);
      if (this.state !== 'ready') {
        this.state = 'error';
      } else {
        this.toast(this.error);
      }
    } finally {
      this.refreshing = false;
    }
  }

  private count(key: string): number {
    const found = this.counts.find((c: QueueCount) => c.key === key);
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
      this.tasks = this.tasks.filter((t: TaskRow) => t.id !== task.id);
      this.toast(`已完成：${task.title}`);
    } catch (e) {
      this.toast(Api.message(e));
    }
  }

  @Builder
  alertCard(title: string, text: string, queue: string) {
    Row({ space: 12 }) {
      Row() {
        LvIcon({ name: 'bell', iconColor: Color.White, size: 18 })
      }
      .width(36).height(36).borderRadius(11).justifyContent(FlexAlign.Center).backgroundColor($r('app.color.danger'))

      Column({ space: 2 }) {
        Text(title).fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.danger'))
        Text(text).fontSize(13).fontColor($r('app.color.ink2')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      LvIcon({ name: 'chevron-right', iconColor: $r('app.color.danger'), size: 18 })
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

  @Builder
  content() {
    Column({ space: 20 }) {
      if (this.feed !== null && Session.isAdmin() && this.feed.counts.pool > 0) {
        this.alertCard(`${this.feed.counts.pool} 条线索待分配`, `最早进入：${Fmt.ago(this.feed.counts.poolOldestAt)}`, 'pool')
      }
      if (this.feed !== null && !Session.isAdmin() && this.feed.counts.pendingFirstContact > 0) {
        this.alertCard(`${this.feed.counts.pendingFirstContact} 位新客户待首次联系`, this.feed.counts.overdueFirstContact > 0 ? `其中 ${this.feed.counts.overdueFirstContact} 位已超时` : '请尽快联系', 'new')
      }

      this.hero()

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

      Column({ space: 8 }) {
        SectionHead({ title: '我的待办', sub: '今天与逾期' })
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
            }, (task: TaskRow) => task.id)
          }
          .backgroundColor($r('app.color.surface'))
          .borderRadius(16)
        }
      }

      Row({ space: 10 }) {
        LvIcon({ name: 'trending-up', iconColor: $r('app.color.ink3'), size: 18 })
        Text('销售额、目标完成和趋势图将在服务端增加经营数据接口后显示（与电脑端驾驶舱同一口径）。')
          .fontSize(13).fontColor($r('app.color.ink3')).layoutWeight(1).lineHeight(20)
      }
      .width('100%')
      .padding(14)
      .borderRadius(16)
      .border({ width: 1, color: $r('app.color.line'), style: BorderStyle.Dashed })
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
            this.content()
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
  }
}
