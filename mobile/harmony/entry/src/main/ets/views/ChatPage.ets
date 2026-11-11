import { KeyboardAvoidMode } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { AppConfig, RouteParam, Routes, StoreKeys } from '../common/Config';
import { Fmt } from '../common/Format';
import { STAGES, label, stageTone } from '../common/Labels';
import { Api } from '../api/Http';
import { Inbox } from '../api/Inbox';
import { Repo } from '../api/Repo';
import { Media, PickedFile } from '../api/Media';
import {
  AiReply, AttachItem, ChatMessage, MediaAsset, SentMessage, TemplateList, TemplateSent, Thread, Translation, VariableFill,
  WaTemplate
} from '../api/Models';
import { AuthImage } from '../components/AuthImage';
import { LvIcon } from '../components/LvIcon';
import { MaterialSheet } from './chat/MaterialSheet';
import { PolishSheet } from './chat/PolishSheet';
import { QuickReplySheet } from './chat/QuickReplySheet';
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

/** A picture's own text, if the customer wrote one with it. */
function captionOf(m: ChatMessage): string {
  const text = m.content.trim();
  return text.length === 0 || /^\[[^\]]*\]$/.test(text) ? '' : m.content;
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

function isPicture(m: ChatMessage): boolean {
  return (m.messageType === 'IMAGE' || m.messageType === 'STICKER') && typeof m.mediaHref === 'string' && (m.mediaHref as string).length > 0;
}

const CJK = /[\u4e00-\u9fff]/;

/** A customer message worth translating: their own words, not Chinese, not just a picture or a number. */
function needsTranslation(m: ChatMessage): boolean {
  if (m.direction !== 'INBOUND' || translationOf(m).length > 0) return false;
  const text = m.content.trim();
  if (text.length < 2 || /^\[[^\]]*\]$/.test(text) || /^[\d\s+\-.,:/()]+$/.test(text)) return false;
  return !CJK.test(text);
}

/** The same message with a translation (messages are plain JSON objects; a new one makes the row redraw). */
function withTranslation(m: ChatMessage, t: Translation): ChatMessage {
  const copy: ChatMessage = {
    id: m.id, direction: m.direction, messageType: m.messageType, content: m.content, status: m.status, sentAt: m.sentAt,
    fileName: m.fileName, mimeType: m.mimeType, mediaHref: m.mediaHref, translation: t
  };
  return copy;
}

function localMessage(id: string, type: string, content: string, fileName: string | null): ChatMessage {
  const m: ChatMessage = {
    id: id, direction: 'OUTBOUND', messageType: type, content: content, status: 'PENDING', sentAt: new Date().toISOString(),
    fileName: fileName, mimeType: null, mediaHref: null, translation: null
  };
  return m;
}

const LANGUAGES: Record<string, string> = {
  'en': '英语', 'fr': '法语', 'ar': '阿拉伯语', 'es': '西班牙语', 'pt': '葡萄牙语', 'ru': '俄语', 'de': '德语', 'it': '意大利语',
  'tr': '土耳其语', 'zh': '中文'
};

function languageName(code: string): string {
  const name = LANGUAGES[code.toLowerCase().slice(0, 2)];
  return name === undefined ? code : name;
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
 *
 * Around the input box, the same help as the PC chat, one tap away: AI 回复 (a draft from the conversation),
 * 优化话术 (three better versions of what was typed), 译成外文 (Chinese → the customer's language, the Chinese kept
 * as the message's original), 快捷回复, 图片 / 文件 from the phone, 产品资料 from the library, 模板.
 * Customer messages are translated into Chinese automatically (newest ten) or one by one.
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
  // One bottom sheet, four uses: template | polish | quick | material.
  @State showSheet: boolean = false;
  @State sheetKind: string = '';
  // AI 回复 card above the input: idle | loading | ready | error.
  @State aiState: string = 'idle';
  @State aiReply: AiReply | null = null;
  @State aiError: string = '';
  /** The Chinese behind the text in the input box (after 译成外文 / AI / quick reply), sent along as `original`. */
  @State draftOriginal: string = '';
  @State translating: boolean = false;
  /** Upload / send progress for pictures and files, shown above the input. */
  @State busyNote: string = '';
  @State showPreview: boolean = false;
  @State previewHref: string = '';
  private tried: string[] = [];
  private autoOff: boolean = false;
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
        this.autoTranslate();
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
    const original = this.draftOriginal;
    this.sending = true;
    this.draft = '';
    this.draftOriginal = '';
    this.show(this.messages.concat([local]), true);
    try {
      const result: SentMessage = await Repo.sendWhatsApp(this.customerId, text, requestId, original);
      const sent = result.message;
      this.show(this.messages.map((m: ChatMessage): ChatMessage => m.id === local.id ? sent : m), false);
      if (sent.status === 'FAILED') {
        this.toast('WhatsApp 没有发出去，请稍后重试或在电脑端查看原因');
      }
    } catch (e) {
      this.show(this.messages.filter((m: ChatMessage): boolean => m.id !== local.id), false);
      this.draft = text;
      this.draftOriginal = original;
      this.toast(Api.message(e));
    } finally {
      this.sending = false;
    }
  }

  // ── 翻译客户消息 ──────────────────────────────────────────────────────────────────────────────
  /** Chinese for the newest customer messages without one (≤ 10 per request), as the PC chat does on opening. */
  private async autoTranslate(): Promise<void> {
    if (this.autoOff) {
      return;
    }
    const ids: string[] = [];
    for (let i = this.messages.length - 1; i >= 0 && ids.length < 10; i--) {
      const m = this.messages[i];
      if (needsTranslation(m) && this.tried.indexOf(m.id) < 0) {
        ids.push(m.id);
      }
    }
    if (ids.length === 0) {
      return;
    }
    this.tried = this.tried.concat(ids);
    try {
      const result = await Repo.translateBatch(this.customerId, ids);
      if (result.unavailable) {
        this.autoOff = true;
      }
      this.applyTranslations(result.translations);
    } catch (e) {
      // Turned off for this customer, or no translation service: the 翻译 link under each message still works.
      this.autoOff = true;
    }
  }

  private applyTranslations(found: Record<string, Translation>): void {
    let changed = false;
    const next: ChatMessage[] = [];
    for (let i = 0; i < this.messages.length; i++) {
      const m = this.messages[i];
      const t = found[m.id];
      if (t !== undefined) {
        changed = true;
        next.push(withTranslation(m, t));
      } else {
        next.push(m);
      }
    }
    if (changed) {
      this.show(next, false);
    }
  }

  private async translateOne(m: ChatMessage): Promise<void> {
    try {
      const t = await Repo.translate(m.id);
      const found: Record<string, Translation> = {};
      found[m.id] = t;
      this.applyTranslations(found);
    } catch (e) {
      this.toast(Api.message(e));
    }
  }

  // ── 输入框助手：AI 回复 / 优化话术 / 译成外文 / 快捷回复 ───────────────────────────────────────
  private async askAi(): Promise<void> {
    if (this.aiState === 'loading') {
      return;
    }
    const previous = this.aiReply !== null ? (this.aiReply as AiReply).reply : '';
    this.aiState = 'loading';
    this.aiError = '';
    try {
      this.aiReply = await Repo.aiReply(this.customerId, previous);
      this.aiState = 'ready';
    } catch (e) {
      this.aiError = Api.message(e);
      this.aiState = 'error';
    }
  }

  private closeAi(): void {
    this.aiState = 'idle';
    this.aiReply = null;
  }

  /** Puts a suggestion in the input box (never sends); zh is kept as the message's Chinese original. */
  private useDraft(text: string, zh: string): void {
    this.draft = text;
    this.draftOriginal = zh !== text ? zh : '';
    this.showSheet = false;
    this.closeAi();
  }

  private openSheet(kind: string): void {
    if (kind === 'polish' && this.draft.trim().length === 0) {
      this.toast('先在输入框写一句（中文也可以），再点优化话术');
      return;
    }
    this.sheetKind = kind;
    this.showSheet = true;
  }

  private async translateDraft(): Promise<void> {
    const text = this.draft.trim();
    if (text.length === 0) {
      this.toast('先在输入框写中文，再点译成外文');
      return;
    }
    if (this.translating) {
      return;
    }
    this.translating = true;
    try {
      const result = await Repo.translateOut(this.customerId, text);
      if (this.draftOriginal.length === 0) {
        this.draftOriginal = text;
      }
      this.draft = result.text;
      this.toast(`已译成${languageName(result.language)}，发送前可以再改`);
    } catch (e) {
      this.toast(Api.message(e));
    } finally {
      this.translating = false;
    }
  }

  private undoTranslate(): void {
    this.draft = this.draftOriginal;
    this.draftOriginal = '';
  }

  // ── 图片和文件 ────────────────────────────────────────────────────────────────────────────────
  private hostContext(): common.Context | null {
    const context = this.getUIContext().getHostContext();
    return context !== undefined ? context as common.Context : null;
  }

  /** Uploads one file for this customer and sends it, with a placeholder bubble while it goes. */
  private async uploadAndSend(file: PickedFile, index: number, total: number): Promise<boolean> {
    const picture = file.mimeType.startsWith('image/');
    const requestId = Repo.newRequestId();
    const local = localMessage(`local-${requestId}`, picture ? 'IMAGE' : 'DOCUMENT', picture ? '[图片]' : '[文件]', file.name);
    this.busyNote = total > 1 ? `正在发送第 ${index + 1} / ${total} 个：${file.name}` : `正在发送：${file.name}`;
    this.show(this.messages.concat([local]), true);
    try {
      const asset = await Repo.uploadMedia(this.customerId, file.name, file.mimeType, file.data);
      const result = await Repo.sendMedia(this.customerId, asset.id, requestId);
      this.show(this.messages.map((m: ChatMessage): ChatMessage => m.id === local.id ? result.message : m), false);
      return true;
    } catch (e) {
      this.show(this.messages.filter((m: ChatMessage): boolean => m.id !== local.id), false);
      this.toast(`${file.name} 没有发出去：${Api.message(e)}`);
      return false;
    }
  }

  private async sendPhotos(): Promise<void> {
    if (this.sending) return;
    let uris: string[] = [];
    try {
      uris = await Media.pickPhotos(9);
    } catch (e) {
      return;
    }
    if (uris.length === 0) return;
    this.sending = true;
    try {
      for (let i = 0; i < uris.length; i++) {
        this.busyNote = `正在处理第 ${i + 1} 张图片`;
        let file: PickedFile;
        try {
          file = await Media.photo(uris[i]);
        } catch (e) {
          this.toast('这张图片读取失败，已跳过');
          continue;
        }
        await this.uploadAndSend(file, i, uris.length);
      }
    } finally {
      this.sending = false;
      this.busyNote = '';
      this.load(false);
    }
  }

  private async sendFiles(): Promise<void> {
    const context = this.hostContext();
    if (this.sending || context === null) return;
    let uris: string[] = [];
    try {
      uris = await Media.pickFiles(context, 5);
    } catch (e) {
      return;
    }
    if (uris.length === 0) return;
    this.sending = true;
    try {
      for (let i = 0; i < uris.length; i++) {
        let file: PickedFile;
        try {
          file = Media.file(uris[i]);
        } catch (e) {
          this.toast('文件读取失败，已跳过');
          continue;
        }
        if (file.mimeType.length === 0) {
          this.toast(`「${file.name}」这种格式 WhatsApp 发不了，支持图片、PDF、Word、Excel、ZIP、音视频`);
          continue;
        }
        if (file.data.byteLength > 20 * 1024 * 1024) {
          this.toast(`「${file.name}」超过 20 MB，发不了`);
          continue;
        }
        await this.uploadAndSend(file, i, uris.length);
      }
    } finally {
      this.sending = false;
      this.busyNote = '';
      this.load(false);
    }
  }

  /** 产品资料: copied to the customer on the server, then sent one by one. */
  private async sendMaterials(items: AttachItem[]): Promise<void> {
    this.showSheet = false;
    if (this.sending || items.length === 0) return;
    this.sending = true;
    this.busyNote = `正在准备 ${items.length} 个资料`;
    try {
      const attached = await Repo.attachMaterials(this.customerId, items);
      for (let i = 0; i < attached.assets.length; i++) {
        const asset: MediaAsset = attached.assets[i];
        const picture = asset.mimeType.startsWith('image/');
        const requestId = Repo.newRequestId();
        const local = localMessage(`local-${requestId}`, picture ? 'IMAGE' : 'DOCUMENT', picture ? '[图片]' : '[文件]', asset.fileName);
        this.busyNote = `正在发送第 ${i + 1} / ${attached.assets.length} 个：${asset.fileName}`;
        this.show(this.messages.concat([local]), true);
        try {
          const result = await Repo.sendMedia(this.customerId, asset.id, requestId);
          this.show(this.messages.map((m: ChatMessage): ChatMessage => m.id === local.id ? result.message : m), false);
        } catch (e) {
          this.show(this.messages.filter((m: ChatMessage): boolean => m.id !== local.id), false);
          this.toast(`${asset.fileName} 没有发出去：${Api.message(e)}`);
        }
      }
    } catch (e) {
      this.toast(Api.message(e));
    } finally {
      this.sending = false;
      this.busyNote = '';
      this.load(false);
    }
  }

  private openPreview(href: string): void {
    this.previewHref = href;
    this.showPreview = true;
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
    this.sheetKind = 'template';
    this.showSheet = true;
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
      this.showSheet = false;
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

  private headerKey(): string {
    const t = this.thread;
    return t === null ? '' : `${t.customer.stage}|${t.window.status}|${t.customer.name}|${t.customer.country}`;
  }

  private toolTitle(key: string): string {
    if (key === 'ai') return this.aiState === 'loading' ? 'AI 写作中' : 'AI 回复';
    if (key === 'translate') return this.translating ? '翻译中' : '译成外文';
    return key;
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
      if (isPicture(m)) {
        Stack() {
          AuthImage({ src: m.mediaHref as string, maxSide: 640, boxWidth: 200, boxHeight: 200 })
        }
        .onClick(() => this.openPreview(m.mediaHref as string))
        if (captionOf(m).length > 0) {
          Text(captionOf(m)).fontSize(15).fontColor($r('app.color.ink')).lineHeight(22).copyOption(CopyOptions.LocalDevice)
        }
      } else if (isMedia(m)) {
        Row({ space: 8 }) {
          Row() {
            LvIcon({ name: mediaIcon(m.messageType), iconColor: $r('app.color.brand_ink'), iconSize: 18 })
          }
          .width(34).height(34).borderRadius(9).justifyContent(FlexAlign.Center).backgroundColor($r('app.color.surface'))
          Column({ space: 2 }) {
            Text(bodyOf(m)).fontSize(14).fontColor($r('app.color.ink')).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(m.id.startsWith('local-') ? '发送中…' : '文件请在电脑端打开').fontSize(12).fontColor($r('app.color.ink3'))
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
        }
        .width(220)
      } else {
        Text(bodyOf(m))
          .fontSize(15).fontColor($r('app.color.ink')).lineHeight(22)
          .copyOption(CopyOptions.LocalDevice)
      }
      if (translationOf(m).length > 0) {
        Text(`译：${translationOf(m)}`).fontSize(13).fontColor($r('app.color.ink2')).lineHeight(20)
          .copyOption(CopyOptions.LocalDevice)
      } else if (needsTranslation(m)) {
        Text('翻译成中文').fontSize(12).fontColor($r('app.color.brand_ink'))
          .onClick(() => {
            this.translateOne(m);
          })
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
        if (this.busyNote.length > 0) {
          Row({ space: 8 }) {
            LoadingProgress().width(18).height(18).color($r('app.color.brand_ink'))
            Text(this.busyNote).fontSize(12).fontColor($r('app.color.ink2')).layoutWeight(1)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .width('100%')
        }
        if (this.aiState !== 'idle') {
          this.aiCard()
        }
        if (this.draftOriginal.length > 0) {
          Row({ space: 8 }) {
            Text(`中文原意：${this.draftOriginal}`).fontSize(12).fontColor($r('app.color.ink3')).layoutWeight(1)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text('恢复中文').fontSize(12).fontColor($r('app.color.brand_ink'))
              .onClick(() => this.undoTranslate())
          }
          .width('100%')
        }
        this.toolBar()
        Row({ space: 8 }) {
          TextArea({ placeholder: this.windowHint().length > 0 ? this.windowHint() : '输入要发给客户的消息（可以先写中文）', text: this.draft })
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
    // The input area's white runs under the gesture bar; its content stays above it (top-aligned column).
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
    .bindSheet($$this.showSheet, this.sheetContent(), {
      detents: [SheetSize.LARGE],
      dragBar: true,
      showClose: false
    })
  }

  /** title: a fixed label, or 'ai' / 'translate' whose label follows the busy state (read here, not passed in). */
  @Builder
  tool(icon: string, title: string, action: () => void) {
    Row({ space: 4 }) {
      LvIcon({ name: icon, iconColor: $r('app.color.brand_ink'), iconSize: 15 })
      Text(this.toolTitle(title)).fontSize(13).fontColor($r('app.color.ink'))
    }
    .height(32)
    .padding({ left: 10, right: 12 })
    .borderRadius(16)
    .backgroundColor($r('app.color.surface2'))
    .onClick(() => action())
  }

  /** Everything the PC chat offers around the input box, one tap away. */
  @Builder
  toolBar() {
    Scroll() {
      Row({ space: 8 }) {
        this.tool('sparkles', 'ai', () => {
          this.askAi();
        })
        this.tool('pencil', '优化话术', () => this.openSheet('polish'))
        this.tool('languages', 'translate', () => {
          this.translateDraft();
        })
        this.tool('inbox', '快捷回复', () => this.openSheet('quick'))
        this.tool('image', '图片', () => {
          this.sendPhotos();
        })
        this.tool('file-text', '文件', () => {
          this.sendFiles();
        })
        this.tool('package', '产品资料', () => this.openSheet('material'))
        this.tool('megaphone', '模板', () => this.openTemplates())
      }
    }
    .scrollable(ScrollDirection.Horizontal)
    .scrollBar(BarState.Off)
    .width('100%')
  }

  @Builder
  aiCard() {
    Column({ space: 8 }) {
      Row({ space: 6 }) {
        LvIcon({ name: 'sparkles', iconColor: $r('app.color.brand_ink'), iconSize: 16 })
        Text('AI 建议回复').fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.brand_ink'))
        Blank()
        Row() {
          LvIcon({ name: 'x', iconColor: $r('app.color.ink3'), iconSize: 18 })
        }
        .width(32).height(28).justifyContent(FlexAlign.Center)
        .onClick(() => this.closeAi())
      }
      .width('100%')
      if (this.aiState === 'loading') {
        Row({ space: 8 }) {
          LoadingProgress().width(20).height(20).color($r('app.color.brand_ink'))
          Text('AI 正在读聊天记录写回复，约 10–30 秒').fontSize(13).fontColor($r('app.color.ink2'))
        }
        .width('100%')
      } else if (this.aiState === 'error') {
        Text(this.aiError).fontSize(13).fontColor($r('app.color.danger')).lineHeight(19)
        Text('重试').fontSize(13).fontColor($r('app.color.brand_ink')).onClick(() => {
          this.askAi();
        })
      } else if (this.aiReply !== null) {
        Scroll() {
          Column({ space: 6 }) {
            Text((this.aiReply as AiReply).reply).fontSize(15).fontColor($r('app.color.ink')).lineHeight(22)
              .copyOption(CopyOptions.LocalDevice)
            if ((this.aiReply as AiReply).replyZh.length > 0) {
              Text(`中文：${(this.aiReply as AiReply).replyZh}`).fontSize(13).fontColor($r('app.color.ink2')).lineHeight(20)
            }
            if ((this.aiReply as AiReply).nextStep.length > 0) {
              Text(`下一步：${(this.aiReply as AiReply).nextStep}`).fontSize(12).fontColor($r('app.color.ink3'))
            }
            ForEach((this.aiReply as AiReply).warnings, (w: string) => {
              Text(`注意：${w}`).fontSize(12).fontColor($r('app.color.danger'))
            }, (w: string): string => w)
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
        }
        .constraintSize({ maxHeight: 200 })
        .scrollBar(BarState.Off)
        .align(Alignment.Top)
        Row({ space: 8 }) {
          Button('换一条')
            .type(ButtonType.Normal).height(36).borderRadius(10).layoutWeight(1).fontSize(14)
            .fontColor($r('app.color.brand_ink')).backgroundColor($r('app.color.surface'))
            .onClick(() => {
              this.askAi();
            })
          Button('用这条，放进输入框')
            .type(ButtonType.Normal).height(36).borderRadius(10).layoutWeight(2).fontSize(14)
            .fontColor($r('app.color.on_brand')).backgroundColor($r('app.color.brand'))
            .onClick(() => {
              const reply = this.aiReply;
              if (reply !== null) {
                this.useDraft(reply.reply, reply.replyZh);
              }
            })
        }
        .width('100%')
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(12)
    .borderRadius(14)
    .backgroundColor($r('app.color.brand_tint'))
  }

  @Builder
  sheetContent() {
    Column() {
      if (this.sheetKind === 'polish') {
        PolishSheet({
          customerId: this.customerId,
          text: this.draft,
          onUse: (text: string, zh: string) => {
            this.useDraft(text, zh);
          },
          onClose: () => {
            this.showSheet = false;
          }
        })
      } else if (this.sheetKind === 'quick') {
        QuickReplySheet({
          customerId: this.customerId,
          onUse: (text: string, zh: string) => {
            this.useDraft(text, zh);
          },
          onClose: () => {
            this.showSheet = false;
          }
        })
      } else if (this.sheetKind === 'material') {
        MaterialSheet({
          customerId: this.customerId,
          onSend: (items: AttachItem[]) => {
            this.sendMaterials(items);
          },
          onClose: () => {
            this.showSheet = false;
          }
        })
      } else {
        Row() {
          Column({ space: 2 }) {
            Text('发送模板消息').fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
            Text('只能使用 Meta 审核通过的模板').fontSize(12).fontColor($r('app.color.ink3'))
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Row() {
            LvIcon({ name: 'x', iconColor: $r('app.color.ink2'), iconSize: 22 })
          }
          .width(40).height(40).justifyContent(FlexAlign.Center)
          .onClick(() => {
            this.showSheet = false;
          })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 4, bottom: 4 })
        this.templateSheet()
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  previewView() {
    Stack({ alignContent: Alignment.TopEnd }) {
      if (this.previewHref.length > 0) {
        AuthImage({ src: this.previewHref, maxSide: 2048, fullScreen: true })
      }
      Row() {
        LvIcon({ name: 'x', iconColor: Color.White, iconSize: 26 })
      }
      .width(48)
      .height(48)
      .borderRadius(24)
      .justifyContent(FlexAlign.Center)
      .backgroundColor('#66000000')
      .margin({ top: 48, right: 16 })
      .onClick(() => {
        this.showPreview = false;
      })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Color.Black)
    .onClick(() => {
      this.showPreview = false;
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
    .layoutWeight(1)
  }

  build() {
    NavDestination() {
      Column() {
        if (this.thread !== null) {
          // Rebuilt when the window or stage changes (a polled thread replaces the object).
          ForEach([this.headerKey()], (k: string) => {
            this.header(this.thread as Thread)
          }, (k: string): string => k)
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
      .bindContentCover($$this.showPreview, this.previewView())
    }
    .title(this.thread !== null ? (this.thread as Thread).customer.name : 'WhatsApp')
    .backgroundColor($r('app.color.bg'))
  }
}
