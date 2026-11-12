import { AppConfig } from '../common/Config';
import { Inbox } from '../api/Inbox';
import { Repo } from '../api/Repo';
import { LvIcon } from '../components/LvIcon';
import { HomeTab } from './HomeTab';
import { CustomersTab } from './CustomersTab';
import { OrdersTab } from './OrdersTab';
import { InboxTab } from './InboxTab';
import { MeTab } from './MeTab';

/** Bottom navigation: 工作台 | 客户 | 订单 | 消息 | 我的 (docs/mobile-app/INFORMATION_ARCHITECTURE.md §1). */
@Component
export struct MainTabs {
  @StorageLink('currentTab') current: number = 0;
  @StorageProp('badgeCustomers') badgeCustomers: number = 0;
  @StorageProp('badgeInbox') badgeInbox: number = 0;
  private timer: number = -1;

  aboutToAppear(): void {
    // Who is signed in (also confirms the saved session is still valid), then the badges.
    Repo.me().catch(() => {});
    Inbox.refresh();
    this.timer = setInterval(() => {
      Inbox.refresh();
    }, AppConfig.FEED_INTERVAL_MS);
  }

  aboutToDisappear(): void {
    if (this.timer !== -1) {
      clearInterval(this.timer);
    }
  }

  /**
   * One tab: the icon pill and the label share one centre line. The unread count is a system Badge on the pill's
   * top-right corner, so it never pushes the icon off centre.
   */
  /** Read inside the tab (not passed in) so the unread counts follow every refresh. */
  private badgeOf(index: number): number {
    if (index === 1) return this.badgeCustomers;
    if (index === 3) return this.badgeInbox;
    return 0;
  }

  @Builder
  tabItem(index: number, title: string, icon: string) {
    Column({ space: 4 }) {
      Badge({
        count: this.badgeOf(index),
        maxCount: 99,
        position: BadgePosition.RightTop,
        style: { badgeSize: 16, badgeColor: $r('app.color.danger'), fontSize: 10, color: Color.White }
      }) {
        Row() {
          LvIcon({ name: icon, iconColor: this.current === index ? $r('app.color.brand_ink') : $r('app.color.ink3'), iconSize: 22 })
        }
        .width(56)
        .height(30)
        .borderRadius(15)
        .justifyContent(FlexAlign.Center)
        .backgroundColor(this.current === index ? $r('app.color.brand_soft') : Color.Transparent)
      }

      Text(title)
        .fontSize(12)
        .fontColor(this.current === index ? $r('app.color.brand_ink') : $r('app.color.ink3'))
        .fontWeight(this.current === index ? FontWeight.Medium : FontWeight.Normal)
        .textAlign(TextAlign.Center)
        .width('100%')
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Center)
    .justifyContent(FlexAlign.Center)
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      // White under the tab bar, reaching down into the gesture-bar area, so the bar runs to the screen edge.
      Column()
        .width('100%')
        .height(64)
        .backgroundColor($r('app.color.surface'))
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])

      Tabs({ barPosition: BarPosition.End, index: this.current }) {
        TabContent() {
          HomeTab()
        }
        .tabBar(this.tabItem(0, '工作台', 'layout-dashboard'))

        TabContent() {
          CustomersTab()
        }
        .tabBar(this.tabItem(1, '客户', 'users'))

        TabContent() {
          OrdersTab()
        }
        .tabBar(this.tabItem(2, '订单', 'package'))

        TabContent() {
          InboxTab()
        }
        .tabBar(this.tabItem(3, '消息', 'message-circle'))

        TabContent() {
          MeTab()
        }
        .tabBar(this.tabItem(4, '我的', 'user-round'))
      }
      .barHeight(64)
      .scrollable(false)
      .animationDuration(0)
      .barBackgroundColor($r('app.color.surface'))
      .divider({ strokeWidth: 0.5, color: $r('app.color.line') })
      .backgroundColor($r('app.color.bg'))
      .onChange((index: number) => {
        this.current = index;
      })
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg'))
  }
}
