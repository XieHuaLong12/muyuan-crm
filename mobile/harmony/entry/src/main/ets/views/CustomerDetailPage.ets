import { call } from '@kit.TelephonyKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { Fmt } from '../common/Format';
import { FOLLOW_TYPES, FOLLOW_TYPE_KEYS, PURCHASES, SOURCES, STAGES, label, stageTone } from '../common/Labels';
import { Api } from '../data/Http';
import { Repo } from '../data/Repo';
import { CustomerDetail, DealRow, FollowUpBody, FollowUpRow, StageChange } from '../data/Models';
import { LvIcon } from '../components/LvIcon';
import { Avatar, Pill, StateView } from '../components/Ui';

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

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    try {
      this.detail = await Repo.customer(this.customerId);
      this.state = 'ready';
    } catch (e) {
      this.error = Api.message(e);
      this.state = 'error';
    }
  }

  private toast(message: string): void {
    this.getUIContext().getPromptAction().showToast({ message: message, duration: 2200 });
  }

  private dial(number: string): void {
    const digits = number.replace(/[^\d+]/g, '');
    if (digits.length === 0) {
      this.toast('这位客户没有电话号码');
      return;
    }
    call.makeCall(digits).catch(() => this.toast('无法打开拨号界面'));
  }

  private copy(text: string, done: string): void {
    if (text.length === 0) {
      this.toast('没有可复制的内容');
      return;
    }
    const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
    pasteboard.getSystemPasteboard().setData(data).then(() => this.toast(done)).catch(() => this.toast('复制失败'));
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
    return rows.filter((r: InfoRow) => r.value.length > 0);
  }

  private async saveFollowUp(): Promise<void> {
    const content = this.followText.trim();
    if (content.length === 0) {
      this.followError = '请填写跟进内容';
      return;
    }
    const option = NEXT_OPTIONS[this.nextIndex];
    const body: FollowUpBody = {
      type: this.followType,
      content: content,
      followUpAt: new Date().toISOString(),
      nextFollowUpAt: option.days < 0 ? null : Fmt.atDay(option.days, 10)
    };
    this.saving = true;
    this.followError = '';
    try {
      await Repo.addFollowUp(this.customerId, body);
      this.showFollow = false;
      this.followText = '';
      this.toast(option.days < 0 ? '跟进已保存' : `跟进已保存 · 下次 ${option.title}`);
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
        LvIcon({ name: icon, iconColor: $r('app.color.brand_ink'), size: 21 })
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
        Pill({ text: label(STAGES, c.stage), tone: stageTone(c.stage) })
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
        this.contactButton('message-circle', 'WhatsApp', c.whatsapp.length > 0, () => this.copy(c.whatsapp, '已复制 WhatsApp 号码。App 内的 WhatsApp 会话将在下一版加入'))
        this.contactButton('mail', '邮件', c.email.length > 0, () => this.copy(c.email, '已复制邮箱'))
        this.contactButton('pencil', '写跟进', true, () => {
          this.showFollow = true;
        })
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
        size: 20
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
        LvIcon({ name: 'sparkles', iconColor: $r('app.color.brand_ink'), size: 16 })
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
            this.tab = index;
          })
      }, (title: string) => title)
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
            LvIcon({ name: e.icon, iconColor: $r('app.color.brand_ink'), size: 16 })
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
      }, (e: TimelineEntry) => e.key)
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
      }, (row: InfoRow) => row.name)
    }
    .width('100%')
    .padding({ left: 14, right: 14 })
    .backgroundColor($r('app.color.surface'))
    .borderRadius(16)
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
          }, (key: string) => key)
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
        if (this.followError.length > 0) {
          Text(this.followError).fontSize(13).fontColor($r('app.color.danger'))
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
          }, (option: NextOption) => option.title)
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
            Column({ space: 14 }) {
              this.header(this.detail as CustomerDetail)
              if (this.dueIso(this.detail as CustomerDetail) !== null) {
                this.dueStrip(this.detail as CustomerDetail)
              }
              if ((this.detail as CustomerDetail).aiSummary.length > 0 || (this.detail as CustomerDetail).aiNextAction.length > 0) {
                this.aiCard(this.detail as CustomerDetail)
              }
              this.segment(['动态', '资料'])
              if (this.tab === 0) {
                this.timelineView(this.detail as CustomerDetail)
              } else {
                this.profileView(this.detail as CustomerDetail)
              }
            }
            .padding({ left: 16, right: 16, top: 8, bottom: 24 })
          }
          .scrollBar(BarState.Off)
          .align(Alignment.Top)
          .layoutWeight(1)

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
            Button('写跟进')
              .type(ButtonType.Normal).height(48).borderRadius(12).layoutWeight(1)
              .fontColor($r('app.color.on_brand')).backgroundColor($r('app.color.brand'))
              .onClick(() => {
                this.showFollow = true;
              })
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 10, bottom: 12 })
          .backgroundColor($r('app.color.surface'))
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
