/** Graph requests keep credentials in headers and preserve pagination query parameters. */
export function graphVersion() { return process.env.META_GRAPH_VERSION?.trim() || 'v26.0'; }
type GraphError = { ok: false; error: string };
type GraphOk<T> = { ok: true; data: T };
export async function graphGet<T>(path: string, token: string, params: Record<string,string>): Promise<GraphOk<T>|GraphError> {
  const unversioned = path.replace(/^\/?v\d+\.\d+\//,'').replace(/^\//,'');
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${unversioned}`);
  for (const [key,value] of Object.entries(params)) if(key!=='access_token')url.searchParams.set(key,value);
  try {
    const response = await fetch(url,{cache:'no-store',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
    const parsed = await response.json() as T & {error?:{code?:number;error_subcode?:number;message?:string}};
    if(!response.ok){const e=parsed.error;return {ok:false,error:`${e?.code===190?'TOKEN_EXPIRED':'GRAPH_ERROR'} HTTP ${response.status} code ${e?.code??'unknown'} subcode ${e?.error_subcode??'unknown'}`};}
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
    const parsed = await response.json() as T & {error?:{code?:number;error_subcode?:number}};
    if(!response.ok){const e=parsed.error;return {ok:false,error:`${e?.code===190?'TOKEN_EXPIRED':'GRAPH_ERROR'} HTTP ${response.status} code ${e?.code??'unknown'} subcode ${e?.error_subcode??'unknown'}`};}
    return {ok:true,data:parsed};
  } catch { return {ok:false,error:'GRAPH_NETWORK_OR_RESPONSE_ERROR'}; }
}
