import { RouteParam, Routes } from '../common/Config';
import { LoginView } from '../views/LoginView';
import { MainTabs } from '../views/MainTabs';
import { CustomerDetailPage } from '../views/CustomerDetailPage';
import { OrderDetailPage } from '../views/OrderDetailPage';
import { ChatPage } from '../views/ChatPage';
import { TasksPage } from '../views/TasksPage';
import { AnalyticsPage } from '../views/AnalyticsPage';
import { NewCustomerPage } from '../views/NewCustomerPage';

/**
 * Root: one Navigation stack. The five tabs live in its root content; detail pages are pushed on top and cover the
 * tab bar, so the tab bar is hidden on detail pages and each tab keeps its scroll position underneath
 * (docs/mobile-app/INFORMATION_ARCHITECTURE.md §1). System back (edge swipe) pops the stack.
 */
@Entry
@Component
struct Index {
  @Provide('pathStack') pathStack: NavPathStack = new NavPathStack();
  @StorageLink('loggedIn') @Watch('onAuthChange') loggedIn: boolean = false;

  onAuthChange(): void {
    if (!this.loggedIn) {
      this.pathStack.clear();
    }
  }

  @Builder
  pages(name: string, param: Object) {
    if (name === Routes.CUSTOMER) {
      CustomerDetailPage({ customerId: (param as RouteParam).id })
    } else if (name === Routes.ORDER) {
      OrderDetailPage({ orderId: (param as RouteParam).id })
    } else if (name === Routes.CHAT) {
      ChatPage({ customerId: (param as RouteParam).id })
    } else if (name === Routes.TASKS) {
      TasksPage()
    } else if (name === Routes.ANALYTICS) {
      AnalyticsPage()
    } else if (name === Routes.NEW_CUSTOMER) {
      NewCustomerPage()
    }
  }

  build() {
    Navigation(this.pathStack) {
      if (this.loggedIn) {
        MainTabs()
      } else {
        LoginView()
      }
    }
    .navDestination(this.pages)
    .mode(NavigationMode.Stack)
    .hideTitleBar(true)
    .hideToolBar(true)
    .backgroundColor($r('app.color.bg'))
  }
}
