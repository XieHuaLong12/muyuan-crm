/**
 * App-wide constants.
 * DEFAULT_SERVER is the production BOS. During development, switch to the test site from the login page
 * (「服务器」) so test data never lands in production (PROJECT_RULES §1.2).
 */
export class AppConfig {
  static readonly DEFAULT_SERVER: string = 'https://avenlee.online';
  static readonly VERSION: string = '1.0.0';
  static readonly CLIENT: string = 'LVANJUBOS-HarmonyOS/1.0.0';
  /** How often the notification feed is refreshed while the app is in front (the PC polls about every 20 s). */
  static readonly FEED_INTERVAL_MS: number = 60000;
}

/** Navigation destinations pushed on the root NavPathStack (pages/Index.ets). */
export class Routes {
  static readonly CUSTOMER: string = 'customer';
  static readonly ORDER: string = 'order';
}

/** Parameter object for a pushed destination. */
export class RouteParam {
  id: string;

  constructor(id: string) {
    this.id = id;
  }
}

/** AppStorage keys shared between tabs. */
export class StoreKeys {
  static readonly LOGGED_IN: string = 'loggedIn';
  static readonly USER_NAME: string = 'userName';
  static readonly USER_ROLE: string = 'userRole';
  static readonly USER_EMAIL: string = 'userEmail';
  static readonly BADGE_CUSTOMERS: string = 'badgeCustomers';
  static readonly BADGE_INBOX: string = 'badgeInbox';
  /** Queue the customers tab should show next (set by the home tab before switching tabs). */
  static readonly CUSTOMERS_QUEUE: string = 'customersQueue';
  static readonly CURRENT_TAB: string = 'currentTab';
}
