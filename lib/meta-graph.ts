/** Graph requests keep credentials in headers and preserve pagination query parameters. */
export function graphVersion() { return process.env.META_GRAPH_VERSION?.trim() || 'v26.0'; }
type GraphError = { ok: false; error: string };
type GraphOk<T> = { ok: true; data: T };
type GraphErrorBody = { error?: { code?: number; error_subcode?: number; message?: string } };

/** Keeps Meta's own message (it names the missing permission) but never echoes a credential back. */
function graphFailure(status: number, body: GraphErrorBody, token: string) {
  const e = body.error;
  let message = (e?.message ?? '').replace(/EAA[A-Za-z0-9]{20,}/g, '[redacted]');
  if (token) message = message.replaceAll(token, '[redacted]');
  return `${e?.code===190?'TOKEN_EXPIRED':'GRAPH_ERROR'} HTTP ${status} code ${e?.code??'unknown'} subcode ${e?.error_subcode??'unknown'}${message ? `: ${message.slice(0, 300)}` : ''}`;
}
export async function graphGet<T>(path: string, token: string, params: Record<string,string>): Promise<GraphOk<T>|GraphError> {
  const unversioned = path.replace(/^\/?v\d+\.\d+\//,'').replace(/^\//,'');
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${unversioned}`);
  for (const [key,value] of Object.entries(params)) if(key!=='access_token')url.searchParams.set(key,value);
  try {
    const response = await fetch(url,{cache:'no-store',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
    const parsed = await response.json() as T & GraphErrorBody;
    if(!response.ok)return {ok:false,error:graphFailure(response.status,parsed,token)};
    return {ok:true,data:parsed};
  } catch { return {ok:false,error:'GRAPH_NETWORK_OR_RESPONSE_ERROR'}; }
}
export async function pagedGraphGet<T>(path:string,token:string,params:Record<string,string>):Promise<{rows:T[];error?:string}> {
  const rows:T[]=[];let current={path,params};const seen=new Set<string>();
  for(let page=0;page<100;page++){
    const key=JSON.stringify(current);if(seen.has(key))return {rows,error:'GRAPH_PAGING_LOOP'};seen.add(key);
    const result=await graphGet<{data:T[];paging?:{next?:string}}>(current.path,token,current.params);
    if(!result.ok)return {rows,error:result.error};
    if(!Array.isArray(result.data.data))return {rows,error:'GRAPH_INVALID_PAGE'};
    rows.push(...result.data.data);
    const next=result.data.paging?.next;if(!next)return {rows};
    let url:URL;try{url=new URL(next);}catch{return {rows,error:'GRAPH_INVALID_PAGING_URL'};}
    if(url.protocol!=='https:'||url.hostname!=='graph.facebook.com')return {rows,error:'GRAPH_UNTRUSTED_PAGING_URL'};
    current={path:url.pathname,params:Object.fromEntries([...url.searchParams].filter(([key])=>key!=='access_token'))};
  }
  return {rows,error:'GRAPH_PAGE_LIMIT_REACHED'};
}
/** Form-encoded POST with the credential in the header (used to manage the Page's app subscription). */
export async function graphPost<T>(path: string, token: string, params: Record<string,string>): Promise<GraphOk<T>|GraphError> {
  const unversioned = path.replace(/^\/?v\d+\.\d+\//,'').replace(/^\//,'');
  try {
    const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${unversioned}`,{method:'POST',cache:'no-store',
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params),signal:AbortSignal.timeout(20000)});
    const parsed = await response.json() as T & GraphErrorBody;
    if(!response.ok)return {ok:false,error:graphFailure(response.status,parsed,token)};
    return {ok:true,data:parsed};
  } catch { return {ok:false,error:'GRAPH_NETWORK_OR_RESPONSE_ERROR'}; }
}

export type GraphErrorHelp = { cause: string; fix: string[] };
const LEAD_ACCESS_FIX = [
  '点「检测连接」查看 Token 缺少哪些权限。读取线索需要 leads_retrieval、pages_manage_ads、pages_read_engagement、pages_show_list；缺哪个就在生成 Token 时补勾，更新 META_PAGE_ACCESS_TOKEN 后重启服务。',
  'Meta Business 设置 → 集成 → 线索访问权限（Leads Access）→ 选中该主页：在「CRM」中分配本应用，在「人员」中加入生成 Token 的人或系统用户。主页启用线索访问权限后，没被分配的人和应用都读不到线索内容。',
  '应用处于开发模式时，生成 Token 的人必须是该应用的管理员或开发者；否则需要在应用面板为 leads_retrieval 申请高级权限（Advanced Access）。',
  '改好后点「立即重试失败线索」，再点「补拉最近 7 天」，等待中的线索会自动入库。',
];

/** Turns a stored Graph failure into a cause and the steps an administrator can take; null when not recognised. */
export function explainGraphError(error: string): GraphErrorHelp | null {
  const code = Number(/\bcode (\d+)/.exec(error)?.[1]), subcode = Number(/\bsubcode (\d+)/.exec(error)?.[1]);
  if (error.includes('META_PAGE_ACCESS_TOKEN 未配置')) return { cause: '服务器没有配置 META_PAGE_ACCESS_TOKEN', fix: ['在服务器环境变量中填写主页 Token 后重启服务。'] };
  if (code === 190 || error.includes('TOKEN_EXPIRED')) return {
    cause: '主页 Token 已失效：过期、被撤销，或生成它的人改了密码、不再管理该主页',
    fix: ['在 Meta Business 设置 → 系统用户中重新生成不过期的主页 Token（勾选 leads_retrieval、pages_manage_ads、pages_read_engagement、pages_show_list、pages_manage_metadata），更新 META_PAGE_ACCESS_TOKEN 后重启服务。', '改好后点「立即重试失败线索」。'],
  };
  if ([4, 17, 32, 613].includes(code) || (code >= 80000 && code < 80100)) return { cause: 'Meta 接口调用次数超限', fix: ['无需处理，系统会自动退避重试。持续出现时，检查是否有其他程序在频繁调用同一主页。'] };
  if (code === 100 && /nonexist|Tried accessing/i.test(error)) return { cause: 'Meta 不认识请求的字段（接口版本变化）', fix: ['把 META_GRAPH_VERSION 设为 Meta 当前支持的版本后重启服务；仍不行请联系开发。'] };
  if (code === 100 && subcode === 33) return { cause: 'Meta 拒绝读取线索：Token 没有该主页的线索访问权限（只有个别线索报这个错时，也可能是线索已在 Meta 被删除）', fix: LEAD_ACCESS_FIX };
  if (code === 10 || (code >= 200 && code < 300) || /leads_retrieval|permission/i.test(error)) return { cause: 'Token 能看到主页和表单，但没有读取线索内容的权限', fix: LEAD_ACCESS_FIX };
  if (code === 1 || code === 2 || /HTTP 5\d\d/.test(error)) return { cause: 'Meta 服务临时故障', fix: ['无需处理，系统会自动重试。'] };
  if (/GRAPH_NETWORK|Graph API 请求失败/.test(error)) return { cause: '服务器连不上 graph.facebook.com', fix: ['检查服务器网络、防火墙和 DNS；恢复后系统会自动重试。'] };
  return null;
}
