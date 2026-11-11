import { RouteParam, Routes, StoreKeys } from '../common/Config';
import { Fmt } from '../common/Format';
import { Api } from '../api/Http';
import { Inbox } from '../api/Inbox';
import { Repo } from '../api/Repo';
import { Session } from '../api/Session';
import { Conversation, ConversationPage, NotificationFeed, NotificationItem } from '../api/Models';
import { LvIcon } from '../components/LvIcon';
import { ListSource } from '../components/ListSource';
import { Avatar, Pill, StateView, toneBg, toneInk } from '../components/Ui';

class FilterDef {
  key: string;
  title: string;

  constructor(key: string, title: string) {
    this.key = key;
    this.title = title;
  }
}

/** The PC 消息中心 chips (services/inbox-service.ts inboxQuery.filter). */
const FILTERS: FilterDef[] = [new FilterDef('all', '全部'), new FilterDef('unread', '未读'), new FilterDef('awaiting', '等我回复')];

function previewOf(c: Conversation): string {
  const last = c.lastMessage;
  if (last === null) return '还没有消息';
  return last.direction === 'OUTBOUND' ? `我：${last.preview}` : last.preview;
}

/** Notification kind → icon, tone and category (services/notification-service.ts NotificationItem.kind). */
function iconOf(kind: string): string {
  if (kind === 'POOL_LEAD' || kind === 'NEW_LEAD' || kind === 'ASSIGNED' || kind === 'REPEAT_SUBMISSION') return 'user-round-plus';
  if (kind === 'NEW_MESSAGE') return 'message-circle';
  if (kind === 'LEAD_NEEDS_HUMAN') return 'triangle-alert';
  return 'alarm-clock';
}

function toneOf(kind: string): string {
  if (kind === 'POOL_LEAD' || kind === 'NEW_LEAD' || kind === 'ASSIGNED' || kind === 'REPEAT_SUBMISSION') return 'brand';
  if (kind === 'NEW_MESSAGE') return 'info';
  if (kind === 'LEAD_NEEDS_HUMAN' || kind === 'FIRST_CONTACT_OVERDUE' || kind === 'TASK_OVERDUE') return 'danger';
  return 'warning';
}

function categoryOf(kind: string): string {
  if (kind === 'POOL_LEAD' || kind === 'NEW_LEAD' || kind === 'ASSIGNED' || kind === 'REPEAT_SUBMISSION') return '询盘';
  if (kind === 'NEW_MESSAGE') return '会话';
  if (kind === 'LEAD_NEEDS_HUMAN') return '异常';
  return '跟进';
}

/**
 * 消息: WhatsApp 对话 (the PC 消息中心, GET /api/inbox/conversations) and 提醒 (the last 24 hours of the PC
 * notification feed: new leads, assignments, first-contact deadlines, task reminders).
 */
@Component
export struct InboxTab {
  @Consume('pathStack') pathStack: NavPathStack;
  @State segment: number = 0;
  // 对话
  @State filter: string = 'all';
  @State keyword: string = '';
  @State chatState: string = 'loading';
  @State chatError: string = '';
  @State chatCount: number = 0;
  @State hasMore: boolean = false;
  @State page: number = 1;
  @State loadingMore: boolean = false;
  @State chatRefreshing: boolean = false;
  private chats: ListSource<Conversation> = new ListSource<Conversation>();
  private searchTimer: number = -1;
  // 提醒
  @State items: NotificationItem[] = [];
  @State state: string = 'loading';
  @State error: string = '';
  @State refreshing: boolean = false;
  @State unreadConversations: number = 0;
  @StorageProp('chatClosed') @Watch('onChatClosed') chatClosed: number = 0;

  /** Back from a conversation: unread counts and the last message changed. */
  onChatClosed(): void {
    this.loadChats(true);
  }

  aboutToAppear(): void {
    const feed = Repo.peekNotifications();
    if (feed !== null) {
      this.applyFeed(feed);
      this.state = 'ready';
    }
    this.showCachedChats();
    this.loadChats(true);
    this.load();
  }

  private toast(message: string): void {
    this.getUIContext().getPromptAction().showToast({ message: message, duration: 2000 });
  }

  private applyFeed(feed: NotificationFeed): void {
    this.items = feed.items;
    this.unreadConversations = feed.counts.unreadConversations;
  }

  private showCachedChats(): void {
    if (this.keyword.length > 0) {
      return;
    }
    const cached = Repo.peekConversations(this.filter);
    if (cached !== null) {
      this.applyChats(cached, true);
      this.chatState = 'ready';
    }
  }

  private applyChats(result: ConversationPage, reset: boolean): void {
    if (reset) {
      this.chats.reset(result.conversations);
    } else {
      this.chats.append(result.conversations);
    }
    this.chatCount = this.chats.totalCount();
    this.hasMore = result.hasMore;
  }

  private async loadChats(reset: boolean): Promise<void> {
    const page = reset ? 1 : this.page + 1;
    const filter = this.filter;
    try {
      const result = await Repo.conversations(filter, this.keyword, page);
      if (filter !== this.filter) {
        return;
      }
      this.applyChats(result, reset);
      this.page = page;
      this.chatState = 'ready';
    } catch (e) {
      this.chatError = Api.message(e);
      if (this.chatState !== 'ready') {
        this.chatState = 'error';
      } else if (reset) {
        this.toast(`没有连上服务器，显示的是上次的数据。${this.chatError}`);
      }
    } finally {
      this.chatRefreshing = false;
      this.loadingMore = false;
    }
  }

  private selectFilter(key: string): void {
    if (key === this.filter) return;
    this.filter = key;
    this.chatState = 'loading';
    this.showCachedChats();
    this.loadChats(true);
  }

  private onSearch(value: string): void {
    this.keyword = value.trim();
    if (this.searchTimer !== -1) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this.chatState = 'loading';
      this.loadChats(true);
    }, 400);
  }

  private async load(): Promise<void> {
    try {
      const feed = await Repo.notifications();
      Inbox.lastFeed = feed;
      Inbox.applyBadges(feed);
      this.applyFeed(feed);
      this.state = 'ready';
    } catch (e) {
      this.error = Api.message(e);
      if (this.state !== 'ready') {
        this.state = 'error';
      }
    } finally {
      this.refreshing = false;
    }
  }

  private open(item: NotificationItem): void {
    const customer = item.href.match(/^\/customers\/([^/?#]+)/);
    const message = item.href.match(/[?&]customer=([^&#]+)/);
    if (customer !== null && customer.length > 1) {
      this.pathStack.pushPathByName(Routes.CUSTOMER, new RouteParam(decodeURIComponent(customer[1])));
    } else if (message !== null && message.length > 1) {
      this.pathStack.pushPathByName(Routes.CHAT, new RouteParam(decodeURIComponent(message[1])));
    } else if (item.href.indexOf('assign=pending') >= 0) {
      AppStorage.setOrCreate<string>(StoreKeys.CUSTOMERS_QUEUE, 'pool');
      AppStorage.setOrCreate<number>(StoreKeys.CURRENT_TAB, 1);
    } else {
      this.getUIContext().getPromptAction().showToast({ message: '这条提醒请在电脑端打开', duration: 2000 });
    }
  }

  @Builder
  chatRow(c: Conversation) {
    Row({ space: 12 }) {
      Stack({ alignContent: Alignment.TopEnd }) {
        Avatar({ name: c.name, grade: c.grade })
        if (c.unread > 0) {
          Text(c.unread > 99 ? '99+' : `${c.unread}`)
            .fontSize(11).fontWeight(FontWeight.Medium).fontColor(Color.White)
            .backgroundColor($r('app.color.danger')).borderRadius(9).height(18)
            .constraintSize({ minWidth: 18 }).padding({ left: 5, right: 5 }).textAlign(TextAlign.Center)
            .offset({ x: 6, y: -4 })
        }
      }
      Column({ space: 4 }) {
        Row({ space: 8 }) {
          Text(c.name).fontSize(16).fontWeight(c.unread > 0 ? FontWeight.Bold : FontWeight.Medium).fontColor($r('app.color.ink'))
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
          Text(Fmt.ago(c.lastMessageAt)).fontSize(12).fontColor($r('app.color.ink3'))
        }
        .width('100%')
        Text(previewOf(c)).fontSize(14).fontColor(c.unread > 0 ? $r('app.color.ink') : $r('app.color.ink2'))
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Row({ space: 6 }) {
          if (c.awaiting) {
            Pill({ text: '等我回复', tone: 'warning' })
          }
          if (c.firstContactOverdue) {
            Pill({ text: '首联超时', tone: 'danger' })
          }
          if (c.window.status !== 'OPEN') {
            Pill({ text: '需模板', tone: 'neutral' })
          }
          if (Session.isAdmin() && c.owner !== null) {
            Text(c.owner.name).fontSize(12).fontColor($r('app.color.ink3'))
          }
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .alignItems(VerticalAlign.Top)
    .width('100%')
    .padding(14)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(16)
    .onClick(() => {
      this.pathStack.pushPathByName(Routes.CHAT, new RouteParam(c.id));
    })
  }

  @Builder
  segmentBar() {
    Row({ space: 2 }) {
      ForEach(['WhatsApp 对话', '提醒'], (title: string, index: number) => {
        Row({ space: 6 }) {
          Text(title)
            .fontSize(14)
            .fontWeight(this.segment === index ? FontWeight.Medium : FontWeight.Normal)
            .fontColor(this.segment === index ? $r('app.color.ink') : $r('app.color.ink2'))
          if (index === 0 && this.unreadConversations > 0) {
            Text(`${this.unreadConversations}`).fontSize(11).fontColor(Color.White).backgroundColor($r('app.color.danger'))
              .borderRadius(8).height(16).constraintSize({ minWidth: 16 }).padding({ left: 4, right: 4 }).textAlign(TextAlign.Center)
          }
        }
        .justifyContent(FlexAlign.Center)
        .height(38)
        .layoutWeight(1)
        .borderRadius(9)
        .backgroundColor(this.segment === index ? $r('app.color.surface') : Color.Transparent)
        .onClick(() => {
          this.segment = index;
          if (index === 1) {
            Inbox.markAllSeen();
          }
        })
      }, (title: string): string => title)
    }
    .width('100%')
    .padding(3)
    .borderRadius(12)
    .backgroundColor($r('app.color.surface2'))
  }

  @Builder
  chatList() {
    Column({ space: 10 }) {
      Search({ value: this.keyword, placeholder: '客户名、公司、号码' })
        .height(44)
        .backgroundColor($r('app.color.surface2'))
        .onChange((value: string): void => this.onSearch(value))
      Row({ space: 8 }) {
        ForEach(FILTERS, (f: FilterDef) => {
          Text(f.title)
            .fontSize(14)
            .fontColor(this.filter === f.key ? $r('app.color.on_brand') : $r('app.color.ink2'))
            .height(34)
            .padding({ left: 14, right: 14 })
            .borderRadius(17)
            .backgroundColor(this.filter === f.key ? $r('app.color.brand') : $r('app.color.surface'))
            .onClick(() => this.selectFilter(f.key))
        }, (f: FilterDef): string => f.key)
      }
      .width('100%')
    }
    .padding({ left: 16, right: 16, bottom: 10 })

    if (this.chatState === 'loading') {
      StateView({ kind: 'loading' }).layoutWeight(1)
    } else if (this.chatState === 'error') {
      StateView({ kind: 'error', message: this.chatError, actionText: '重新加载', onAction: () => {
        this.chatState = 'loading';
        this.loadChats(true);
      } }).layoutWeight(1)
    } else {
      Refresh({ refreshing: $$this.chatRefreshing }) {
        List({ space: 10 }) {
          if (this.chatCount === 0) {
            ListItem() {
              StateView({
                kind: 'empty', icon: 'message-circle',
                title: this.keyword.length > 0 ? `没有找到「${this.keyword}」` : this.filter === 'all' ? '还没有 WhatsApp 对话' : '这里没有对话',
                message: '客户通过 WhatsApp 发来的消息会出现在这里。'
              })
            }
          }
          LazyForEach(this.chats, (c: Conversation) => {
            ListItem() {
              this.chatRow(c)
            }
          }, (c: Conversation): string => `${this.chats.generation}-${c.id}`)
          if (this.hasMore) {
            ListItem() {
              Button(this.loadingMore ? '加载中' : '加载更多')
                .type(ButtonType.Normal).borderRadius(12).height(44).width('100%')
                .fontColor($r('app.color.brand_ink')).backgroundColor($r('app.color.surface'))
                .enabled(!this.loadingMore)
                .onClick(() => {
                  this.loadingMore = true;
                  this.loadChats(false);
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
        this.loadChats(true);
        this.load();
      })
      .layoutWeight(1)
    }
  }

  @Builder
  row(item: NotificationItem) {
    Row({ space: 12 }) {
      Row() {
        LvIcon({ name: iconOf(item.kind), iconColor: toneInk(toneOf(item.kind)), iconSize: 18 })
      }
      .width(36).height(36).borderRadius(11).justifyContent(FlexAlign.Center).backgroundColor(toneBg(toneOf(item.kind)))

      Column({ space: 3 }) {
        Row({ space: 8 }) {
          Text(item.title)
            .fontSize(14)
            .fontWeight(Inbox.isUnread(item.at) ? FontWeight.Bold : FontWeight.Normal)
            .fontColor(Inbox.isUnread(item.at) ? $r('app.color.ink') : $r('app.color.ink2'))
            .layoutWeight(1)
          Text(Fmt.ago(item.at)).fontSize(12).fontColor($r('app.color.ink3'))
        }
        .width('100%')
        Text(item.body).fontSize(13).fontColor($r('app.color.ink2')).lineHeight(19).maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Row({ space: 6 }) {
          if (item.urgent) {
            Pill({ text: '紧急', tone: 'danger' })
          }
          Pill({ text: categoryOf(item.kind), tone: 'neutral' })
        }
        .margin({ top: 3 })
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .alignItems(VerticalAlign.Top)
    .width('100%')
    .padding(14)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(16)
    .onClick(() => this.open(item))
  }

  @Builder
  reminderList() {
    if (this.state === 'loading') {
      StateView({ kind: 'loading' }).layoutWeight(1)
    } else if (this.state === 'error') {
      StateView({ kind: 'error', message: this.error, actionText: '重新加载', onAction: () => {
        this.state = 'loading';
        this.load();
      } }).layoutWeight(1)
    } else {
      Refresh({ refreshing: $$this.refreshing }) {
        List({ space: 10 }) {
          if (this.items.length === 0) {
            ListItem() {
              StateView({ kind: 'empty', icon: 'bell', title: '最近 24 小时没有新提醒', message: '新询盘、分配、首联截止和任务提醒会出现在这里。' })
            }
          }
          ForEach(this.items, (item: NotificationItem) => {
            ListItem() {
              this.row(item)
            }
          }, (item: NotificationItem): string => item.id)
        }
        .cachedCount(5)
        .padding({ left: 16, right: 16, bottom: 24 })
        .scrollBar(BarState.Off)
        .height('100%')
      }
      .onRefreshing(() => {
        this.load();
      })
      .layoutWeight(1)
    }
  }

  build() {
    Column() {
      Column({ space: 10 }) {
        Text('消息').fontSize(24).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
        this.segmentBar()
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .padding({ left: 16, right: 16, top: 16, bottom: 10 })

      if (this.segment === 0) {
        this.chatList()
      } else {
        this.reminderList()
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg'))
  }
}
