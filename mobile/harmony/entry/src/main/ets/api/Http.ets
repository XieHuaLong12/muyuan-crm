import { http } from '@kit.NetworkKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { AppConfig } from '../common/Config';
import { Session } from './Session';

/**
 * One way to call BOS. Every endpoint answers `{ success: true, data }` or `{ success: false, error }` (lib/http.ts);
 * `error` is already a Chinese, user-readable message, so it is shown as-is.
 * A 401 means the session ended (logout elsewhere, password changed, account disabled): back to the login page.
 */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface Envelope {
  success: boolean;
  data?: Object;
  error?: string;
}

const SESSION_COOKIE = 'crm_session';

/** The session cookie the server sets on login (and refreshes on password change). */
function sessionFrom(res: http.HttpResponse): string {
  const values: string[] = [];
  const header = res.header as Record<string, Object>;
  const raw: Object | undefined = header['set-cookie'] !== undefined ? header['set-cookie'] : header['Set-Cookie'];
  if (Array.isArray(raw)) {
    (raw as Array<string>).forEach((v: string): void => {
      values.push(v);
    });
  } else if (typeof raw === 'string') {
    values.push(raw as string);
  }
  if (typeof res.cookies === 'string') {
    values.push(res.cookies);
  }
  for (const v of values) {
    const m = v.match(/crm_session[=\t]([^;\s]+)/);
    if (m !== null && m.length > 1) {
      return m[1];
    }
  }
  return '';
}

export class Api {
  static async request<T>(method: http.RequestMethod, path: string, body?: Object, query?: Record<string, string>): Promise<T> {
    let url = Session.baseUrl() + path;
    if (query !== undefined) {
      const parts: string[] = [];
      Object.keys(query).forEach((key: string) => {
        const value = query[key];
        if (value !== undefined && value !== '') {
          parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
        }
      });
      if (parts.length > 0) {
        url += `?${parts.join('&')}`;
      }
    }
    const header: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Client': AppConfig.CLIENT
    };
    const token = Session.cookieValue();
    if (token.length > 0) {
      header['Cookie'] = `${SESSION_COOKIE}=${token}`;
    }
    const client = http.createHttp();
    let res: http.HttpResponse;
    try {
      res = await client.request(url, {
        method: method,
        header: header,
        extraData: body === undefined ? undefined : JSON.stringify(body),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 15000,
        readTimeout: 20000
      });
    } catch (e) {
      hilog.warn(0x0000, 'LVANJUBOS', 'request failed %{public}s %{public}s', path, JSON.stringify(e));
      throw new ApiError(0, '网络连接失败，请检查网络后重试');
    } finally {
      client.destroy();
    }

    const fresh = sessionFrom(res);
    if (fresh.length > 0) {
      await Session.saveToken(fresh);
    }
    let envelope: Envelope | null = null;
    try {
      envelope = JSON.parse(res.result as string) as Envelope;
    } catch (e) {
      envelope = null;
    }
    if (res.responseCode === 401) {
      await Session.clear();
      throw new ApiError(401, envelope !== null && envelope.error ? envelope.error : '登录已过期，请重新登录');
    }
    if (envelope === null) {
      throw new ApiError(res.responseCode, `服务器暂时无法访问（${res.responseCode}），请稍后重试`);
    }
    if (!envelope.success) {
      throw new ApiError(res.responseCode, envelope.error ? envelope.error : '操作失败，请稍后重试');
    }
    return envelope.data as T;
  }

  static get<T>(path: string, query?: Record<string, string>): Promise<T> {
    return Api.request<T>(http.RequestMethod.GET, path, undefined, query);
  }

  static post<T>(path: string, body: Object): Promise<T> {
    return Api.request<T>(http.RequestMethod.POST, path, body);
  }

  static message(e: Object): string {
    if (e instanceof ApiError) return (e as ApiError).message;
    if (e instanceof Error) return (e as Error).message;
    return '操作失败，请稍后重试';
  }
}
