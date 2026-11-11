import { Fmt } from '../common/Format';
import { Api } from '../api/Http';
import { Repo } from '../api/Repo';
import { Session } from '../api/Session';
import { Performance, PerformanceRow } from '../api/Models';
import { LvIcon } from '../components/LvIcon';

/** One step of the funnel. */
class Stage {
  title: string;
  value: number;
  hint: string;

  constructor(title: string, value: number, hint: string) {
    this.title = title;
    this.value = value;
    this.hint = hint;
  }
}

/** 'YYYY-MM' moved by `delta` months. */
function shiftMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + delta;
  const d = new Date(year, index, 1);
  return `${d.getFullYear()}-${Fmt.pad(d.getMonth() + 1)}`;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${Fmt.pad(d.getMonth() + 1)}`;
}

function minutesText(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1).replace(/\.0$/, '')} 小时`;
  return `${(minutes / 1440).toFixed(1).replace(/\.0$/, '')} 天`;
}

function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round(part / whole * 1000) / 10}%` : '—';
}

/**
 * 数据分析 — the PC 销售业绩 numbers for one month (GET /api/sales-team/performance?month=): revenue and target,
 * the funnel from new customer to deal, first-contact speed, and for administrators every salesperson side by side.
 * Every figure is counted on the server exactly as the PC shows it.
 */
@Component
export struct AnalyticsPage {
  @Consume('pathStack') pathStack: NavPathStack;
  @State month: string = currentMonth();
  @State data: Performance | null = null;
  @State state: string = 'loading';
  @State error: string = '';
  @State refreshing: boolean = false;

  aboutToAppear(): void {
    this.select(this.month);
  }

  private select(month: string): void {
    this.month = month;
    const cached = Repo.peekPerformance(month === currentMonth() ? '' : month);
    if (cached !== null) {
      this.data = cached;
      this.state = 'ready';
    } else {
      this.state = 'loading';
    }
    this.load();
  }

  private async load(): Promise<void> {
    const month = this.month;
    try {
      const result = await Repo.performance(month === currentMonth() ? '' : month);
      if (month === this.month) {
        this.data = result;
        this.state = 'ready';
      }
    } catch (e) {
      this.error = Api.message(e);
      if (this.state !== 'ready') {
        this.state = 'error';
      }
    } finally {
      this.refreshing = false;
    }
  }

  /** Sales: their own row. Administrators: the salespeople added up (the company line counts unassigned too). */
  private team(p: Performance): PerformanceRow[] {
    return p.rows.filter((r: PerformanceRow): boolean => r.isActive || r.newCustomers > 0 || r.deals > 0);
  }

  private sum(p: Performance, pick: (r: PerformanceRow) => number): number {
    const rows = this.team(p);
    let total = 0;
    for (let i = 0; i < rows.length; i++) {
      total += pick(rows[i]);
    }
    return total;
  }

  private revenue(p: Performance): number {
    if (Session.isAdmin() && p.company !== null) return Number(p.company.revenue);
    return this.sum(p, (r: PerformanceRow): number => Number(r.revenue));
  }

  private deals(p: Performance): number {
    if (Session.isAdmin() && p.company !== null) return p.company.deals;
    return this.sum(p, (r: PerformanceRow): number => r.deals);
  }

  private target(p: Performance): number {
    if (Session.isAdmin()) {
      const s = p.targetSummary;
      return s !== null && s.company !== null ? Number(s.company) : 0;
    }
    const mine = p.rows.length > 0 ? p.rows[0] : null;
    return mine !== null && mine.target !== null ? Number(mine.target.amount) : 0;
  }

  private stages(p: Performance): Stage[] {
    return [
      new Stage('新客户', this.sum(p, (r: PerformanceRow): number => r.newCustomers), '本月进线并分到人'),
      new Stage('已联系', this.sum(p, (r: PerformanceRow): number => r.contacted), '做过首次联系'),
      new Stage('有效客户', this.sum(p, (r: PerformanceRow): number => r.qualified), '确认有采购需求'),
      new Stage('已报价', this.sum(p, (r: PerformanceRow): number => r.quoted), '本月发出报价'),
      new Stage('成交', this.sum(p, (r: PerformanceRow): number => r.deals), '本月成交单数')
    ];
  }

  private averageFirstContact(p: Performance): number | null {
    const rows = this.team(p).filter((r: PerformanceRow): boolean => r.averageFirstContactMinutes !== null && r.contacted > 0);
    if (rows.length === 0) return null;
    let weighted = 0;
    let count = 0;
    for (let i = 0; i < rows.length; i++) {
      weighted += (rows[i].averageFirstContactMinutes as number) * rows[i].contacted;
      count += rows[i].contacted;
    }
    return count > 0 ? weighted / count : null;
  }

  private onTime(p: Performance): string {
    const rows = this.team(p).filter((r: PerformanceRow): boolean => r.firstContactOnTime !== null);
    if (rows.length === 0) return '—';
    if (rows.length === 1) return `${rows[0].firstContactOnTime}%`;
    let total = 0;
    for (let i = 0; i < rows.length; i++) {
      total += rows[i].firstContactOnTime as number;
    }
    return `${Math.round(total / rows.length * 10) / 10}%`;
  }

  @Builder
  kpi(title: string, value: string, sub: string) {
    Column({ space: 4 }) {
      Text(title).fontSize(12).fontColor($r('app.color.ink3'))
      Text(value).fontSize(20).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
        .maxLines(1).minFontSize(14).maxFontSize(20).textOverflow({ overflow: TextOverflow.Ellipsis })
      if (sub.length > 0) {
        Text(sub).fontSize(12).fontColor($r('app.color.ink2')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }
    }
    .alignItems(HorizontalAlign.Start)
    .layoutWeight(1)
    .padding(14)
    .borderRadius(14)
    .backgroundColor($r('app.color.surface'))
  }

  @Builder
  monthBar() {
    Row() {
      Row() {
        LvIcon({ name: 'chevron-left', iconColor: $r('app.color.ink2'), iconSize: 22 })
      }
      .width(44).height(40).justifyContent(FlexAlign.Center)
      .onClick(() => this.select(shiftMonth(this.month, -1)))
      Text(`${this.month.slice(0, 4)} 年 ${Number(this.month.slice(5, 7))} 月`)
        .fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).layoutWeight(1).textAlign(TextAlign.Center)
      Row() {
        LvIcon({ name: 'chevron-right', iconColor: this.month < currentMonth() ? $r('app.color.ink2') : $r('app.color.ink_disabled'), iconSize: 22 })
      }
      .width(44).height(40).justifyContent(FlexAlign.Center)
      .onClick(() => {
        if (this.month < currentMonth()) {
          this.select(shiftMonth(this.month, 1));
        }
      })
    }
    .width('100%')
    .borderRadius(12)
    .backgroundColor($r('app.color.surface'))
  }

  @Builder
  revenueCard(p: Performance) {
    Column({ space: 10 }) {
      Text(Session.isAdmin() ? '全公司销售额' : '我的销售额').fontSize(13).fontColor($r('app.color.ink3'))
      Text(Fmt.money(this.revenue(p), p.currency)).fontSize(30).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
      if (this.target(p) > 0) {
        Stack({ alignContent: Alignment.Start }) {
          Row().width('100%').height(10).borderRadius(5).backgroundColor($r('app.color.surface2'))
          Row().width(`${Math.min(100, this.revenue(p) / this.target(p) * 100)}%`).height(10).borderRadius(5)
            .backgroundColor($r('app.color.brand'))
        }
        .width('100%')
        Text(`目标 ${Fmt.money(this.target(p), p.currency)} · 完成 ${percent(this.revenue(p), this.target(p))}`)
          .fontSize(13).fontColor($r('app.color.ink2'))
      } else {
        Text('这个月还没有设置目标').fontSize(13).fontColor($r('app.color.ink3'))
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(16)
    .borderRadius(16)
    .backgroundColor($r('app.color.surface'))
  }

  @Builder
  funnel(p: Performance) {
    Column({ space: 12 }) {
      Row() {
        Text('客户转化').fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).layoutWeight(1)
        Text(`转化率 ${percent(this.stages(p)[4].value, this.stages(p)[0].value)}`).fontSize(13).fontColor($r('app.color.brand_ink'))
      }
      .width('100%')
      ForEach(this.stages(p), (s: Stage, index: number) => {
        Column({ space: 4 }) {
          Row() {
            Text(s.title).fontSize(13).fontColor($r('app.color.ink')).width(64)
            Text(s.hint).fontSize(12).fontColor($r('app.color.ink3')).layoutWeight(1)
            Text(`${s.value}`).fontSize(15).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
            if (index > 0) {
              Text(percent(s.value, this.stages(p)[0].value)).fontSize(12).fontColor($r('app.color.ink3'))
                .width(52).textAlign(TextAlign.End)
            } else {
              Text('').width(52)
            }
          }
          .width('100%')
          Stack({ alignContent: Alignment.Start }) {
            Row().width('100%').height(8).borderRadius(4).backgroundColor($r('app.color.surface2'))
            Row()
              .width(`${this.stages(p)[0].value > 0 ? Math.max(2, s.value / this.stages(p)[0].value * 100) : 0}%`)
              .height(8)
              .borderRadius(4)
              .backgroundColor(index === 4 ? $r('app.color.brand') : $r('app.color.seq2'))
          }
          .width('100%')
        }
        .width('100%')
      }, (s: Stage): string => s.title)
    }
    .width('100%')
    .padding(16)
    .borderRadius(16)
    .backgroundColor($r('app.color.surface'))
  }

  @Builder
  speed(p: Performance) {
    Row({ space: 10 }) {
      this.kpi('平均首联用时', minutesText(this.averageFirstContact(p)), `要求 ${p.firstContactHours} 小时内`)
      this.kpi('首联准时率', this.onTime(p), '分配后按时联系')
      this.kpi('待首联', `${this.sum(p, (r: PerformanceRow): number => r.pendingFirstContact)}`,
        `${this.sum(p, (r: PerformanceRow): number => r.overdueFirstContact)} 位已超时`)
    }
    .width('100%')
  }

  @Builder
  teamTable(p: Performance) {
    Column({ space: 0 }) {
      Row() {
        Text('销售对比').fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).layoutWeight(1)
        Text('按销售额').fontSize(12).fontColor($r('app.color.ink3'))
      }
      .width('100%')
      .padding({ bottom: 8 })
      Row() {
        Text('销售').fontSize(12).fontColor($r('app.color.ink3')).layoutWeight(1)
        Text('新客户').fontSize(12).fontColor($r('app.color.ink3')).width(44).textAlign(TextAlign.End)
        Text('有效').fontSize(12).fontColor($r('app.color.ink3')).width(36).textAlign(TextAlign.End)
        Text('成交').fontSize(12).fontColor($r('app.color.ink3')).width(36).textAlign(TextAlign.End)
        Text('销售额').fontSize(12).fontColor($r('app.color.ink3')).width(96).textAlign(TextAlign.End)
      }
      .width('100%')
      .padding({ top: 6, bottom: 6 })
      ForEach(this.team(p).sort((a: PerformanceRow, b: PerformanceRow): number => Number(b.revenue) - Number(a.revenue)),
        (r: PerformanceRow) => {
          Column({ space: 3 }) {
            Row() {
              Text(r.name).fontSize(14).fontColor($r('app.color.ink')).layoutWeight(1)
                .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(`${r.newCustomers}`).fontSize(14).fontColor($r('app.color.ink')).width(44).textAlign(TextAlign.End)
              Text(`${r.qualified}`).fontSize(14).fontColor($r('app.color.ink')).width(36).textAlign(TextAlign.End)
              Text(`${r.deals}`).fontSize(14).fontColor($r('app.color.ink')).width(36).textAlign(TextAlign.End)
              Text(Fmt.money(r.revenue, p.currency)).fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
                .width(96).textAlign(TextAlign.End).maxLines(1).minFontSize(10).maxFontSize(14)
            }
            .width('100%')
            Row({ space: 10 }) {
              Text(r.completion !== null ? `目标完成 ${r.completion}%` : '未设目标').fontSize(12).fontColor($r('app.color.ink3'))
              Text(`首联 ${minutesText(r.averageFirstContactMinutes)}`).fontSize(12).fontColor($r('app.color.ink3'))
              if (r.overdueFirstContact > 0) {
                Text(`${r.overdueFirstContact} 位首联超时`).fontSize(12).fontColor($r('app.color.danger'))
              }
              if (r.closedByOwner > 0) {
                Text(`标记无效/流失 ${r.closedByOwner}`).fontSize(12).fontColor($r('app.color.warning'))
              }
            }
            .width('100%')
          }
          .width('100%')
          .padding({ top: 10, bottom: 10 })
          .border({ width: { top: 0.5 }, color: $r('app.color.line_soft') })
        }, (r: PerformanceRow): string => r.id)
    }
    .width('100%')
    .padding(16)
    .borderRadius(16)
    .backgroundColor($r('app.color.surface'))
  }

  @Builder
  content(p: Performance) {
    Column({ space: 12 }) {
      this.revenueCard(p)
      Row({ space: 10 }) {
        this.kpi('成交单数', `${this.deals(p)}`, '')
        this.kpi('新客户', `${Session.isAdmin() && p.company !== null ? p.company.newCustomers : this.stages(p)[0].value}`, '')
        this.kpi('有效客户', `${Session.isAdmin() && p.company !== null ? p.company.qualified : this.stages(p)[2].value}`, '')
      }
      .width('100%')
      this.funnel(p)
      this.speed(p)
      if (Session.isAdmin() && this.team(p).length > 0) {
        this.teamTable(p)
      }
      Text(Session.isAdmin() ? '全公司数字包含未分配和管理员名下的客户，所以可能大于各销售之和。' : '数字与电脑端「销售业绩」同一口径，按询盘时间和成交日期计入当月。')
        .fontSize(12).fontColor($r('app.color.ink3')).lineHeight(18)
    }
    .width('100%')
  }

  build() {
    NavDestination() {
      Column({ space: 12 }) {
        this.monthBar()
        if (this.state === 'loading') {
          LoadingProgress().width(36).height(36).color($r('app.color.brand_ink')).margin({ top: 40 })
        } else if (this.state === 'error' || this.data === null) {
          Text(this.error).fontSize(14).fontColor($r('app.color.danger')).lineHeight(21)
          Button('重新加载')
            .type(ButtonType.Normal).height(44).borderRadius(12)
            .fontColor($r('app.color.ink')).backgroundColor($r('app.color.surface'))
            .onClick(() => {
              this.state = 'loading';
              this.load();
            })
        } else {
          Refresh({ refreshing: $$this.refreshing }) {
            Scroll() {
              Column() {
                this.content(this.data as Performance)
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
          .layoutWeight(1)
        }
      }
      .width('100%')
      .height('100%')
      .padding({ left: 16, right: 16, top: 8 })
    }
    .title('数据分析')
    .backgroundColor($r('app.color.bg'))
  }
}
