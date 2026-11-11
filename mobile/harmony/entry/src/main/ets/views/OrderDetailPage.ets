import { RouteParam, Routes } from '../common/Config';
import { Fmt } from '../common/Format';
import { ORDER_STAGES, orderTone } from '../common/Labels';
import { Api } from '../data/Http';
import { Repo } from '../data/Repo';
import { OrderDetail, OrderQuotation } from '../data/Models';
import { LvIcon } from '../components/LvIcon';
import { Avatar, OrderSteps, Pill, StateView } from '../components/Ui';

/**
 * GET /api/orders/:id. Read-only in this version: changing the status and cancelling stay on the PC
 * (cancelling is administrator-only and voids the linked deal — services/order-service.ts cancelOrder).
 */
@Component
export struct OrderDetailPage {
  orderId: string = '';
  @Consume('pathStack') pathStack: NavPathStack;
  @State order: OrderDetail | null = null;
  @State state: string = 'loading';
  @State error: string = '';

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    try {
      this.order = await Repo.order(this.orderId);
      this.state = 'ready';
    } catch (e) {
      this.error = Api.message(e);
      this.state = 'error';
    }
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
          LvIcon({ name: 'triangle-alert', iconColor: $r('app.color.danger'), size: 20 })
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
          LvIcon({ name: 'chevron-right', iconColor: $r('app.color.ink3'), size: 18 })
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
            }, (q: OrderQuotation) => q.id)
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

      Text('改状态、取消订单请在电脑端操作。').fontSize(12).fontColor($r('app.color.ink3')).width('100%').textAlign(TextAlign.Center)
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
        Scroll() {
          this.content(this.order as OrderDetail)
        }
        .scrollBar(BarState.Off)
        .align(Alignment.Top)
        .height('100%')
      }
    }
    .title(this.order !== null ? this.order.orderNo : '订单详情')
    .backgroundColor($r('app.color.bg'))
  }
}
