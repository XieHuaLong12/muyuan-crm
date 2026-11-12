import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { StoreKeys } from '../common/Config';
import { NotificationFeed, NotificationItem } from './Models';
import { Repo } from './Repo';
import { Session } from './Session';

/**
 * Tab badges and the 「已读」 point for notifications.
 * BOS does not store read state yet (planned: NotificationRead, NATIVE_PLAN §2 S4), so the app remembers on this
 * phone the time the user last opened 「消息」: items newer than that are unread.
 */
export class Inbox {
  private static seenAt: number = 0;
  private static prefs: preferences.Preferences | null = null;
  static lastFeed: NotificationFeed | null = null;

  static async init(context: common.UIAbilityContext): Promise<void> {
    try {
      Inbox.prefs = await preferences.getPreferences(context, 'lvanjubos_inbox');
      Inbox.seenAt = (await Inbox.prefs.get('seenAt', 0)) as number;
    } catch (e) {
      Inbox.seenAt = 0;
    }
  }

  static isUnread(at: string): boolean {
    return new Date(at).getTime() > Inbox.seenAt;
  }

  /** Reload the feed and update both badges. Errors are ignored here; the screens show their own. */
  static async refresh(): Promise<NotificationFeed | null> {
    try {
      await Inbox.syncSeen();
      const feed = await Repo.notifications();
      Inbox.lastFeed = feed;
      Inbox.applyBadges(feed);
      return feed;
    } catch (e) {
      return null;
    }
  }

  /** 消息 badge: unread WhatsApp conversations + unread reminders (message reminders are counted once, as chats). */
  static applyBadges(feed: NotificationFeed): void {
    const unread = feed.items.filter((item: NotificationItem): boolean => item.kind !== 'NEW_MESSAGE' && Inbox.isUnread(item.at)).length;
    AppStorage.setOrCreate<number>(StoreKeys.BADGE_INBOX, unread + feed.counts.unreadConversations);
    // Administrators: leads waiting for assignment. Sales: assigned customers not contacted yet.
    AppStorage.setOrCreate<number>(StoreKeys.BADGE_CUSTOMERS, Session.isAdmin() ? feed.counts.pool : feed.counts.pendingFirstContact);
  }

  /** The read point shared with the PC and other phones (GET /api/notifications/seen): the later one wins. */
  static async syncSeen(): Promise<void> {
    try {
      const state = await Repo.notificationsSeen();
      const server = state.seenAt !== null ? new Date(state.seenAt).getTime() : 0;
      if (server > Inbox.seenAt) {
        await Inbox.saveLocal(server);
      }
    } catch (e) {
      // Offline or an older server: the phone's own read point still works.
    }
  }

  private static async saveLocal(at: number): Promise<void> {
    Inbox.seenAt = at;
    if (Inbox.prefs) {
      await Inbox.prefs.put('seenAt', Inbox.seenAt);
      await Inbox.prefs.flush();
    }
  }

  /** Opening 「提醒」 marks the reminders up to the feed time as read, here and on the server; chats stay unread until opened. */
  static async markAllSeen(): Promise<void> {
    const feed = Inbox.lastFeed;
    const at = feed !== null ? new Date(feed.at).getTime() : Date.now();
    AppStorage.setOrCreate<number>(StoreKeys.BADGE_INBOX, feed !== null ? feed.counts.unreadConversations : 0);
    await Inbox.saveLocal(Math.max(at, Inbox.seenAt));
    Repo.markNotificationsSeen(new Date(Inbox.seenAt).toISOString()).catch(() => {});
  }
}
