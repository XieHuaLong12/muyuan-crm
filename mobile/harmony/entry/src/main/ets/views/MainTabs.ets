import { AppConfig } from '../common/Config';
import { Inbox } from '../data/Inbox';
import { Repo } from '../data/Repo';
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

  @Builder
  tabItem(index: number, title: string, icon: string, badge: number) {
    Column({ space: 3 }) {
      Stack({ alignContent: Alignment.TopEnd }) {
        Row() {
          LvIcon({ name: icon, iconColor: this.current === index ? $r('app.color.brand_ink') : $r('app.color.ink3'), size: 22 })
        }
        .width(56)
        .height(30)
        .borderRadius(15)
        .justifyContent(FlexAlign.Center)
        .backgroundColor(this.current === index ? $r('app.color.brand_soft') : Color.Transparent)

        if (badge > 0) {
          Text(badge > 99 ? '99+' : `${badge}`)
            .fontSize(11)
            .fontWeight(FontWeight.Medium)
            .fontColor(Color.White)
            .backgroundColor($r('app.color.danger'))
            .borderRadius(9)
            .height(18)
            .constraintSize({ minWidth: 18 })
            .padding({ left: 5, right: 5 })
            .textAlign(TextAlign.Center)
            .border({ width: 2, color: $r('app.color.surface') })
        }
      }
      .width(64)

      Text(title)
        .fontSize(12)
        .fontColor(this.current === index ? $r('app.color.brand_ink') : $r('app.color.ink3'))
        .fontWeight(this.current === index ? FontWeight.Medium : FontWeight.Normal)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
  }

  build() {
    Tabs({ barPosition: BarPosition.End, index: this.current }) {
      TabContent() {
        HomeTab()
      }
      .tabBar(this.tabItem(0, '工作台', 'layout-dashboard', 0))

      TabContent() {
        CustomersTab()
      }
      .tabBar(this.tabItem(1, '客户', 'users', this.badgeCustomers))

      TabContent() {
        OrdersTab()
      }
      .tabBar(this.tabItem(2, '订单', 'package', 0))

      TabContent() {
        InboxTab()
      }
      .tabBar(this.tabItem(3, '消息', 'message-circle', this.badgeInbox))

      TabContent() {
        MeTab()
      }
      .tabBar(this.tabItem(4, '我的', 'user-round', 0))
    }
    .barHeight(64)
    .scrollable(false)
    .animationDuration(0)
    .barBackgroundColor($r('app.color.surface'))
    .divider({ strokeWidth: 0.5, color: $r('app.color.line') })
    .backgroundColor($r('app.color.bg'))
    .onChange((index: number) => {
      this.current = index;
      if (index === 3) {
        Inbox.markAllSeen();
      }
    })
  }
}
