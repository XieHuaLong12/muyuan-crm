import { call } from '@kit.TelephonyKit';
import { RouteParam, Routes, StoreKeys } from '../common/Config';
import { Fmt } from '../common/Format';
import { FOLLOW_TYPES, FOLLOW_TYPE_KEYS, PURCHASES, SOURCES, STAGES, label, stageTone } from '../common/Labels';
import { Api } from '../api/Http';
import { Session } from '../api/Session';
import { Repo } from '../api/Repo';
import { CustomerDetail, DealRow, FollowUpBody, FollowUpRow, OwnerName, Quotation, SalesAccount, StageChange } from '../api/Models';
import { LvIcon } from '../components/LvIcon';
import { Avatar, Pill, StateView } from '../components/Ui';
import { TaskEditor } from './task/TaskEditor';

class TimelineEntry {
  key: string = '';
  at: string = '';
  icon: string = 'pencil';
  title: string = '';
  body: string = '';
}

class NextOption {
  title: string;
  days: number;

  constructor(title: string, days: number) {
    this.title = title;
    this.days = days;
  }
}

/** 下次跟进 quick picks; days < 0 means 「不设置」. */
const NEXT_OPTIONS: NextOption[] = [
  new NextOption('明天 10:00', 1), new NextOption('3 天后', 3), new NextOption('1 周后', 7), new NextOption('不设置', -1)
];

/** 写跟进 quick phrases (the prototype's fd-phrase): tap to add to the content. */
const PHRASES: string[] = ['已发产品目录', '已发报价', '客户在比价', '客户要样品', '约了下次通话', '客户暂时没需求', '等客户确认款式'];

const QUOTE_STATUS: Record<string, string> = {
  'DRAFT': '草稿', 'SENT': '已发送', 'ACCEPTED': '已确认', 'REJECTED': '已拒绝', 'EXPIRED': '已过期'
};

/** Stages a person may move a customer to (lib/bos-kanban.ts order without WON: deals set 已成交). */
const STAGE_ORDER: string[] = [
  'NEW', 'CONTACTED', 'REPLIED', 'CATALOG_SENT', 'NEEDS_CONFIRMED', 'PRODUCT_CONFIRMED', 'QUOTED', 'FOLLOW_UP', 'ORDER',
  'PAUSED', 'LOST', 'INVALID'
];
/** lib/bos-kanban.ts KANBAN_REASON_STAGES: these need a reason for the administrator to review. */
const REASON_STAGES: string[] = ['PAUSED', 'LOST', 'INVALID'];

class InfoRow {
  name: string;
  value: string;

  constructor(name: string, value: string) {
    this.name = name;
    this.value = value;
  }
}

/** GET /api/customers/:id — sales only reach their own customers (lib/auth.ts scope), the server enforces it. */
@Component
export struct CustomerDetailPage {
  customerId: string = '';
  @Consume('pathStack') pathStack: NavPathStack;
  @State detail: CustomerDetail | null = null;
  @State state: string = 'loading';
  @State error: string = '';
  @State tab: number = 0;
  @State showFollow: boolean = false;
  @State followType: string = 'WHATSAPP';
  @State followText: string = '';
  @State nextIndex: number = 0;
  @State saving: boolean = false;
  @State followError: string = '';
  @State showStage: boolean = false;
  @State stageTo: string = '';
  @State stageReason: string = '';
  @State stageSaving: boolean = false;
  @State stageError: string = '';
  /** Bumped on every new detail snapshot: the page body is rebuilt with it (builder parameters do not refresh). */
  @State rev: number = 0;
  @State quotes: Quotation[] | null = null;
  @State quotesError: string = '';
  // 写跟进: change the stage in the same step ('' = keep), and a picked date for the next follow-up.
  @State followStage: string = '';
  @State customNext: number = 0;
  // 更多: task | assign
  @State showMore: boolean = false;
  @State moreKind: string = '';
  @State accounts: SalesAccount[] = [];
  @State assignError: string = '';

  aboutToAppear(): void {
    const cached = Repo.peekCustomer(this.customerId);
    if (cached !== null) {
      this.detail = cached;
      this.rev++;
      this.state = 'ready';
    }
    const quotes = Repo.peekQuotations(this.customerId);
    if (quotes !== null) {
      this.quotes = quotes;
    }
    this.load();
  }

  private async load(): Promise<void> {
    try {
      this.detail = await Repo.customer(this.customerId);
      this.rev++;
      this.state = 'ready';
    } catch (e) {
      this.error = Api.message(e);
      if (this.state !== 'ready') {
        this.state = 'error';
      }
    }
  }

  /** Lists and the home tab reload after a change made here. */
  private changed(): void {
    AppStorage.setOrCreate<number>(StoreKeys.DATA_CHANGED, Date.now());
  }

  private openChat(): void {
    this.pathStack.pushPathByName(Routes.CHAT, new RouteParam(this.customerId));
  }

  private openStage(): void {
    const c = this.detail;
    if (c === null) return;
    if (c.stage === 'WON' || c.deals.length > 0) {
      this.toast('已成交客户的阶段由成交记录决定，如需调整请在电脑端处理');
      return;
    }
    this.stageTo = c.stage;
    this.stageReason = '';
    this.stageError = '';
    this.showStage = true;
  }

  private async saveStage(): Promise<void> {
    const c = this.detail;
    if (c === null) return;
    if (this.stageTo === c.stage) {
      this.showStage = false;
      return;
    }
    const reason = this.stageReason.trim();
    if (REASON_STAGES.indexOf(this.stageTo) >= 0 && reason.length < 2) {
      this.stageError = '改为暂不需要、已流失或无效客户时，请写明原因（至少 2 个字）';
      return;
    }
    this.stageSaving = true;
    this.stageError = '';
    try {
      await Repo.moveStage(c.id, c.stage, this.stageTo, reason);
      this.showStage = false;
      this.toast(`阶段已改为「${label(STAGES, this.stageTo)}」`);
      this.changed();
      await this.load();
    } catch (e) {
      this.stageError = Api.message(e);
    } finally {
      this.stageSaving = false;
    }
  }

  private toast(message: string): void {
    this.getUIContext().getPromptAction().showToast({ message: message, duration: 2200 });
  }

  /** Dial, and have 写跟进 open as a phone call record when the user comes back from the call. */
  private dial(number: string): void {
    const digits = number.replace(/[^\d+]/g, '');
    if (digits.length === 0) {
      this.toast('这位客户没有电话号码');
      return;
    }
    call.makeCall(digits).then(() => {
      this.followType = 'PHONE';
      this.followText = '';
      setTimeout(() => {
        this.showFollow = true;
      }, 800);
    }).catch(() => this.toast('无法打开拨号界面'));
  }

  private openMoreMenu(): void {
    const c = this.detail;
    if (c === null) return;
    const sheets: SheetInfo[] = [
      { title: '改阶段', action: () => this.openStage() },
      { title: '新建任务', action: () => this.openMore('task') }
    ];
    if (Session.isAdmin()) {
      sheets.push({ title: c.owner !== null ? `改负责人（现在：${c.owner.name}）` : '分配给销售', action: () => this.openMore('assign') });
      sheets.push({ title: '移入回收站', action: () => this.confirmTrash() });
    }
    this.getUIContext().showActionSheet({ title: '更多操作', message: c.name, autoCancel: true, sheets: sheets });
  }

  private openMore(kind: string): void {
    this.moreKind = kind;
    this.assignError = '';
    this.showMore = true;
    if (kind === 'assign' && this.accounts.length === 0) {
      this.loadAccounts();
    }
  }

  private async loadAccounts(): Promise<void> {
    try {
      const rows = await Repo.salesAccounts();
      this.accounts = rows.filter((a: SalesAccount): boolean => a.isActive);
    } catch (e) {
      this.assignError = Api.message(e);
    }
  }

  private async assignTo(a: SalesAccount): Promise<void> {
    const c = this.detail;
    if (c === null) return;
    try {
      await Repo.assign([c.id], a.id, '手机端分配');
      this.showMore = false;
      this.toast(`已分配给 ${a.name}`);
      this.changed();
      await this.load();
    } catch (e) {
      this.assignError = Api.message(e);
    }
  }

  private confirmTrash(): void {
    const c = this.detail;
    if (c === null) return;
    this.getUIContext().showAlertDialog({
      title: '移入回收站？',
      message: `${c.name} 的跟进记录、报价会一起移入回收站，管理员可以在电脑端恢复。已成交客户不能删除。`,
      autoCancel: true,
      alignment: DialogAlignment.Center,
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: {
        value: '移入回收站',
        fontColor: $r('app.color.danger'),
        action: () => {
          this.trash();
        }
      }
    });
  }

  private async trash(): Promise<void> {
    try {
      await Repo.deleteCustomer(this.customerId);
      this.toast('已移入回收站');
      this.changed();
      this.pathStack.pop();
    } catch (e) {
      this.toast(Api.message(e));
    }
  }

  private async loadQuotes(): Promise<void> {
    try {
      this.quotes = await Repo.quotations(this.customerId);
      this.quotesError = '';
    } catch (e) {
      this.quotesError = Api.message(e);
    }
  }

  private selectTab(index: number): void {
    this.tab = index;
    if (index === 2) {
      this.loadQuotes();
    }
  }

  private pickNextDate(): void {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    this.getUIContext().showDatePickerDialog({
      start: new Date(),
      end: new Date(new Date().getFullYear() + 2, 11, 31),
      selected: this.customNext > 0 ? new Date(this.customNext) : start,
      onDateAccept: (value: Date) => {
        this.customNext = new Date(value.getFullYear(), value.getMonth(), value.getDate(), 10, 0, 0, 0).getTime();
        this.nextIndex = NEXT_OPTIONS.length;
      }
    });
  }

  private customNextText(): string {
    if (this.customNext <= 0) return '选日期';
    const d = new Date(this.customNext);
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 10:00`;
  }

  private addPhrase(phrase: string): void {
    const text = this.followText.trim();
    this.followText = text.length > 0 ? `${text}；${phrase}` : phrase;
    this.followError = '';
  }

  private timeline(c: CustomerDetail): TimelineEntry[] {
    const entries: TimelineEntry[] = [];
    c.followUps.forEach((f: FollowUpRow) => {
      const e = new TimelineEntry();
      e.key = `f-${f.id}`;
      e.at = f.followUpAt;
      e.icon = f.type === 'PHONE' ? 'phone' : f.type === 'EMAIL' ? 'mail' : 'pencil';
      e.title = `跟进 · ${label(FOLLOW_TYPES, f.type)}`;
      e.body = f.content;
      entries.push(e);
    });
    c.stageHistory.forEach((s: StageChange) => {
      const e = new TimelineEntry();
      e.key = `s-${s.id}`;
      e.at = s.changedAt;
      e.icon = 'flag';
      e.title = s.fromStage === null ? `阶段：${label(STAGES, s.toStage)}` : `阶段：${label(STAGES, s.fromStage)} → ${label(STAGES, s.toStage)}`;
      e.body = s.note;
      entries.push(e);
    });
    c.deals.forEach((d: DealRow) => {
      const e = new TimelineEntry();
      e.key = `d-${d.id}`;
      e.at = d.dealDate;
      e.icon = 'receipt';
      e.title = `成交 ${Fmt.money(d.dealAmount, d.currency)}`;
      e.body = d.order !== null ? `订单 ${d.order.orderNo}` : '';
      entries.push(e);
    });
    entries.sort((a: TimelineEntry, b: TimelineEntry) => b.at.localeCompare(a.at));
    return entries;
  }

  private profile(c: CustomerDetail): InfoRow[] {
    const rows: InfoRow[] = [
      new InfoRow('WhatsApp', c.whatsapp), new InfoRow('电话', c.phone), new InfoRow('邮箱', c.email),
      new InfoRow('语言', c.language), new InfoRow('城市', `${c.country} ${c.city}`.trim()),
      new InfoRow('采购身份', label(PURCHASES, c.purchaseType)),
      new InfoRow('意向产品', `${c.productInterest}${c.productModel.length > 0 ? ` · ${c.productModel}` : ''}`),
      new InfoRow('数量', c.quantity !== null && c.quantity > 0 ? `${c.quantity}` : ''),
      new InfoRow('来源', label(SOURCES, c.source)),
      new InfoRow('询盘时间', Fmt.ago(c.inquiryAt !== null ? c.inquiryAt : c.createdAt)),
      new InfoRow('等级依据', c.leadGradeReason),
      new InfoRow('负责人', c.owner !== null ? c.owner.name : '待分配'),
      new InfoRow('无效 / 暂停原因', c.invalidReason),
      new InfoRow('备注', c.notes)
    ];
    return rows.filter((r: InfoRow): boolean => r.value.length > 0);
  }

  private async saveFollowUp(): Promise<void> {
    const content = this.followText.trim();
    if (content.length === 0) {
      this.followError = '请填写跟进内容';
      return;
    }
    const custom = this.nextIndex >= NEXT_OPTIONS.length && this.customNext > 0;
    const option = NEXT_OPTIONS[Math.min(this.nextIndex, NEXT_OPTIONS.length - 1)];
    const nextAt: string | null = custom ? new Date(this.customNext).toISOString() : option.days < 0 ? null : Fmt.atDay(option.days, 10);
    const c = this.detail;
    const stage = this.followStage;
    if (c !== null && stage.length > 0 && stage !== c.stage && REASON_STAGES.indexOf(stage) >= 0 && content.length < 2) {
      this.followError = '改为暂不需要、已流失或无效客户时，跟进内容就是原因，请多写几个字';
      return;
    }
    const body: FollowUpBody = {
      type: this.followType,
      content: content,
      // A minute back: the server refuses a follow-up time later than its own clock, and phone clocks drift.
      followUpAt: new Date(Date.now() - 60000).toISOString(),
      nextFollowUpAt: nextAt
    };
    this.saving = true;
    this.followError = '';
    try {
      await Repo.addFollowUp(this.customerId, body);
      let note = nextAt === null ? '跟进已保存' : `跟进已保存 · 下次 ${custom ? this.customNextText() : option.title}`;
      if (c !== null && stage.length > 0 && stage !== c.stage) {
        try {
          await Repo.moveStage(c.id, c.stage, stage, content);
          note = `${note} · 阶段改为「${label(STAGES, stage)}」`;
        } catch (e) {
          note = `跟进已保存，但阶段没改成：${Api.message(e)}`;
        }
      }
      this.showFollow = false;
      this.followText = '';
      this.followStage = '';
      this.toast(note);
      this.changed();
      await this.load();
    } catch (e) {
      this.followError = Api.message(e);
    } finally {
      this.saving = false;
    }
  }

  @Builder
  contactButton(icon: string, title: string, enabled: boolean, action: () => void) {
    Column({ space: 6 }) {
      Row() {
        LvIcon({ name: icon, iconColor: $r('app.color.brand_ink'), iconSize: 21 })
      }
      .width(46).height(46).borderRadius(23).justifyContent(FlexAlign.Center).backgroundColor($r('app.color.brand_soft'))
      Text(title).fontSize(12).fontColor($r('app.color.ink2'))
    }
    .layoutWeight(1)
    .opacity(enabled ? 1 : 0.4)
    .onClick(() => {
      if (enabled) {
        action();
      }
    })
  }

  @Builder
  header(c: CustomerDetail) {
    Column({ space: 14 }) {
      Row({ space: 14 }) {
        Avatar({ name: c.name, grade: c.leadGrade, avatarSize: 56 })
        Column({ space: 3 }) {
          Text(c.name).fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
          if (c.companyName.length > 0) {
            Text(c.companyName).fontSize(14).fontColor($r('app.color.ink2'))
          }
          Text(`${c.country} ${c.city} · ${label(SOURCES, c.source)}`).fontSize(13).fontColor($r('app.color.ink3'))
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
      }
      .width('100%')

      Row({ space: 6 }) {
        Row({ space: 2 }) {
          Pill({ text: label(STAGES, c.stage), tone: stageTone(c.stage) })
          LvIcon({ name: 'chevron-down', iconColor: $r('app.color.ink3'), iconSize: 16 })
        }
        .onClick(() => this.openStage())
        if (c.leadGrade.length > 0) {
          Pill({ text: `${c.leadGrade} 级`, tone: c.leadGrade === 'A' ? 'brand' : 'neutral' })
        }
        if (c.pendingAssignment) {
          Pill({ text: '待分配', tone: 'warning' })
        }
      }
      .width('100%')

      Divider().color($r('app.color.line_soft'))

      Row() {
        this.contactButton('phone', '电话', c.phone.length > 0 || c.whatsapp.length > 0, () => this.dial(c.phone.length > 0 ? c.phone : c.whatsapp))
        this.contactButton('message-circle', 'WhatsApp', true, () => this.openChat())
        this.contactButton('pencil', '写跟进', true, () => {
          this.showFollow = true;
        })
        this.contactButton('ellipsis', '更多', true, () => this.openMoreMenu())
      }
      .width('100%')
    }
    .padding(16)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(16)
  }

  @Builder
  dueStrip(c: CustomerDetail) {
    Row({ space: 12 }) {
      LvIcon({
        name: Fmt.due(this.dueIso(c)).late ? 'triangle-alert' : 'alarm-clock',
        iconColor: Fmt.due(this.dueIso(c)).late ? $r('app.color.danger') : $r('app.color.brand_ink'),
        iconSize: 20
      })
      Column({ space: 1 }) {
        Text(this.isFirstContact(c) ? '首次联系截止' : '下次跟进').fontSize(12).fontColor($r('app.color.ink3'))
        Text(Fmt.due(this.dueIso(c)).text)
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(Fmt.due(this.dueIso(c)).late ? $r('app.color.danger') : Fmt.due(this.dueIso(c)).soon ? $r('app.color.warning') : $r('app.color.ink'))
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: 12, bottom: 12 })
    .borderRadius(16)
    .backgroundColor(Fmt.due(this.dueIso(c)).late ? $r('app.color.danger_bg') : $r('app.color.surface'))
  }

  private isFirstContact(c: CustomerDetail): boolean {
    return c.firstContactDueAt !== null && c.firstContactAt === null;
  }

  private dueIso(c: CustomerDetail): string | null {
    return this.isFirstContact(c) ? c.firstContactDueAt : c.nextFollowUpAt;
  }

  @Builder
  aiCard(c: CustomerDetail) {
    Column({ space: 8 }) {
      Row({ space: 6 }) {
        LvIcon({ name: 'sparkles', iconColor: $r('app.color.brand_ink'), iconSize: 16 })
        Text('AI 建议').fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.brand_ink'))
        Blank()
        Text('仅供参考，需人工确认').fontSize(12).fontColor($r('app.color.ink3'))
      }
      .width('100%')
      if (c.aiSummary.length > 0) {
        Text(c.aiSummary).fontSize(14).fontColor($r('app.color.ink')).lineHeight(22)
      }
      if (c.aiNextAction.length > 0) {
        Text(`下一步：${c.aiNextAction}`).fontSize(14).fontColor($r('app.color.ink2')).lineHeight(22)
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(14)
    .borderRadius(16)
    .backgroundColor($r('app.color.brand_tint'))
  }

  @Builder
  segment(titles: string[]) {
    Row({ space: 2 }) {
      ForEach(titles, (title: string, index: number) => {
        Text(title)
          .fontSize(14)
          .fontWeight(this.tab === index ? FontWeight.Medium : FontWeight.Normal)
          .fontColor(this.tab === index ? $r('app.color.ink') : $r('app.color.ink2'))
          .textAlign(TextAlign.Center)
          .height(38)
          .layoutWeight(1)
          .borderRadius(9)
          .backgroundColor(this.tab === index ? $r('app.color.surface') : Color.Transparent)
          .onClick(() => {
            this.selectTab(index);
          })
      }, (title: string): string => title)
    }
    .width('100%')
    .padding(3)
    .borderRadius(12)
    .backgroundColor($r('app.color.surface2'))
  }

  @Builder
  timelineView(c: CustomerDetail) {
    Column() {
      if (this.timeline(c).length === 0) {
        Text('还没有跟进记录').fontSize(14).fontColor($r('app.color.ink3')).padding(20)
      }
      ForEach(this.timeline(c), (e: TimelineEntry) => {
        Row({ space: 10 }) {
          Row() {
            LvIcon({ name: e.icon, iconColor: $r('app.color.brand_ink'), iconSize: 16 })
          }
          .width(32).height(32).borderRadius(10).justifyContent(FlexAlign.Center).backgroundColor($r('app.color.brand_soft'))
          Column({ space: 4 }) {
            Row() {
              Text(e.title).fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).layoutWeight(1)
              Text(Fmt.ago(e.at)).fontSize(12).fontColor($r('app.color.ink3'))
            }
            .width('100%')
            if (e.body.length > 0) {
              Text(e.body).fontSize(14).fontColor($r('app.color.ink2')).lineHeight(22)
            }
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
        }
        .alignItems(VerticalAlign.Top)
        .width('100%')
        .padding({ top: 10, bottom: 10 })
      }, (e: TimelineEntry): string => e.key)
    }
    .width('100%')
  }

  @Builder
  profileView(c: CustomerDetail) {
    Column() {
      ForEach(this.profile(c), (row: InfoRow, index: number) => {
        Row({ space: 16 }) {
          Text(row.name).fontSize(14).fontColor($r('app.color.ink3'))
          Text(row.value).fontSize(14).fontColor($r('app.color.ink')).textAlign(TextAlign.End).layoutWeight(1)
            .copyOption(CopyOptions.LocalDevice)
        }
        .alignItems(VerticalAlign.Top)
        .width('100%')
        .padding({ top: 10, bottom: 10 })
        .border({ width: { top: index === 0 ? 0 : 0.5 }, color: $r('app.color.line_soft') })
      }, (row: InfoRow): string => row.name)
    }
    .width('100%')
    .padding({ left: 14, right: 14 })
    .backgroundColor($r('app.color.surface'))
    .borderRadius(16)
  }

  @Builder
  dealsAndQuotes(c: CustomerDetail) {
    Column({ space: 12 }) {
      if (c.deals.length > 0) {
        Column() {
          ForEach(c.deals, (d: DealRow, index: number) => {
            Row({ space: 10 }) {
              Column({ space: 3 }) {
                Text(`成交 ${Fmt.money(d.dealAmount, d.currency)}`).fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
                Text(`${Fmt.date(new Date(d.dealDate))}${d.order !== null ? ` · 订单 ${d.order.orderNo}` : ''}`).fontSize(12).fontColor($r('app.color.ink3'))
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              if (d.order !== null) {
                LvIcon({ name: 'chevron-right', iconColor: $r('app.color.ink3'), iconSize: 18 })
              }
            }
            .width('100%')
            .padding({ top: 12, bottom: 12 })
            .border({ width: { top: index === 0 ? 0 : 0.5 }, color: $r('app.color.line_soft') })
            .onClick(() => {
              if (d.order !== null) {
                this.pathStack.pushPathByName(Routes.ORDER, new RouteParam(d.order.id));
              }
            })
          }, (d: DealRow): string => d.id)
        }
        .padding({ left: 14, right: 14 })
        .borderRadius(16)
        .backgroundColor($r('app.color.surface'))
      }

      Text('报价单').fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).width('100%')
      if (this.quotesError.length > 0) {
        Text(this.quotesError).fontSize(13).fontColor($r('app.color.danger'))
      } else if (this.quotes === null) {
        LoadingProgress().width(28).height(28).color($r('app.color.brand_ink'))
      } else if ((this.quotes as Quotation[]).length === 0) {
        Text('还没有报价单。报价在电脑端「报价」里制作，发送后会显示在这里。').fontSize(13).fontColor($r('app.color.ink3')).lineHeight(20)
      } else {
        Column() {
          ForEach(this.quotes as Quotation[], (q: Quotation, index: number) => {
            Column({ space: 4 }) {
              Row() {
                Text(q.quoteNumber).fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).layoutWeight(1)
                Pill({ text: label(QUOTE_STATUS, q.status), tone: q.status === 'SENT' ? 'brand' : q.status === 'ACCEPTED' ? 'success' : 'neutral' })
              }
              .width('100%')
              Text(`${q.product} × ${q.quantity}${q.incoterm.length > 0 ? ` · ${q.incoterm}` : ''}`).fontSize(13).fontColor($r('app.color.ink2'))
                .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
              Row() {
                Text(q.sentAt !== null ? `发送 ${Fmt.ago(q.sentAt)}` : `创建 ${Fmt.ago(q.createdAt)}`).fontSize(12).fontColor($r('app.color.ink3')).layoutWeight(1)
                Text(q.totalAmount !== null ? Fmt.money(q.totalAmount, q.currency) : `单价 ${Fmt.money(q.unitPrice, q.currency)}`)
                  .fontSize(15).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
              }
              .width('100%')
            }
            .alignItems(HorizontalAlign.Start)
            .width('100%')
            .padding({ top: 12, bottom: 12 })
            .border({ width: { top: index === 0 ? 0 : 0.5 }, color: $r('app.color.line_soft') })
          }, (q: Quotation): string => q.id)
        }
        .padding({ left: 14, right: 14 })
        .borderRadius(16)
        .backgroundColor($r('app.color.surface'))
      }
    }
    .width('100%')
  }

  @Builder
  moreSheet() {
    if (this.moreKind === 'task') {
      TaskEditor({
        customerId: this.customerId,
        customerName: this.detail !== null ? (this.detail as CustomerDetail).name : '',
        task: null,
        onDone: () => {
          this.showMore = false;
          this.changed();
        },
        onClose: () => {
          this.showMore = false;
        }
      })
    } else {
      Column({ space: 10 }) {
        Text('分配给').fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
        if (this.assignError.length > 0) {
          Text(this.assignError).fontSize(13).fontColor($r('app.color.danger'))
        }
        if (this.accounts.length === 0 && this.assignError.length === 0) {
          LoadingProgress().width(28).height(28).color($r('app.color.brand_ink'))
        }
        ForEach(this.accounts, (a: SalesAccount) => {
          Row({ space: 12 }) {
            Avatar({ name: a.name, grade: '', avatarSize: 36 })
            Column({ space: 2 }) {
              Text(a.name).fontSize(15).fontColor($r('app.color.ink'))
              Text(`${a.role === 'ADMIN' ? '管理员' : '销售'} · ${a.customerCount} 位客户`).fontSize(12).fontColor($r('app.color.ink3'))
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)
            if (this.detail !== null && (this.detail as CustomerDetail).owner !== null &&
              ((this.detail as CustomerDetail).owner as OwnerName).name === a.name) {
              Text('当前').fontSize(12).fontColor($r('app.color.ink3'))
            }
          }
          .width('100%')
          .height(60)
          .padding({ left: 12, right: 12 })
          .borderRadius(12)
          .backgroundColor($r('app.color.surface2'))
          .onClick(() => {
            this.assignTo(a);
          })
        }, (a: SalesAccount): string => a.id)
        Text('分配后对方会收到新客户提醒，和电脑端分配一样。').fontSize(12).fontColor($r('app.color.ink3'))
      }
      .alignItems(HorizontalAlign.Start)
      .padding({ left: 16, right: 16, top: 8, bottom: 24 })
    }
  }

  @Builder
  followSheet() {
    Column({ space: 16 }) {
      Column({ space: 8 }) {
        Text('跟进方式').fontSize(14).fontColor($r('app.color.ink2'))
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(FOLLOW_TYPE_KEYS, (key: string) => {
            Text(label(FOLLOW_TYPES, key))
              .fontSize(14)
              .fontColor(this.followType === key ? $r('app.color.on_brand') : $r('app.color.ink2'))
              .backgroundColor(this.followType === key ? $r('app.color.brand') : $r('app.color.surface2'))
              .borderRadius(18)
              .height(36)
              .padding({ left: 14, right: 14 })
              .margin({ right: 8, bottom: 8 })
              .onClick(() => {
                this.followType = key;
              })
          }, (key: string): string => key)
        }
      }
      .alignItems(HorizontalAlign.Start)

      Column({ space: 8 }) {
        Text('跟进内容').fontSize(14).fontColor($r('app.color.ink2'))
        TextArea({ placeholder: '客户说了什么、我们答应了什么、下一步是什么', text: this.followText })
          .height(120)
          .fontSize(16)
          .borderRadius(12)
          .backgroundColor($r('app.color.surface2'))
          .onChange((value: string) => {
            this.followText = value;
            this.followError = '';
          })
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(PHRASES, (phrase: string) => {
            Text(phrase)
              .fontSize(13)
              .fontColor($r('app.color.ink2'))
              .backgroundColor($r('app.color.surface2'))
              .borderRadius(15)
              .height(30)
              .padding({ left: 12, right: 12 })
              .margin({ right: 6, bottom: 6 })
              .onClick(() => this.addPhrase(phrase))
          }, (phrase: string): string => phrase)
        }
        if (this.followError.length > 0) {
          Text(this.followError).fontSize(13).fontColor($r('app.color.danger'))
        }
      }
      .alignItems(HorizontalAlign.Start)

      Column({ space: 8 }) {
        Text('同时改阶段（可选）').fontSize(14).fontColor($r('app.color.ink2'))
        Flex({ wrap: FlexWrap.Wrap }) {
          Text('不改')
            .fontSize(14)
            .fontColor(this.followStage === '' ? $r('app.color.on_brand') : $r('app.color.ink2'))
            .backgroundColor(this.followStage === '' ? $r('app.color.brand') : $r('app.color.surface2'))
            .borderRadius(18).height(36).padding({ left: 14, right: 14 }).margin({ right: 8, bottom: 8 })
            .onClick(() => {
              this.followStage = '';
            })
          ForEach(STAGE_ORDER, (key: string) => {
            if (this.detail === null || key !== (this.detail as CustomerDetail).stage) {
              Text(label(STAGES, key))
                .fontSize(14)
                .fontColor(this.followStage === key ? $r('app.color.on_brand') : $r('app.color.ink2'))
                .backgroundColor(this.followStage === key ? $r('app.color.brand') : $r('app.color.surface2'))
                .borderRadius(18).height(36).padding({ left: 14, right: 14 }).margin({ right: 8, bottom: 8 })
                .onClick(() => {
                  this.followStage = key;
                })
            }
          }, (key: string): string => key)
        }
      }
      .alignItems(HorizontalAlign.Start)

      Column({ space: 8 }) {
        Text('下次跟进').fontSize(14).fontColor($r('app.color.ink2'))
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(NEXT_OPTIONS, (option: NextOption, index: number) => {
            Text(option.title)
              .fontSize(14)
              .fontColor(this.nextIndex === index ? $r('app.color.on_brand') : $r('app.color.ink2'))
              .backgroundColor(this.nextIndex === index ? $r('app.color.brand') : $r('app.color.surface2'))
              .borderRadius(18)
              .height(36)
              .padding({ left: 14, right: 14 })
              .margin({ right: 8, bottom: 8 })
              .onClick(() => {
                this.nextIndex = index;
              })
          }, (option: NextOption): string => option.title)
          Row({ space: 4 }) {
            LvIcon({
              name: 'calendar-clock',
              iconColor: this.nextIndex === NEXT_OPTIONS.length ? $r('app.color.on_brand') : $r('app.color.brand_ink'),
              iconSize: 15
            })
            Text(this.customNextText())
              .fontSize(14)
              .fontColor(this.nextIndex === NEXT_OPTIONS.length ? $r('app.color.on_brand') : $r('app.color.brand_ink'))
          }
          .height(36)
          .padding({ left: 12, right: 14 })
          .margin({ right: 8, bottom: 8 })
          .borderRadius(18)
          .backgroundColor(this.nextIndex === NEXT_OPTIONS.length ? $r('app.color.brand') : $r('app.color.brand_soft'))
          .onClick(() => this.pickNextDate())
        }
      }
      .alignItems(HorizontalAlign.Start)

      Button(this.saving ? '正在保存' : '保存跟进')
        .type(ButtonType.Normal)
        .width('100%')
        .height(48)
        .borderRadius(12)
        .fontColor($r('app.color.on_brand'))
        .backgroundColor($r('app.color.brand'))
        .enabled(!this.saving)
        .onClick(() => {
          this.saveFollowUp();
        })
    }
    .padding({ left: 16, right: 16, top: 8, bottom: 24 })
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  stageSheet() {
    Column({ space: 16 }) {
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(STAGE_ORDER, (key: string) => {
          Text(label(STAGES, key))
            .fontSize(14)
            .fontColor(this.stageTo === key ? $r('app.color.on_brand') : $r('app.color.ink2'))
            .backgroundColor(this.stageTo === key ? $r('app.color.brand') : $r('app.color.surface2'))
            .borderRadius(18)
            .height(36)
            .padding({ left: 14, right: 14 })
            .margin({ right: 8, bottom: 8 })
            .onClick(() => {
              this.stageTo = key;
              this.stageError = '';
            })
        }, (key: string): string => key)
      }
      if (REASON_STAGES.indexOf(this.stageTo) >= 0) {
        Column({ space: 8 }) {
          Text('原因（管理员会复核）').fontSize(14).fontColor($r('app.color.ink2'))
          TextArea({ placeholder: '例如：客户说明年再采购 / 价格不合适 / 号码无效', text: this.stageReason })
            .height(96)
            .fontSize(16)
            .borderRadius(12)
            .backgroundColor($r('app.color.surface2'))
            .onChange((value: string) => {
              this.stageReason = value;
              this.stageError = '';
            })
        }
        .alignItems(HorizontalAlign.Start)
      }
      if (this.stageError.length > 0) {
        Text(this.stageError).fontSize(13).fontColor($r('app.color.danger'))
      }
      Text('成交请在电脑端客户档案里「新增成交」登记，阶段会自动变为已成交。').fontSize(12).fontColor($r('app.color.ink3'))
      Button(this.stageSaving ? '正在保存' : '保存阶段')
        .type(ButtonType.Normal)
        .width('100%')
        .height(48)
        .borderRadius(12)
        .fontColor($r('app.color.on_brand'))
        .backgroundColor($r('app.color.brand'))
        .enabled(!this.stageSaving)
        .onClick(() => {
          this.saveStage();
        })
    }
    .padding({ left: 16, right: 16, top: 8, bottom: 24 })
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    NavDestination() {
      Column() {
        if (this.state === 'loading') {
          StateView({ kind: 'loading' }).layoutWeight(1)
        } else if (this.state === 'error' || this.detail === null) {
          StateView({ kind: 'error', message: this.error, actionText: '重新加载', onAction: () => {
            this.state = 'loading';
            this.load();
          } }).layoutWeight(1)
        } else {
          Scroll() {
            Column() {
              // One item per detail snapshot: a refreshed customer rebuilds the body with its new values.
              ForEach([this.rev], (r: number) => {
                Column({ space: 14 }) {
                  this.header(this.detail as CustomerDetail)
                  if (this.dueIso(this.detail as CustomerDetail) !== null) {
                    this.dueStrip(this.detail as CustomerDetail)
                  }
                  if ((this.detail as CustomerDetail).aiSummary.length > 0 || (this.detail as CustomerDetail).aiNextAction.length > 0) {
                    this.aiCard(this.detail as CustomerDetail)
                  }
                  this.segment(['动态', '资料', '成交与报价'])
                  if (this.tab === 0) {
                    this.timelineView(this.detail as CustomerDetail)
                  } else if (this.tab === 1) {
                    this.profileView(this.detail as CustomerDetail)
                  } else {
                    this.dealsAndQuotes(this.detail as CustomerDetail)
                  }
                }
                .padding({ left: 16, right: 16, top: 8, bottom: 24 })
              }, (r: number): string => `${r}`)
            }
          }
          .scrollBar(BarState.Off)
          .align(Alignment.Top)
          .layoutWeight(1)
          .bindSheet($$this.showStage, this.stageSheet(), {
            detents: [SheetSize.MEDIUM, SheetSize.LARGE],
            dragBar: true,
            title: { title: '改阶段', subtitle: this.detail !== null ? `当前：${label(STAGES, this.detail.stage)}` : '' }
          })

          Column() {
            Row({ space: 10 }) {
              Button('打电话')
                .type(ButtonType.Normal).height(48).borderRadius(12).layoutWeight(1)
                .fontColor($r('app.color.ink')).backgroundColor($r('app.color.surface'))
                .border({ width: 1, color: $r('app.color.line') })
                .onClick(() => {
                  const c = this.detail;
                  if (c !== null) {
                    this.dial(c.phone.length > 0 ? c.phone : c.whatsapp);
                  }
                })
              Button('WhatsApp')
                .type(ButtonType.Normal).height(48).borderRadius(12).layoutWeight(1)
                .fontColor($r('app.color.brand_ink')).backgroundColor($r('app.color.brand_soft'))
                .onClick(() => this.openChat())
              Button('写跟进')
                .type(ButtonType.Normal).height(48).borderRadius(12).layoutWeight(1)
                .fontColor($r('app.color.on_brand')).backgroundColor($r('app.color.brand'))
                .onClick(() => {
                  this.showFollow = true;
                })
            }
            .width('100%')
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 10, bottom: 12 })
          .backgroundColor($r('app.color.surface'))
          .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
          .bindSheet($$this.showMore, this.moreSheet(), { detents: [SheetSize.LARGE], dragBar: true })
        }
      }
      .width('100%')
      .height('100%')
      .bindSheet($$this.showFollow, this.followSheet(), {
        detents: [SheetSize.LARGE],
        dragBar: true,
        title: { title: '写跟进', subtitle: this.detail !== null ? this.detail.name : '' }
      })
    }
    .title(this.detail !== null ? this.detail.name : '客户')
    .backgroundColor($r('app.color.bg'))
  }
}
