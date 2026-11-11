import { fileIo as fs } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

/**
 * The last good answer of every GET, keyed by path + query, so a screen shows at once and refreshes underneath
 * (stale-while-revalidate). Memory first; a copy in the app's cache directory survives restarts and lets the
 * recently opened customers, queues and orders be read without a network (NATIVE_PLAN §3.1 offline view).
 * Cleared on logout and on an expired session, so the next account never sees the previous one's data.
 */
export class Cache {
  private static dir: string = '';
  private static memory: Map<string, Object> = new Map<string, Object>();

  static init(context: common.UIAbilityContext): void {
    Cache.dir = `${context.cacheDir}/api`;
    try {
      if (!fs.accessSync(Cache.dir)) {
        fs.mkdirSync(Cache.dir);
      }
    } catch (e) {
      hilog.warn(0x0000, 'LVANJUBOS', 'cache directory unavailable');
      Cache.dir = '';
    }
  }

  /** Two independent 32-bit string hashes: a short, file-safe name for any URL. */
  private static fileOf(key: string): string {
    let a = 5381;
    let b = 52711;
    for (let i = 0; i < key.length; i++) {
      const c = key.charCodeAt(i);
      a = ((a * 33) ^ c) >>> 0;
      b = ((b * 31) + c) >>> 0;
    }
    return `${Cache.dir}/${a.toString(16)}${b.toString(16)}.json`;
  }

  static peek<T>(key: string): T | null {
    const hit = Cache.memory.get(key);
    if (hit !== undefined) {
      return hit as T;
    }
    if (Cache.dir.length === 0) {
      return null;
    }
    try {
      const path = Cache.fileOf(key);
      if (!fs.accessSync(path)) {
        return null;
      }
      const parsed = JSON.parse(fs.readTextSync(path)) as Object;
      Cache.memory.set(key, parsed);
      return parsed as T;
    } catch (e) {
      return null;
    }
  }

  static put(key: string, value: Object): void {
    Cache.memory.set(key, value);
    if (Cache.dir.length === 0) {
      return;
    }
    Cache.write(Cache.fileOf(key), JSON.stringify(value)).catch(() => {
      hilog.warn(0x0000, 'LVANJUBOS', 'cache write failed');
    });
  }

  /** Forget everything (logout, expired session). */
  static clear(): void {
    Cache.memory.clear();
    if (Cache.dir.length === 0) {
      return;
    }
    try {
      fs.rmdirSync(Cache.dir);
      fs.mkdirSync(Cache.dir);
    } catch (e) {
      hilog.warn(0x0000, 'LVANJUBOS', 'cache clear failed');
    }
  }

  private static async write(path: string, text: string): Promise<void> {
    const file = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
    try {
      await fs.write(file.fd, text);
    } finally {
      await fs.close(file);
    }
  }
}
