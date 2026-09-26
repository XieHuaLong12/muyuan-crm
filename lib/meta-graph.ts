/**
 * Meta Graph API 通用工具（Marketing API 与 Page API 共用）
 *
 * - graphVersion：版本走环境变量，不硬编码（Meta 约两年废弃一次版本号）
 * - graphGet / pagedGraphGet：统一错误包装，调用方把错误落库而不是抛异常
 *
 * 与 meta-lead-service 里的实现独立：那边服务于 Lead Ads webhook 链路，
 * 保持不动；本模块服务于「广告数据 / 表单目录」同步链路。
 */

export function graphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || 'v26.0';
}

type GraphError = { ok: false; error: string };
type GraphOk<T> = { ok: true; data: T };

/** Graph API GET，统一错误包装：调用方把错误落库而不是抛异常。 */
export async function graphGet<T>(path: string, token: string, params: Record<string, string>): Promise<GraphOk<T> | GraphError> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
  url.searchParams.set('access_token', token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, { cache: 'no-store' });
    const text = await response.text();
    if (!response.ok) return { ok: false, error: `Graph API ${response.status}: ${text.slice(0, 300)}` };
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return { ok: false, error: `Graph API 返回非 JSON: ${text.slice(0, 200)}` }; }
    return { ok: true, data: parsed as T };
  } catch (error) {
    return { ok: false, error: `Graph API 请求失败: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 遍历分页（paging.next），最多 10 页，防止无限循环。 */
export async function pagedGraphGet<T>(path: string, token: string, params: Record<string, string>): Promise<{ rows: T[]; error?: string }> {
  const rows: T[] = [];
  let current: { path: string; token: string; params: Record<string, string> } | null = { path, token, params };
  for (let page = 0; page < 10 && current; page++) {
    const result: GraphOk<{ data: T[]; paging?: { next?: string } }> | GraphError = await graphGet<{ data: T[]; paging?: { next?: string } }>(current.path, current.token, current.params);
    if (!result.ok) return { rows, error: result.error };
    rows.push(...(result.data.data ?? []));
    const next: string | undefined = result.data.paging?.next;
    if (!next) break;
    const nextUrl: URL = new URL(next);
    current = {
      path: nextUrl.pathname.replace(/^\//, ''),
      token: nextUrl.searchParams.get('access_token') ?? token,
      params: {},
    };
  }
  return { rows };
}
