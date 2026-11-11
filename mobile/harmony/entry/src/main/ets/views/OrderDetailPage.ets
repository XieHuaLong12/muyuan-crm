import { RouteParam, Routes, StoreKeys } from '../common/Config';
import { Fmt } from '../common/Format';
import { ORDER_STAGES, orderTone } from '../common/Labels';
import { Api } from '../api/Http';
import { Repo } from '../api/Repo';
import { Session } from '../api/Session';
import { OrderDetail, OrderQuotation } from '../api/Models';
import { LvIcon } from '../components/LvIcon';
import { Avatar, OrderSteps, Pill, StateView } from '../components/Ui';

class StageChoice {
  key: string;
  title: string;

  constructor(key: string, title: string) {
    this.key = key;
    this.title = title;
  }
}

/** lib/order-status.ts ORDER_STATUS; 已完成 is confirmed by an administrator (services/order-service.ts). */
const MILESTONES: StageChoice[] = [
  new StageChoice('PENDING_PAYMENT', '待付款'), new StageChoice('PRODUCING', '生产中'), new StageChoice('SHIPPED', '已发货'),
  new StageChoice('IN_TRANSIT', '运输中'), new StageChoice('COMPLETED', '已完成')
];

/**
 * GET /api/orders/:id, with 更新进度 (PATCH /api/orders/:id — sales move production, shipping and transport;
 * 已完成 needs an administrator) and 取消订单 (administrators; voids the linked deal, POST /api/orders/:id/cancel).
 */
@Component
export struct OrderDetailPage {
  orderId: string = '';
  @Consume('pathStack') pathStack: NavPathStack;
  @State order: OrderDetail | null = null;
  @State state: string = 'loading';
  @State error: string = '';
  /** Bumped on every new order snapshot so the page body is rebuilt with it. */
  @State rev: number = 0;
  @State showSheet: boolean = false;
  @State sheet: string = '';
  @State reason: string = '';
  @State saving: boolean = false;
  @State actionError: string = '';

  aboutToAppear(): void {
    const cached = Repo.peekOrder(this.orderId);
    if (cached !== null) {
      this.order = cached;
      this.rev++;
      this.state = 'ready';
    }
    this.load();
  }

  private async load(): Promise<void> {
    try {
      this.order = await Repo.order(this.orderId);
      this.rev++;
      this.state = 'ready';
    } catch (e) {
      this.error = Api.message(e);
      if (this.state !== 'ready') {
        this.state = 'error';
      }
    }
  }

  private toast(message: string): void {
    this.getUIContext().getPromptAction().showToast({ message: message, duration: 2200 });
  }

  private canMove(): boolean {
    const o = this.order;
    if (o === null || o.status === 'CANCELLED') return false;
    return Session.isAdmin() || o.status !== 'COMPLETED';
  }

  private choices(): StageChoice[] {
    const o = this.order;
    const admin = Session.isAdmin();
    return MILESTONES.filter((m: StageChoice): boolean => o !== null && m.key !== o.status && (admin || m.key !== 'COMPLETED'));
  }

  private open(kind: string): void {
    this.sheet = kind;
    this.reason = '';
    this.actionError = '';
    this.showSheet = true;
  }

  private async move(stage: StageChoice): Promise<void> {
    const o = this.order;
    if (o === null || this.saving) return;
    this.saving = true;
    this.actionError = '';
    try {
      await Repo.orderMilestone(o.id, stage.key, o.updatedAt);
      this.showSheet = false;
      this.toast(`订单已更新为「${stage.title}」`);
      AppStorage.setOrCreate<number>(StoreKeys.DATA_CHANGED, Date.now());
      await this.load();
    } catch (e) {
      this.actionError = Api.message(e);
    } finally {
      this.saving = false;
    }
  }

  private async cancel(): Promise<void> {
    const o = this.order;
    if (o === null || this.saving) return;
    if (this.reason.trim().length < 2) {
      this.actionError = '请写明取消原因（至少 2 个字）';
      return;
    }
    this.saving = true;
    this.actionError = '';
    try {
      await Repo.cancelOrder(o.id, this.reason.trim(), o.updatedAt);
      this.showSheet = false;
      this.toast('订单已取消，关联的成交已作废');
      AppStorage.setOrCreate<number>(StoreKeys.DATA_CHANGED, Date.now());
      await this.load();
    } catch (e) {
      this.actionError = Api.message(e);
    } finally {
      this.saving = false;
    }
  }

  @Builder
  sheetContent() {
    Column({ space: 12 }) {
      if (this.sheet === 'move') {
        Text('更新订单进度').fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
        Text(Session.isAdmin() ? '选一个阶段。' : '销售可以推进生产、发货与运输；「已完成」由管理员确认。').fontSize(13).fontColor($r('app.color.ink3'))
        ForEach(this.choices(), (m: StageChoice) => {
          Row() {
            Text(m.title).fontSize(16).fontColor($r('app.color.ink')).layoutWeight(1)
            LvIcon({ name: 'chevron-right', iconColor: $r('app.color.ink3'), iconSize: 18 })
          }
          .width('100%')
          .height(52)
          .padding({ left: 14, right: 14 })
          .borderRadius(12)
          .backgroundColor($r('app.color.surface2'))
          .enabled(!this.saving)
          .onClick(() => {
            this.move(m);
          })
        }, (m: StageChoice): string => m.key)
      } else {
        Text('取消订单').fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
        Text('取消后关联的成交会作废并留痕，业绩里不再计入。').fontSize(13).fontColor($r('app.color.ink2'))
        TextArea({ placeholder: '取消原因（必填）', text: this.reason })
          .height(96).fontSize(16).backgroundColor($r('app.color.surface2'))
          .onChange((v: string) => {
            this.reason = v;
            this.actionError = '';
          })
        Button(this.saving ? '正在取消' : '确认取消订单')
          .type(ButtonType.Normal).width('100%').height(48).borderRadius(12)
          .fontColor(Color.White).backgroundColor($r('app.color.danger'))
          .enabled(!this.saving)
          .onClick(() => {
            this.cancel();
          })
      }
      if (this.actionError.length > 0) {
        Text(this.actionError).fontSize(13).fontColor($r('app.color.danger'))
      }
    }
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 16, right: 16, top: 8, bottom: 24 })
  }

  private late(o: OrderDetail): boolean {
    const eta = Fmt.parse(o.estimatedDelivery);
    return eta !== null && eta.getTime() < Date.now() && o.status !== 'COMPLETED' && o.status !== 'CANCELLED';
  }

  @Builder
  statusCell(title: string, value: string, tone: string, note: string) {
    Column({ space: 6 }) {
      Text(title).fontSize(12).fontColor($r('app.color.ink3'))
      Pill({ text: value, tone: tone })
      if (note.length > 0) {
        Text(note).fontSize(11).fontColor($r('app.color.ink3')).lineHeight(16)
      }
    }
    .alignItems(HorizontalAlign.Start)
    .layoutWeight(1)
    .padding(12)
    .borderRadius(12)
    .backgroundColor($r('app.color.surface'))
  }

  @Builder
  content(o: OrderDetail) {
    Column({ space: 14 }) {
      if (this.late(o)) {
        Row({ space: 10 }) {
          LvIcon({ name: 'triangle-alert', iconColor: $r('app.color.danger'), iconSize: 20 })
          Column({ space: 4 }) {
            Text('物流异常 · 已超过预计到货日期').fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.danger'))
            Text(`预计 ${(o.estimatedDelivery as string).slice(0, 10)} 到货，目前仍未完成。${o.notes}`).fontSize(13).fontColor($r('app.color.ink2')).lineHeight(20)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
        }
        .alignItems(VerticalAlign.Top)
        .width('100%')
        .padding(14)
        .borderRadius(16)
        .backgroundColor($r('app.color.danger_bg'))
      }

      Column({ space: 6 }) {
        Row() {
          Text(o.orderNo).fontSize(13).fontColor($r('app.color.ink3')).layoutWeight(1)
          Pill({ text: o.statusLabel, tone: orderTone(o.status) })
        }
        .width('100%')
        Text(Fmt.money(o.amountRMB, 'CNY')).fontSize(32).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
        Text(`${o.sourceAmount !== null && o.currency !== 'CNY' ? `原币 ${Fmt.money(o.sourceAmount, o.currency)} · ` : ''}下单 ${o.orderDate}`)
          .fontSize(13).fontColor($r('app.color.ink3'))
        OrderSteps({ done: o.progress.done, cancelled: o.progress.cancelled, labels: ORDER_STAGES })
          .margin({ top: 12 })
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .padding(16)
      .borderRadius(16)
      .backgroundColor($r('app.color.surface'))

      Row({ space: 8 }) {
        this.statusCell('付款', o.paymentLabel, o.balance === '已付' ? 'success' : o.deposit === '已付' ? 'warning' : 'danger', `定金 30% ${o.deposit} · 尾款 70% ${o.balance}`)
        this.statusCell('生产', o.productionLabel, 'info', '')
        this.statusCell('发货', o.shippingLabel, this.late(o) ? 'danger' : 'brand',
          o.estimatedDelivery !== null ? `预计到货 ${o.estimatedDelivery.slice(0, 10)}` : '')
      }
      .alignItems(VerticalAlign.Top)
      .width('100%')

      if (o.deal !== null) {
        Column({ space: 6 }) {
          Text('产品').fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
          Column({ space: 4 }) {
            Text(`${o.deal.product} ${o.deal.productModel}`.trim()).fontSize(15).fontColor($r('app.color.ink'))
            Text(`数量 ${o.deal.quantity} · 成交 ${Fmt.money(o.deal.dealAmount, o.deal.currency)}`).fontSize(13).fontColor($r('app.color.ink2'))
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
          .padding(14)
          .borderRadius(16)
          .backgroundColor($r('app.color.surface'))
        }
        .alignItems(HorizontalAlign.Start)
      }

      Column({ space: 6 }) {
        Text('客户').fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        Row({ space: 12 }) {
          Avatar({ name: o.customer.name, avatarSize: 36 })
          Column({ space: 2 }) {
            Text(o.customer.name).fontSize(15).fontColor($r('app.color.ink'))
            Text(`${o.customer.companyName} · ${o.customer.country}`).fontSize(13).fontColor($r('app.color.ink3'))
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          LvIcon({ name: 'chevron-right', iconColor: $r('app.color.ink3'), iconSize: 18 })
        }
        .width('100%')
        .padding(14)
        .borderRadius(16)
        .backgroundColor($r('app.color.surface'))
        .onClick(() => {
          this.pathStack.pushPathByName(Routes.CUSTOMER, new RouteParam(o.customer.id));
        })
      }
      .alignItems(HorizontalAlign.Start)

      if (o.quotations.length > 0) {
        Column({ space: 6 }) {
          Text('报价单').fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
          Column() {
            ForEach(o.quotations, (q: OrderQuotation, index: number) => {
              Row() {
                Column({ space: 2 }) {
                  Text(q.quoteNumber).fontSize(14).fontColor($r('app.color.ink'))
                  Text(q.sentAt !== null ? `发送 ${Fmt.ago(q.sentAt)}` : '草稿').fontSize(12).fontColor($r('app.color.ink3'))
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                Text(Fmt.money(q.amount, q.currency)).fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
              }
              .width('100%')
              .padding({ top: 10, bottom: 10 })
              .border({ width: { top: index === 0 ? 0 : 0.5 }, color: $r('app.color.line_soft') })
            }, (q: OrderQuotation): string => q.id)
          }
          .padding({ left: 14, right: 14 })
          .borderRadius(16)
          .backgroundColor($r('app.color.surface'))
        }
        .alignItems(HorizontalAlign.Start)
      }

      if (o.notes.length > 0 && !this.late(o)) {
        Column({ space: 6 }) {
          Text('备注').fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
          Text(o.notes).fontSize(14).fontColor($r('app.color.ink2')).lineHeight(22)
            .width('100%').padding(14).borderRadius(16).backgroundColor($r('app.color.surface'))
        }
        .alignItems(HorizontalAlign.Start)
      }

    }
    .padding({ left: 16, right: 16, top: 8, bottom: 24 })
  }

  build() {
    NavDestination() {
      if (this.state === 'loading') {
        StateView({ kind: 'loading' })
      } else if (this.state === 'error' || this.order === null) {
        StateView({ kind: 'error', message: this.error, actionText: '重新加载', onAction: () => {
          this.state = 'loading';
          this.load();
        } })
      } else {
        Column() {
          Scroll() {
            Column() {
              // One item per snapshot: a new order snapshot rebuilds the body with the new values.
              ForEach([this.rev], (r: number) => {
                this.content(this.order as OrderDetail)
              }, (r: number): string => `${r}`)
            }
          }
          .scrollBar(BarState.Off)
          .align(Alignment.Top)
          .layoutWeight(1)

          if (this.canMove() || (Session.isAdmin() && this.order !== null && this.order.status !== 'CANCELLED')) {
            Column() {
              Row({ space: 10 }) {
                if (Session.isAdmin() && this.order !== null && this.order.status !== 'CANCELLED') {
                  Button('取消订单')
                    .type(ButtonType.Normal).height(48).borderRadius(12).layoutWeight(1)
                    .fontColor($r('app.color.danger')).backgroundColor($r('app.color.surface2'))
                    .onClick(() => this.open('cancel'))
                }
                if (this.canMove()) {
                  Button('更新进度')
                    .type(ButtonType.Normal).height(48).borderRadius(12).layoutWeight(2)
                    .fontColor($r('app.color.on_brand')).backgroundColor($r('app.color.brand'))
                    .onClick(() => this.open('move'))
                }
              }
              .width('100%')
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 10, bottom: 12 })
            .backgroundColor($r('app.color.surface'))
            .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
          }
        }
        .width('100%')
        .height('100%')
        .bindSheet($$this.showSheet, this.sheetContent(), { detents: [SheetSize.MEDIUM, SheetSize.LARGE], dragBar: true })
      }
    }
    .title(this.order !== null ? this.order.orderNo : '订单详情')
    .backgroundColor($r('app.color.bg'))
  }
}
