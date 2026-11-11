import { http } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
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
  path: string;

  constructor(status: number, message: string, path: string = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
  }
}

/** Network-stack failures (error code = 2300000 + the libcurl code), in words a salesperson can act on. */
function networkMessage(code: number): string {
  switch (code) {
    case 2300006:
      return '找不到服务器地址，请检查服务器设置或手机网络';
    case 2300007:
      return '连不上服务器，请检查手机网络';
    case 2300028:
      return '服务器响应超时，请下拉刷新重试';
    case 2300035:
    case 2300058:
    case 2300060:
    case 2300077:
      return '服务器 HTTPS 证书校验失败，请联系管理员';
    default:
      return '网络连接失败，请检查网络后重试';
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
        usingCache: false,
        connectTimeout: 15000,
        readTimeout: 30000
      });
    } catch (err) {
      const e = err as BusinessError;
      hilog.warn(0x0000, 'LVANJUBOS', 'request failed %{public}s %{public}d %{public}s', path, e.code, e.message);
      throw new ApiError(0, `${networkMessage(e.code)}（错误码 ${e.code}）`, path);
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
      throw new ApiError(401, envelope !== null && envelope.error ? envelope.error : '登录已过期，请重新登录', path);
    }
    if (envelope === null || typeof envelope.success !== 'boolean') {
      const text = typeof res.result === 'string' ? (res.result as string).slice(0, 200) : '';
      hilog.warn(0x0000, 'LVANJUBOS', 'unexpected response %{public}s %{public}d %{public}s', path, res.responseCode, text);
      throw new ApiError(res.responseCode, `服务器返回了无法识别的内容（HTTP ${res.responseCode}）`, path);
    }
    if (!envelope.success) {
      const reason = envelope.error ? envelope.error : '操作失败，请稍后重试';
      hilog.warn(0x0000, 'LVANJUBOS', 'request refused %{public}s %{public}d %{public}s', path, res.responseCode, reason);
      // Business refusals (400/403/409/429) already read well; server faults get the code for whoever investigates.
      const shown = res.responseCode >= 500 || res.responseCode === 404 ? `${reason}（HTTP ${res.responseCode}）` : reason;
      throw new ApiError(res.responseCode, shown, path);
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
    if (e instanceof Error) return `程序出错：${(e as Error).message}`;
    return '操作失败，请稍后重试';
  }
}
