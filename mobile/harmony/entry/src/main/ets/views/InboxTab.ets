import { RouteParam, Routes, StoreKeys } from '../common/Config';
import { Fmt } from '../common/Format';
import { Api } from '../data/Http';
import { Inbox } from '../data/Inbox';
import { Repo } from '../data/Repo';
import { NotificationItem } from '../data/Models';
import { LvIcon } from '../components/LvIcon';
import { Pill, StateView, toneBg, toneInk } from '../components/Ui';

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
 * 消息 · 通知. The last 24 hours of the same feed the PC shows (new leads, assignments, first-contact deadlines,
 * task reminders, customer messages). Tapping opens the customer; the WhatsApp conversation view comes next.
 */
@Component
export struct InboxTab {
  @Consume('pathStack') pathStack: NavPathStack;
  @State items: NotificationItem[] = [];
  @State state: string = 'loading';
  @State error: string = '';
  @State refreshing: boolean = false;
  @State unreadConversations: number = 0;

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    try {
      const feed = await Repo.notifications();
      Inbox.lastFeed = feed;
      Inbox.applyBadges(feed);
      this.items = feed.items;
      this.unreadConversations = feed.counts.unreadConversations;
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
      this.pathStack.pushPathByName(Routes.CUSTOMER, new RouteParam(decodeURIComponent(message[1])));
    } else if (item.href.indexOf('assign=pending') >= 0) {
      AppStorage.setOrCreate<string>(StoreKeys.CUSTOMERS_QUEUE, 'pool');
      AppStorage.setOrCreate<number>(StoreKeys.CURRENT_TAB, 1);
    } else {
      this.getUIContext().getPromptAction().showToast({ message: '这条提醒请在电脑端打开', duration: 2000 });
    }
  }

  @Builder
  row(item: NotificationItem) {
    Row({ space: 12 }) {
      Row() {
        LvIcon({ name: iconOf(item.kind), iconColor: toneInk(toneOf(item.kind)), size: 18 })
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

  build() {
    Column() {
      Column({ space: 2 }) {
        Text('消息').fontSize(24).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
        Text(`最近 24 小时的提醒${this.unreadConversations > 0 ? ` · ${this.unreadConversations} 个会话有未读消息` : ''}`)
          .fontSize(13).fontColor($r('app.color.ink3'))
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .padding({ left: 16, right: 16, top: 16, bottom: 10 })

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
            }, (item: NotificationItem) => item.id)
          }
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
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg'))
  }
}
