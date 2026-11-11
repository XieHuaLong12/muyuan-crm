import { KeyboardAvoidMode } from '@kit.ArkUI';
import { AppConfig, RouteParam, Routes, StoreKeys } from '../common/Config';
import { Fmt } from '../common/Format';
import { STAGES, label, stageTone } from '../common/Labels';
import { Api } from '../api/Http';
import { Inbox } from '../api/Inbox';
import { Repo } from '../api/Repo';
import { ChatMessage, SentMessage, TemplateList, TemplateSent, Thread, VariableFill, WaTemplate } from '../api/Models';
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

/** The text the customer will receive: {{n}} replaced by the filled values (lib: renderTemplate on the server). */
function renderTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (whole: string, n: string): string => {
    const value = params[Number(n) - 1];
    return value !== undefined && value.trim().length > 0 ? value : whole;
  });
}

function categoryLabel(category: string): string {
  const c = category.toUpperCase();
  if (c === 'MARKETING') return '营销';
  if (c === 'UTILITY') return '服务通知';
  if (c === 'AUTHENTICATION') return '验证';
  return category.length > 0 ? category : '模板';
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
 * Free text inside the 24-hour window. Outside it (or to contact a customer first) WhatsApp only delivers templates
 * Meta approved: the salesperson picks one (GET /api/whatsapp/templates, variables pre-filled from the customer) and
 * sends it (POST /api/whatsapp/templates) with the PC rules. New messages are checked every 15 seconds.
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
  // 模板消息
  @State showTemplates: boolean = false;
  @State tplState: string = 'loading';
  @State tplStatus: string = '';
  @State tplError: string = '';
  @State templates: WaTemplate[] = [];
  @State tplIndex: number = -1;
  @State suggestedId: string = '';
  @State params: string[] = [];
  @State paramLabels: string[] = [];
  @State tplSending: boolean = false;
  private tplList: TemplateList | null = null;
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

  /** text: free reply; template: only an approved template (window closed or never opened); blocked: nothing. */
  private mode(): string {
    const t = this.thread;
    if (t === null || t.sending.optedOut) return 'blocked';
    if (t.window.status === 'OPEN') return t.sending.configured ? 'text' : 'blocked';
    return 'template';
  }

  private blockReason(): string {
    const t = this.thread;
    if (t !== null && t.sending.optedOut) return '客户已退订 WhatsApp 消息，不能再发送。';
    return 'WhatsApp 发送还没有配置，请联系管理员。';
  }

  private templateNote(): string {
    if (this.count === 0) {
      return '还没有和这位客户在 WhatsApp 上聊过。按 WhatsApp 规定，企业号码第一次联系客户只能发 Meta 审核过的模板消息；客户回复后 24 小时内就可以直接聊天。';
    }
    return '客户超过 24 小时没有发来消息，按 WhatsApp 规定只能先发一条审核过的模板消息；客户回复后就能继续直接聊天。';
  }

  private openTemplates(): void {
    this.showTemplates = true;
    if (this.tplList === null || this.tplState === 'error') {
      this.loadTemplates();
    }
  }

  private async loadTemplates(): Promise<void> {
    this.tplState = 'loading';
    this.tplError = '';
    try {
      const list = await Repo.templates(this.customerId);
      this.tplList = list;
      this.tplStatus = list.status;
      this.templates = list.templates;
      this.suggestedId = list.suggestion !== null ? list.suggestion.templateId : '';
      this.tplIndex = -1;
      const suggested = this.templates.findIndex((t: WaTemplate): boolean => t.id === this.suggestedId);
      if (suggested >= 0) {
        this.pickTemplate(suggested);
      }
      this.tplState = 'ready';
    } catch (e) {
      this.tplError = Api.message(e);
      this.tplState = 'error';
    }
  }

  /** Choose a template; its variables start with what the server filled from the customer record. */
  private pickTemplate(index: number): void {
    const t = this.templates[index];
    const list = this.tplList;
    const fills: VariableFill[] = list !== null && list.fills[t.id] !== undefined ? list.fills[t.id] : [];
    const params: string[] = [];
    const labels: string[] = [];
    for (let i = 0; i < t.variables; i++) {
      const fill: VariableFill | null = i < fills.length ? fills[i] : null;
      params.push(fill !== null ? fill.value : '');
      labels.push(fill !== null ? `${fill.label}${fill.note.length > 0 ? ` · ${fill.note}` : ''}` : '请填写');
    }
    this.params = params;
    this.paramLabels = labels;
    this.tplIndex = index;
    this.tplError = '';
  }

  private setParam(index: number, value: string): void {
    const next = this.params.slice();
    next[index] = value;
    this.params = next;
    this.tplError = '';
  }

  private async sendTemplate(): Promise<void> {
    if (this.tplIndex < 0 || this.tplSending) {
      return;
    }
    const t = this.templates[this.tplIndex];
    const params = this.params.map((p: string): string => p.trim());
    if (params.some((p: string): boolean => p.length === 0)) {
      this.tplError = '请把每个变量都填上';
      return;
    }
    this.tplSending = true;
    this.tplError = '';
    try {
      const result: TemplateSent = await Repo.sendTemplate(this.customerId, t.id, params, Repo.newRequestId());
      this.show(this.messages.concat([result.message]), true);
      this.showTemplates = false;
      const refused = result.error;
      this.toast(refused ? refused : '模板消息已发送，客户回复后就可以直接聊天');
      this.load(false);
    } catch (e) {
      this.tplError = Api.message(e);
    } finally {
      this.tplSending = false;
    }
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
      if (this.mode() === 'blocked') {
        Row({ space: 8 }) {
          LvIcon({ name: 'circle-alert', iconColor: $r('app.color.warning'), iconSize: 18 })
          Text(this.blockReason()).fontSize(13).fontColor($r('app.color.ink2')).lineHeight(19).layoutWeight(1)
        }
        .alignItems(VerticalAlign.Top)
        .width('100%')
        .padding(12)
        .borderRadius(12)
        .backgroundColor($r('app.color.surface2'))
      } else if (this.mode() === 'template') {
        Text(this.templateNote()).fontSize(13).fontColor($r('app.color.ink2')).lineHeight(19).width('100%')
        Button('选择模板消息，主动联系客户')
          .type(ButtonType.Normal)
          .width('100%')
          .height(46)
          .borderRadius(12)
          .fontColor($r('app.color.on_brand'))
          .backgroundColor($r('app.color.brand'))
          .onClick(() => this.openTemplates())
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
    .bindSheet($$this.showTemplates, this.templateSheet(), {
      detents: [SheetSize.LARGE],
      dragBar: true,
      title: { title: '发送模板消息', subtitle: '只能使用 Meta 审核通过的模板' }
    })
  }

  @Builder
  templateCard(t: WaTemplate, index: number) {
    Column({ space: 6 }) {
      Row({ space: 6 }) {
        Text(t.name).fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).layoutWeight(1)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (t.id === this.suggestedId) {
          Pill({ text: '推荐', tone: 'brand' })
        }
        Pill({ text: categoryLabel(t.category), tone: 'neutral' })
        Text(t.language).fontSize(12).fontColor($r('app.color.ink3'))
      }
      .width('100%')
      Text(t.body).fontSize(13).fontColor($r('app.color.ink2')).lineHeight(20).maxLines(4)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(12)
    .borderRadius(12)
    .backgroundColor($r('app.color.surface2'))
    .onClick(() => this.pickTemplate(index))
  }

  @Builder
  templateForm(t: WaTemplate) {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        Text(t.name).fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).layoutWeight(1)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Text('换一个模板').fontSize(14).fontColor($r('app.color.brand_ink'))
          .onClick(() => {
            this.tplIndex = -1;
            this.tplError = '';
          })
      }
      .width('100%')

      if (t.variables > 0) {
        ForEach(this.params, (value: string, index: number) => {
          Column({ space: 4 }) {
            Text(`{{${index + 1}}} ${index < this.paramLabels.length ? this.paramLabels[index] : ''}`)
              .fontSize(12).fontColor($r('app.color.ink3'))
            TextInput({ text: value, placeholder: '请填写' })
              .height(44)
              .fontSize(15)
              .borderRadius(10)
              .backgroundColor($r('app.color.surface2'))
              .onChange((v: string) => {
                this.setParam(index, v);
              })
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
        }, (value: string, index: number): string => `${this.tplIndex}-${index}`)
      }

      Text('客户收到的内容').fontSize(13).fontColor($r('app.color.ink2'))
      Text(renderTemplate(t.body, this.params))
        .fontSize(15).fontColor($r('app.color.ink')).lineHeight(22)
        .width('100%').padding(12).borderRadius(12).backgroundColor($r('app.color.brand_soft'))
      if (this.tplError.length > 0) {
        Text(this.tplError).fontSize(13).fontColor($r('app.color.danger'))
      }
      Text('模板消息由 Meta 按条计费；同一位客户没回复前，两次主动联系之间需要间隔一段时间，规则和电脑端一致。')
        .fontSize(12).fontColor($r('app.color.ink3')).lineHeight(18)
      Button(this.tplSending ? '正在发送' : '发送模板消息')
        .type(ButtonType.Normal)
        .width('100%')
        .height(48)
        .borderRadius(12)
        .fontColor($r('app.color.on_brand'))
        .backgroundColor($r('app.color.brand'))
        .enabled(!this.tplSending)
        .onClick(() => {
          this.sendTemplate();
        })
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  @Builder
  templateSheet() {
    Scroll() {
      Column({ space: 12 }) {
        if (this.tplState === 'loading') {
          LoadingProgress().width(36).height(36).color($r('app.color.brand_ink'))
          Text('正在读取审核通过的模板').fontSize(13).fontColor($r('app.color.ink3'))
        } else if (this.tplState === 'error') {
          Text(this.tplError).fontSize(14).fontColor($r('app.color.danger')).lineHeight(21)
          Button('重新读取')
            .type(ButtonType.Normal).height(44).borderRadius(12)
            .fontColor($r('app.color.ink')).backgroundColor($r('app.color.surface2'))
            .onClick(() => {
              this.loadTemplates();
            })
        } else if (this.tplStatus !== 'CONNECTED') {
          Text('服务器还没有配置模板消息发送（Gupshup 模板接口），请联系管理员。').fontSize(14).fontColor($r('app.color.ink2')).lineHeight(21)
        } else if (this.templates.length === 0) {
          Text('还没有审核通过的文字模板。模板需要先在 Gupshup 后台提交给 Meta 审核，通过后会自动出现在这里。')
            .fontSize(14).fontColor($r('app.color.ink2')).lineHeight(21)
        } else if (this.tplIndex < 0) {
          Text('选择一条模板（带「推荐」的是系统按客户来源挑的开场白）').fontSize(13).fontColor($r('app.color.ink2'))
          ForEach(this.templates, (t: WaTemplate, index: number) => {
            this.templateCard(t, index)
          }, (t: WaTemplate): string => t.id)
        } else {
          this.templateForm(this.templates[this.tplIndex])
        }
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .padding({ left: 16, right: 16, top: 8, bottom: 24 })
    }
    .scrollBar(BarState.Off)
    .align(Alignment.Top)
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
