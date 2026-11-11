import { Api } from '../../api/Http';
import { Repo } from '../../api/Repo';
import { QuickReply, QuickReplyList } from '../../api/Models';
import { LvIcon } from '../../components/LvIcon';
import { Pill } from '../../components/Ui';

/** The reply in the customer's language (lib/quick-replies.ts: fr / en / ar), else English, else the Chinese. */
function bodyFor(reply: QuickReply, language: string): string {
  const own = reply.bodies[language];
  if (own !== undefined && own.length > 0) return own;
  const english = reply.bodies['en'];
  if (english !== undefined && english.length > 0) return english;
  return reply.zh;
}

/** {客户名} and {我的名字}, filled as on the PC. */
function fill(text: string, customer: string, me: string): string {
  return text.split('{客户名}').join(customer).split('{我的名字}').join(me);
}

/**
 * 快捷回复 (GET /api/quick-replies): the company's and my own replies, most used first. Choosing one fills the
 * input box in the customer's language with the names filled in; nothing is sent from here.
 */
@Component
export struct QuickReplySheet {
  @Prop customerId: string = '';
  onUse: (text: string, zh: string) => void = () => {};
  onClose: () => void = () => {};
  @State state: string = 'loading';
  @State error: string = '';
  @State replies: QuickReply[] = [];
  @State keyword: string = '';
  @State language: string = 'en';
  @State firstName: string = '';
  @State me: string = '';

  aboutToAppear(): void {
    const cached = Repo.peekQuickReplies(this.customerId);
    if (cached !== null) {
      this.apply(cached);
      this.state = 'ready';
    }
    this.load();
  }

  private apply(list: QuickReplyList): void {
    this.replies = list.replies;
    this.me = list.me;
    if (list.customer !== null) {
      this.language = list.customer.language;
      this.firstName = list.customer.firstName;
    }
  }

  private async load(): Promise<void> {
    try {
      this.apply(await Repo.quickReplies(this.customerId));
      this.state = 'ready';
    } catch (e) {
      this.error = Api.message(e);
      if (this.state !== 'ready') {
        this.state = 'error';
      }
    }
  }

  private visible(): QuickReply[] {
    const k = this.keyword.trim().toLowerCase();
    if (k.length === 0) return this.replies;
    return this.replies.filter((r: QuickReply): boolean =>
      r.title.toLowerCase().indexOf(k) >= 0 || r.zh.toLowerCase().indexOf(k) >= 0 || r.category.toLowerCase().indexOf(k) >= 0);
  }

  private textOf(r: QuickReply): string {
    return fill(bodyFor(r, this.language), this.firstName, this.me);
  }

  @Builder
  row(r: QuickReply) {
    Column({ space: 6 }) {
      Row({ space: 6 }) {
        Text(r.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).layoutWeight(1)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (r.top) {
          Pill({ text: '最常用', tone: 'brand' })
        }
        if (r.category.length > 0) {
          Pill({ text: r.category, tone: 'neutral' })
        }
      }
      .width('100%')
      Text(this.textOf(r)).fontSize(14).fontColor($r('app.color.ink')).lineHeight(21).maxLines(4)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      if (r.zh.length > 0 && r.zh !== this.textOf(r)) {
        Text(`中文：${fill(r.zh, this.firstName, this.me)}`).fontSize(12).fontColor($r('app.color.ink3')).lineHeight(18)
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(14)
    .borderRadius(14)
    .backgroundColor($r('app.color.surface2'))
    .onClick(() => {
      this.onUse(this.textOf(r), fill(r.zh, this.firstName, this.me));
    })
  }

  build() {
    Column({ space: 10 }) {
      Row() {
        Text('快捷回复').fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink')).layoutWeight(1)
        Row() {
          LvIcon({ name: 'x', iconColor: $r('app.color.ink2'), iconSize: 22 })
        }
        .width(40).height(40).justifyContent(FlexAlign.Center)
        .onClick(() => this.onClose())
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 4 })

      Search({ value: this.keyword, placeholder: '搜索标题、中文、分类' })
        .height(42)
        .margin({ left: 16, right: 16 })
        .backgroundColor($r('app.color.surface2'))
        .onChange((value: string) => {
          this.keyword = value;
        })

      if (this.state === 'loading') {
        LoadingProgress().width(32).height(32).color($r('app.color.brand_ink')).margin({ top: 24 })
      } else if (this.state === 'error') {
        Text(this.error).fontSize(14).fontColor($r('app.color.danger')).padding(16)
      } else if (this.visible().length === 0) {
        Text(this.replies.length === 0 ? '还没有快捷回复。可以在电脑端「消息中心 → 快捷回复」里添加，手机上就能直接用。' : '没有找到匹配的快捷回复')
          .fontSize(14).fontColor($r('app.color.ink3')).lineHeight(21).padding(16)
      } else {
        List({ space: 10 }) {
          ForEach(this.visible(), (r: QuickReply) => {
            ListItem() {
              this.row(r)
            }
          }, (r: QuickReply): string => r.id)
        }
        .cachedCount(4)
        .padding({ left: 16, right: 16, bottom: 24 })
        .scrollBar(BarState.Off)
        .layoutWeight(1)
      }
    }
    .width('100%')
    .height('100%')
  }
}
