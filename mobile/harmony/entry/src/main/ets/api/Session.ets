import { asset } from '@kit.AssetStoreKit';
import { preferences } from '@kit.ArkData';
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { AppConfig, StoreKeys } from '../common/Config';

/**
 * The login session and the server address.
 *
 * BOS keeps the session in the HttpOnly cookie `crm_session` (7 days). The app stores the cookie value in the
 * Asset Store (encrypted, readable only after the phone was first unlocked) and sends it back as a Cookie header.
 * The server address and the signed-in user's name / role live in Preferences (not secret).
 */
const ASSET_ALIAS = 'lvanjubos.session';
const PREFS_NAME = 'lvanjubos';
const encoder = new util.TextEncoder();
const decoder = util.TextDecoder.create('utf-8');

function toBytes(value: string): Uint8Array {
  return encoder.encodeInto(value);
}

function fromBytes(value: Uint8Array): string {
  return decoder.decodeToString(value);
}

export class Session {
  private static token: string = '';
  private static server: string = AppConfig.DEFAULT_SERVER;
  private static prefs: preferences.Preferences | null = null;

  /** Called once from EntryAbility before the first page loads. */
  static async init(context: common.UIAbilityContext): Promise<void> {
    try {
      Session.prefs = await preferences.getPreferences(context, PREFS_NAME);
      Session.server = (await Session.prefs.get('server', AppConfig.DEFAULT_SERVER)) as string;
      AppStorage.setOrCreate<string>(StoreKeys.USER_NAME, (await Session.prefs.get('userName', '')) as string);
      AppStorage.setOrCreate<string>(StoreKeys.USER_ROLE, (await Session.prefs.get('userRole', '')) as string);
      AppStorage.setOrCreate<string>(StoreKeys.USER_EMAIL, (await Session.prefs.get('userEmail', '')) as string);
    } catch (e) {
      hilog.error(0x0000, 'LVANJUBOS', 'preferences unavailable: %{public}s', JSON.stringify(e));
    }
    Session.token = await Session.readToken();
    AppStorage.setOrCreate<boolean>(StoreKeys.LOGGED_IN, Session.token.length > 0);
  }

  static cookieValue(): string {
    return Session.token;
  }

  static baseUrl(): string {
    return Session.server;
  }

  static async setBaseUrl(url: string): Promise<void> {
    Session.server = url.replace(/\/+$/, '');
    if (Session.prefs) {
      await Session.prefs.put('server', Session.server);
      await Session.prefs.flush();
    }
  }

  static async saveToken(value: string): Promise<void> {
    if (value === Session.token) return;
    Session.token = value;
    await Session.removeToken();
    const attrs: asset.AssetMap = new Map();
    attrs.set(asset.Tag.SECRET, toBytes(value));
    attrs.set(asset.Tag.ALIAS, toBytes(ASSET_ALIAS));
    attrs.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
    try {
      await asset.add(attrs);
    } catch (e) {
      hilog.error(0x0000, 'LVANJUBOS', 'asset add failed: %{public}s', JSON.stringify(e));
    }
  }

  static async rememberUser(name: string, role: string, email: string): Promise<void> {
    AppStorage.setOrCreate<string>(StoreKeys.USER_NAME, name);
    AppStorage.setOrCreate<string>(StoreKeys.USER_ROLE, role);
    AppStorage.setOrCreate<string>(StoreKeys.USER_EMAIL, email);
    if (Session.prefs) {
      await Session.prefs.put('userName', name);
      await Session.prefs.put('userRole', role);
      await Session.prefs.put('userEmail', email);
      await Session.prefs.flush();
    }
  }

  static isAdmin(): boolean {
    return AppStorage.get<string>(StoreKeys.USER_ROLE) === 'ADMIN';
  }

  /** Logout or an expired session: forget everything tied to the account and go back to the login page. */
  static async clear(): Promise<void> {
    Session.token = '';
    await Session.removeToken();
    await Session.rememberUser('', '', '');
    AppStorage.setOrCreate<number>(StoreKeys.BADGE_CUSTOMERS, 0);
    AppStorage.setOrCreate<number>(StoreKeys.BADGE_INBOX, 0);
    AppStorage.setOrCreate<boolean>(StoreKeys.LOGGED_IN, false);
  }

  private static async readToken(): Promise<string> {
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, toBytes(ASSET_ALIAS));
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    try {
      const found: Array<asset.AssetMap> = await asset.query(query);
      if (found.length > 0) {
        const secret = found[0].get(asset.Tag.SECRET) as Uint8Array;
        return fromBytes(secret);
      }
    } catch (e) {
      // Not found is reported as an error; it simply means nobody is signed in.
    }
    return '';
  }

  private static async removeToken(): Promise<void> {
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, toBytes(ASSET_ALIAS));
    try {
      await asset.remove(query);
    } catch (e) {
      // Nothing stored yet.
    }
  }
}
