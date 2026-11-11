import { KeyboardAvoidMode } from '@kit.ArkUI';
import { AppConfig, RouteParam, Routes, StoreKeys } from '../common/Config';
import { Fmt } from '../common/Format';
import { STAGES, label, stageTone } from '../common/Labels';
import { Api } from '../api/Http';
import { Inbox } from '../api/Inbox';
import { Repo } from '../api/Repo';
import { ChatMessage, SentMessage, Thread } from '../api/Models';
import { LvIcon } from '../components/LvIcon';
import { ListSource } from '../components/ListSource';
import { Pill, StateView } from '../components/Ui';

/** Media kinds as the PC names them (lib/message-preview.ts). */
const MEDIA: Record<string, string> = {
  'IMAGE': '图片', 'VIDEO': '视频', 'AUDIO': '语音', 'VOICE': '语音', 'DOCUMENT': '文件', 'FILE': '文件',
  'STICKER': '贴纸', 'LOCATION': '位置', 'TEMPLATE': '模板消息'
};

/** One row of the conversation: a day divider (message === null) or a message. */
class ChatRow {
  key: string = '';
  day: string = '';
  message: ChatMessage | null = null;
}

function isMedia(m: ChatMessage): boolean {
  return MEDIA[m.messageType] !== undefined;
}

function mediaIcon(type: string): string {
  if (type === 'IMAGE' || type === 'STICKER') return 'image';
  if (type === 'AUDIO' || type === 'VOICE') return 'mic';
  if (type === 'LOCATION') return 'map-pin';
  return 'file-text';
}

/** What the bubble says: the text, or 「[图片] 文件名」 for media without a caption. */
function bodyOf(m: ChatMessage): string {
  const text = m.content.trim();
  if (isMedia(m) && (text.length === 0 || /^\[[^\]]*\]$/.test(text))) {
    const name = m.fileName;
    return `[${MEDIA[m.messageType]}]${name ? ` ${name}` : ''}`;
  }
  return m.content;
}

function translationOf(m: ChatMessage): string {
  const t = m.translation;
  return t ? t.text : '';
}

function statusIcon(status: string): string {
  if (status === 'READ' || status === 'DELIVERED') return 'check-check';
  if (status === 'SENT' || status === 'ENQUEUED') return 'check';
  if (status === 'FAILED') return 'circle-alert';
  return 'clock';
}

function dayOf(iso: string): string {
  const d = Fmt.parse(iso);
  if (d === null) return '';
  const diff = Fmt.dayDiff(d);
  if (diff === 0) return '今天';
  if (diff === -1) return '昨天';
  return `${d.getFullYear()}-${Fmt.pad(d.getMonth() + 1)}-${Fmt.pad(d.getDate())}`;
}

function rowsOf(messages: ChatMessage[]): ChatRow[] {
  const rows: ChatRow[] = [];
  let last = '';
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const day = dayOf(m.sentAt);
    if (day !== last) {
      const divider = new ChatRow();
      divider.key = `day-${m.id}`;
      divider.day = day;
      rows.push(divider);
      last = day;
    }
    const row = new ChatRow();
    row.key = m.id;
    row.message = m;
    rows.push(row);
  }
  return rows;
}

/** Changes only when a message was added or its delivery status moved. */
function signatureOf(messages: ChatMessage[]): string {
  const parts: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    parts.push(`${messages[i].id}:${messages[i].status}`);
  }
  return parts.join('|');
}

/**
 * WhatsApp conversation with one customer — the PC 消息中心 thread (GET /api/inbox/thread, POST /api/whatsapp/send).
 * Free text only inside the 24-hour window; outside it WhatsApp only accepts approved templates, which are still
 * sent from the PC. New messages are checked every 15 seconds while the page is open.
 */
@Component
export struct ChatPage {
  customerId: string = '';
  @Consume('pathStack') pathStack: NavPathStack;
  @State thread: Thread | null = null;
  @State state: string = 'loading';
  @State error: string = '';
  @State draft: string = '';
  @State sending: boolean = false;
  @State count: number = 0;
  @State olderCursor: string | null = null;
  @State loadingOlder: boolean = false;
  private messages: ChatMessage[] = [];
  private olderLoaded: boolean = false;
  private source: ListSource<ChatRow> = new ListSource<ChatRow>();
  private scroller: Scroller = new Scroller();
  private timer: number = -1;

  aboutToAppear(): void {
    // The message list shrinks above the keyboard instead of the whole page sliding up.
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    const cached = Repo.peekThread(this.customerId);
    if (cached !== null) {
      this.thread = cached;
      this.olderCursor = cached.nextCursor;
      this.show(cached.messages, true);
      this.state = 'ready';
    }
    this.load(true);
    this.timer = setInterval(() => {
      this.load(false);
    }, AppConfig.CHAT_INTERVAL_MS);
  }

  aboutToDisappear(): void {
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.OFFSET);
    if (this.timer !== -1) {
      clearInterval(this.timer);
    }
    AppStorage.setOrCreate<number>(StoreKeys.CHAT_CLOSED, Date.now());
    Inbox.refresh();
  }

  private toast(message: string): void {
    this.getUIContext().getPromptAction().showToast({ message: message, duration: 2200 });
  }

  private show(messages: ChatMessage[], toEnd: boolean): void {
    this.messages = messages;
    const rows = rowsOf(messages);
    this.source.reset(rows);
    this.count = rows.length;
    if (toEnd) {
      this.scrollToEnd();
    }
  }

  private scrollToEnd(): void {
    setTimeout(() => {
      this.scroller.scrollEdge(Edge.Bottom);
    }, 80);
  }

  private lastId(messages: ChatMessage[]): string {
    return messages.length > 0 ? messages[messages.length - 1].id : '';
  }

  /** Newest page from the server, keeping older pages the user already opened. */
  private merge(fresh: ChatMessage[]): ChatMessage[] {
    if (!this.olderLoaded || fresh.length === 0) {
      return fresh;
    }
    const firstId = fresh[0].id;
    const index = this.messages.findIndex((m: ChatMessage): boolean => m.id === firstId);
    return index > 0 ? this.messages.slice(0, index).concat(fresh) : fresh;
  }

  private async load(first: boolean): Promise<void> {
    if (this.sending) {
      return;
    }
    try {
      const thread = await Repo.thread(this.customerId, '');
      const merged = this.merge(thread.messages);
      const grew = this.lastId(merged) !== this.lastId(this.messages);
      const changed = signatureOf(merged) !== signatureOf(this.messages);
      this.thread = thread;
      if (!this.olderLoaded) {
        this.olderCursor = thread.nextCursor;
      }
      if (changed || this.state !== 'ready') {
        this.show(merged, first || grew);
      }
      this.state = 'ready';
      if (first || grew) {
        Repo.markRead(this.customerId).catch(() => {});
      }
    } catch (e) {
      if (this.state !== 'ready') {
        this.error = Api.message(e);
        this.state = 'error';
      } else if (first) {
        this.toast(`没有连上服务器，显示的是上次的消息。${Api.message(e)}`);
      }
    }
  }

  private async older(): Promise<void> {
    const cursor = this.olderCursor;
    if (cursor === null || this.loadingOlder) {
      return;
    }
    this.loadingOlder = true;
    try {
      const page = await Repo.thread(this.customerId, cursor);
      this.olderLoaded = true;
      this.olderCursor = page.nextCursor;
      const added = rowsOf(page.messages).length;
      this.show(page.messages.concat(this.messages), false);
      // Keep the message the user was reading in place.
      setTimeout(() => {
        this.scroller.scrollToIndex(added);
      }, 80);
    } catch (e) {
      this.toast(Api.message(e));
    } finally {
      this.loadingOlder = false;
    }
  }

  private async send(): Promise<void> {
    const text = this.draft.trim();
    if (text.length === 0 || this.sending) {
      return;
    }
    const requestId = Repo.newRequestId();
    const local: ChatMessage = {
      id: `local-${requestId}`, direction: 'OUTBOUND', messageType: 'TEXT', content: text, status: 'PENDING',
      sentAt: new Date().toISOString(), fileName: null, translation: null
    };
    this.sending = true;
    this.draft = '';
    this.show(this.messages.concat([local]), true);
    try {
      const result: SentMessage = await Repo.sendWhatsApp(this.customerId, text, requestId);
      const sent = result.message;
      this.show(this.messages.map((m: ChatMessage): ChatMessage => m.id === local.id ? sent : m), false);
      if (sent.status === 'FAILED') {
        this.toast('WhatsApp 没有发出去，请稍后重试或在电脑端查看原因');
      }
    } catch (e) {
      this.show(this.messages.filter((m: ChatMessage): boolean => m.id !== local.id), false);
      this.draft = text;
      this.toast(Api.message(e));
    } finally {
      this.sending = false;
    }
  }

  /** Why free text cannot be sent right now, or '' when it can. */
  private blockReason(): string {
    const t = this.thread;
    if (t === null) return '';
    if (!t.sending.configured) return 'WhatsApp 发送还没有配置，请联系管理员。';
    if (t.sending.optedOut) return '客户已退订 WhatsApp 消息，不能再发送。';
    if (t.window.status !== 'OPEN') {
      return '客户超过 24 小时没有发来消息，WhatsApp 只允许发送已审核的模板消息。请在电脑端「消息中心」选择模板发送。';
    }
    return '';
  }

  private windowHint(): string {
    const t = this.thread;
    if (t === null || t.window.status !== 'OPEN') return '';
    const end = Fmt.parse(t.window.expiresAt);
    if (end === null) return '';
    const hours = (end.getTime() - Date.now()) / 3600000;
    if (hours <= 0) return '';
    return hours >= 1 ? `可直接回复 · 24 小时窗口还剩 ${Math.floor(hours)} 小时` : `可直接回复 · 窗口还剩 ${Math.max(1, Math.round(hours * 60))} 分钟`;
  }

  private openCustomer(): void {
    const names = this.pathStack.getAllPathName();
    if (names.length >= 2 && names[names.length - 2] === Routes.CUSTOMER) {
      this.pathStack.pop();
    } else {
      this.pathStack.pushPathByName(Routes.CUSTOMER, new RouteParam(this.customerId));
    }
  }

  @Builder
  header(t: Thread) {
    Row({ space: 10 }) {
      Column({ space: 4 }) {
        Text(`${t.customer.companyName.length > 0 ? `${t.customer.companyName} · ` : ''}${t.customer.country}`)
          .fontSize(13).fontColor($r('app.color.ink2')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Row({ space: 6 }) {
          Pill({ text: label(STAGES, t.customer.stage), tone: stageTone(t.customer.stage) })
          Pill({ text: t.window.status === 'OPEN' ? '可回复' : '需模板', tone: t.window.status === 'OPEN' ? 'brand' : 'warning' })
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Button('客户档案')
        .type(ButtonType.Normal).height(34).borderRadius(17).fontSize(13)
        .fontColor($r('app.color.brand_ink')).backgroundColor($r('app.color.brand_soft'))
        .onClick(() => this.openCustomer())
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 8, bottom: 10 })
    .backgroundColor($r('app.color.surface'))
    .border({ width: { bottom: 0.5 }, color: $r('app.color.line') })
  }

  @Builder
  bubble(m: ChatMessage) {
    Column({ space: 4 }) {
      if (isMedia(m)) {
        Row({ space: 6 }) {
          LvIcon({ name: mediaIcon(m.messageType), iconColor: $r('app.color.ink2'), iconSize: 16 })
          Text('附件请在电脑端查看').fontSize(12).fontColor($r('app.color.ink3'))
        }
      }
      Text(bodyOf(m))
        .fontSize(15).fontColor($r('app.color.ink')).lineHeight(22)
        .copyOption(CopyOptions.LocalDevice)
      if (translationOf(m).length > 0) {
        Text(`译：${translationOf(m)}`).fontSize(13).fontColor($r('app.color.ink2')).lineHeight(20)
          .copyOption(CopyOptions.LocalDevice)
      }
      Row({ space: 4 }) {
        Text(Fmt.parse(m.sentAt) !== null ? Fmt.time(Fmt.parse(m.sentAt) as Date) : '')
          .fontSize(11).fontColor($r('app.color.ink3'))
        if (m.direction === 'OUTBOUND') {
          LvIcon({
            name: statusIcon(m.status),
            iconColor: m.status === 'READ' ? $r('app.color.brand_ink') : m.status === 'FAILED' ? $r('app.color.danger') : $r('app.color.ink3'),
            iconSize: 13
          })
        }
      }
    }
    .alignItems(m.direction === 'OUTBOUND' ? HorizontalAlign.End : HorizontalAlign.Start)
    .padding({ left: 12, right: 12, top: 8, bottom: 6 })
    .borderRadius(14)
    .backgroundColor(m.direction === 'OUTBOUND' ? $r('app.color.brand_soft') : $r('app.color.surface'))
    .constraintSize({ maxWidth: '80%' })
  }

  @Builder
  rowView(row: ChatRow) {
    if (row.message === null) {
      Text(row.day).fontSize(12).fontColor($r('app.color.ink3')).width('100%').textAlign(TextAlign.Center)
        .padding({ top: 6, bottom: 2 })
    } else {
      Row() {
        this.bubble(row.message as ChatMessage)
      }
      .width('100%')
      .justifyContent((row.message as ChatMessage).direction === 'OUTBOUND' ? FlexAlign.End : FlexAlign.Start)
    }
  }

  @Builder
  composer() {
    Column({ space: 6 }) {
      if (this.blockReason().length > 0) {
        Row({ space: 8 }) {
          LvIcon({ name: 'clock', iconColor: $r('app.color.warning'), iconSize: 18 })
          Text(this.blockReason()).fontSize(13).fontColor($r('app.color.ink2')).lineHeight(19).layoutWeight(1)
        }
        .alignItems(VerticalAlign.Top)
        .width('100%')
        .padding(12)
        .borderRadius(12)
        .backgroundColor($r('app.color.surface2'))
      } else {
        if (this.windowHint().length > 0) {
          Text(this.windowHint()).fontSize(12).fontColor($r('app.color.ink3')).width('100%')
        }
        Row({ space: 8 }) {
          TextArea({ placeholder: '输入要发给客户的消息', text: this.draft })
            .layoutWeight(1)
            .constraintSize({ minHeight: 44, maxHeight: 120 })
            .fontSize(16)
            .borderRadius(12)
            .backgroundColor($r('app.color.surface2'))
            .onChange((value: string) => {
              this.draft = value;
            })
          Button({ type: ButtonType.Circle, stateEffect: true }) {
            LvIcon({ name: 'send', iconColor: Color.White, iconSize: 20 })
          }
          .width(44)
          .height(44)
          .backgroundColor(this.draft.trim().length > 0 && !this.sending ? $r('app.color.brand') : $r('app.color.ink3'))
          .enabled(this.draft.trim().length > 0 && !this.sending)
          .onClick(() => {
            this.send();
          })
        }
        .alignItems(VerticalAlign.Bottom)
        .width('100%')
      }
    }
    .width('100%')
    .padding({ left: 12, right: 12, top: 8, bottom: 10 })
    .backgroundColor($r('app.color.surface'))
    .border({ width: { top: 0.5 }, color: $r('app.color.line') })
  }

  build() {
    NavDestination() {
      Column() {
        if (this.thread !== null) {
          this.header(this.thread as Thread)
        }
        if (this.state === 'loading') {
          StateView({ kind: 'loading' }).layoutWeight(1)
        } else if (this.state === 'error') {
          StateView({ kind: 'error', message: this.error, actionText: '重新加载', onAction: () => {
            this.state = 'loading';
            this.load(true);
          } }).layoutWeight(1)
        } else {
          List({ space: 8, scroller: this.scroller }) {
            if (this.olderCursor !== null) {
              ListItem() {
                Text(this.loadingOlder ? '正在加载' : '查看更早的消息')
                  .fontSize(13).fontColor($r('app.color.brand_ink')).width('100%').textAlign(TextAlign.Center)
                  .padding(8)
                  .onClick(() => {
                    this.older();
                  })
              }
            }
            if (this.count === 0) {
              ListItem() {
                StateView({ kind: 'empty', icon: 'message-circle', title: '还没有 WhatsApp 消息', message: '客户发来消息或你发出消息后会显示在这里。' })
              }
            }
            LazyForEach(this.source, (row: ChatRow) => {
              ListItem() {
                this.rowView(row)
              }
            }, (row: ChatRow): string => `${this.source.generation}-${row.key}`)
          }
          .cachedCount(10)
          .padding({ left: 12, right: 12, top: 8, bottom: 8 })
          .scrollBar(BarState.Off)
          .layoutWeight(1)

          this.composer()
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor($r('app.color.bg'))
    }
    .title(this.thread !== null ? (this.thread as Thread).customer.name : 'WhatsApp')
    .backgroundColor($r('app.color.bg'))
  }
}
