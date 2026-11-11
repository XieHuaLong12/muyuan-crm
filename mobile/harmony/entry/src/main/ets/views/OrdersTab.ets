import { RouteParam, Routes } from '../common/Config';
import { Fmt } from '../common/Format';
import { orderTone, paymentTone } from '../common/Labels';
import { Api } from '../api/Http';
import { Repo } from '../api/Repo';
import { Session } from '../api/Session';
import { OrderListPage, OrderReminders, OrderRow, OrderTab } from '../api/Models';
import { LvIcon } from '../components/LvIcon';
import { ListSource } from '../components/ListSource';
import { Pill, StateView } from '../components/Ui';

class ReminderDef {
  title: string;
  icon: string;
  tab: string;

  constructor(title: string, icon: string, tab: string) {
    this.title = title;
    this.icon = icon;
    this.tab = tab;
  }
}

const REMINDERS: ReminderDef[] = [
  new ReminderDef('待付款', 'credit-card', 'PENDING_PAYMENT'),
  new ReminderDef('待发货', 'factory', 'PRODUCING'),
  new ReminderDef('物流异常', 'triangle-alert', 'IN_TRANSIT'),
  new ReminderDef('待收尾款', 'hand-coins', 'PRODUCING')
];

/** GET /api/orders — administrators see all orders, sales the orders of their own customers (services/order-service.ts). */
@Component
export struct OrdersTab {
  @Consume('pathStack') pathStack: NavPathStack;
  @State tab: string = 'ALL';
  @State tabs: OrderTab[] = [];
  @State allCount: number = 0;
  @State reminders: OrderReminders | null = null;
  @State count: number = 0;
  private source: ListSource<OrderRow> = new ListSource<OrderRow>();
  @State total: number = 0;
  @State page: number = 1;
  @State keyword: string = '';
  @State state: string = 'loading';
  @State error: string = '';
  @State refreshing: boolean = false;
  private searchTimer: number = -1;

  aboutToAppear(): void {
    this.showCached();
    this.load(true);
  }

  private toast(message: string): void {
    this.getUIContext().getPromptAction().showToast({ message: message, duration: 2200 });
  }

  private showCached(): void {
    if (this.keyword.length > 0) {
      return;
    }
    const cached = Repo.peekOrders(this.tab);
    if (cached !== null) {
      this.apply(cached, true);
      this.state = 'ready';
    }
  }

  private apply(result: OrderListPage, reset: boolean): void {
    if (reset) {
      this.source.reset(result.orders);
    } else {
      this.source.append(result.orders);
    }
    this.count = this.source.totalCount();
    this.tabs = result.tabs;
    this.allCount = result.allCount;
    this.reminders = result.reminders;
    this.total = result.total;
  }

  private async load(reset: boolean): Promise<void> {
    const page = reset ? 1 : this.page + 1;
    const tab = this.tab;
    try {
      const result = await Repo.orders(tab, this.keyword, page);
      if (tab !== this.tab) return;
      this.apply(result, reset);
      this.page = page;
      this.state = 'ready';
    } catch (e) {
      this.error = Api.message(e);
      if (this.state !== 'ready') {
        this.state = 'error';
      } else if (reset) {
        this.toast(`没有连上服务器，显示的是上次的数据。${this.error}`);
      }
    } finally {
      this.refreshing = false;
    }
  }

  private reminderCount(index: number): number {
    const r = this.reminders;
    if (r === null) return 0;
    if (index === 0) return r.pendingPayment;
    if (index === 1) return r.pendingShipment;
    if (index === 2) return r.shippingException;
    return r.pendingCollection;
  }

  private select(tab: string): void {
    this.tab = tab;
    this.state = 'loading';
    this.showCached();
    this.load(true);
  }

  private onSearch(value: string): void {
    this.keyword = value.trim();
    if (this.searchTimer !== -1) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this.state = 'loading';
      this.load(true);
    }, 400);
  }

  @Builder
  reminderTile(def: ReminderDef, index: number) {
    Column({ space: 2 }) {
      LvIcon({ name: def.icon, iconColor: index === 2 && this.reminderCount(index) > 0 ? $r('app.color.danger') : $r('app.color.ink3'), iconSize: 18 })
      Text(`${this.reminderCount(index)}`)
        .fontSize(18).fontWeight(FontWeight.Bold)
        .fontColor(index === 2 && this.reminderCount(index) > 0 ? $r('app.color.danger') : $r('app.color.ink'))
      Text(def.title).fontSize(12).fontColor($r('app.color.ink2'))
    }
    .layoutWeight(1)
    .padding({ top: 10, bottom: 10 })
    .borderRadius(12)
    .backgroundColor(index === 2 && this.reminderCount(index) > 0 ? $r('app.color.danger_bg') : $r('app.color.surface'))
    .onClick(() => this.select(def.tab))
  }

  /** Read here, not passed in, so the counts follow every refresh. */
  private tabCount(key: string): number {
    if (key === 'ALL') return this.allCount;
    const found = this.tabs.find((t: OrderTab): boolean => t.key === key);
    return found === undefined ? 0 : found.count;
  }

  @Builder
  chip(key: string, title: string) {
    Row({ space: 6 }) {
      Text(title).fontSize(14).fontWeight(FontWeight.Medium)
        .fontColor(this.tab === key ? $r('app.color.on_brand') : $r('app.color.ink2'))
      Text(`${this.tabCount(key)}`).fontSize(12).fontColor(this.tab === key ? $r('app.color.on_brand') : $r('app.color.ink3'))
    }
    .height(36)
    .padding({ left: 14, right: 14 })
    .borderRadius(18)
    .backgroundColor(this.tab === key ? $r('app.color.brand') : $r('app.color.surface'))
    .border({ width: this.tab === key ? 0 : 1, color: $r('app.color.line') })
    .onClick(() => this.select(key))
  }

  @Builder
  card(o: OrderRow) {
    Column({ space: 8 }) {
      Row() {
        Text(o.orderNo).fontSize(13).fontColor($r('app.color.ink3')).layoutWeight(1)
        Pill({ text: o.statusLabel, tone: orderTone(o.status) })
      }
      .width('100%')

      Text(`${o.customer.name}${o.customer.companyName.length > 0 ? ` · ${o.customer.companyName}` : ''}`)
        .fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')

      Row({ space: 10 }) {
        Text(Fmt.money(o.amountRMB, 'CNY')).fontSize(22).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
        if (o.sourceAmount !== null && o.currency !== 'CNY') {
          Text(Fmt.money(o.sourceAmount, o.currency)).fontSize(13).fontColor($r('app.color.ink3'))
        }
      }
      .alignItems(VerticalAlign.Bottom)

      Row({ space: 3 }) {
        ForEach(o.progress.done, (done: boolean, index: number) => {
          Row()
            .height(4)
            .layoutWeight(1)
            .borderRadius(2)
            .backgroundColor(!o.progress.cancelled && done ? (o.overdue ? $r('app.color.danger') : $r('app.color.brand')) : $r('app.color.line'))
        }, (done: boolean, index: number) => `${o.id}-${index}`)
      }
      .width('100%')

      Row() {
        Text(`下单 ${o.orderDate}`).fontSize(12).fontColor($r('app.color.ink3')).layoutWeight(1)
        if (o.overdue) {
          Text('已超预计到货').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.danger'))
        } else {
          Pill({ text: o.paymentLabel, tone: paymentTone(o.paymentStatus) })
        }
      }
      .width('100%')
    }
    .padding(14)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(16)
    .border({ width: 0.5, color: $r('app.color.line_soft') })
    .onClick(() => {
      this.pathStack.pushPathByName(Routes.ORDER, new RouteParam(o.id));
    })
  }

  build() {
    Column() {
      Column({ space: 10 }) {
        Column({ space: 2 }) {
          Text('订单').fontSize(24).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
          Text(Session.isAdmin() ? '全公司 · 金额按人民币展示' : '我负责客户的订单').fontSize(13).fontColor($r('app.color.ink3'))
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
        .padding({ left: 16, right: 16, top: 16 })

        Row({ space: 8 }) {
          ForEach(REMINDERS, (def: ReminderDef, index: number) => {
            this.reminderTile(def, index)
          }, (def: ReminderDef): string => def.title)
        }
        .padding({ left: 16, right: 16 })

        Search({ value: this.keyword, placeholder: '订单号、客户、国家' })
          .height(44)
          .margin({ left: 16, right: 16 })
          .backgroundColor($r('app.color.surface2'))
          .onChange((value: string): void => this.onSearch(value))

        Scroll() {
          Row({ space: 8 }) {
            this.chip('ALL', '全部')
            ForEach(this.tabs, (t: OrderTab) => {
              this.chip(t.key, t.label)
            }, (t: OrderTab): string => t.key)
          }
          .padding({ left: 16, right: 16 })
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .width('100%')
      }
      .padding({ bottom: 10 })

      if (this.state === 'loading') {
        StateView({ kind: 'loading' }).layoutWeight(1)
      } else if (this.state === 'error') {
        StateView({ kind: 'error', message: this.error, actionText: '重新加载', onAction: () => {
          this.state = 'loading';
          this.load(true);
        } }).layoutWeight(1)
      } else {
        Refresh({ refreshing: $$this.refreshing }) {
          List({ space: 10 }) {
            if (this.count === 0) {
              ListItem() {
                StateView({ kind: 'empty', icon: 'package', title: '这个状态下没有订单', message: '成交后会自动生成订单（每笔成交一张订单）。' })
              }
            }
            LazyForEach(this.source, (o: OrderRow) => {
              ListItem() {
                this.card(o)
              }
            }, (o: OrderRow): string => `${this.source.generation}-${o.id}`)
            if (this.count < this.total) {
              ListItem() {
                Button('加载更多')
                  .type(ButtonType.Normal).borderRadius(12).height(44).width('100%')
                  .fontColor($r('app.color.brand_ink')).backgroundColor($r('app.color.surface'))
                  .onClick(() => {
                    this.load(false);
                  })
              }
            }
          }
          .cachedCount(5)
          .padding({ left: 16, right: 16, bottom: 24 })
          .scrollBar(BarState.Off)
          .height('100%')
        }
        .onRefreshing(() => {
          this.load(true);
        })
        .layoutWeight(1)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg'))
  }
}
