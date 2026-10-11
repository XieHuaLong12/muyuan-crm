import { notFound,redirect } from 'next/navigation';
import { BOSShell } from '@/components/bos/BOSShell';
import { QuoteBuilder } from '@/components/bos/quote/QuoteBuilder';
import { HttpError } from '@/lib/auth';
import { workspacePage,jsonForClient } from '@/services/workspace-page';
import { quoteBuilderData,type QuoteBuilderData } from '@/services/itemized-quote-service';
export const dynamic='force-dynamic';
// ?customerId= 预选客户；?product= 从产品详情进入；?from= 复制旧报价；?edit= 修改草稿
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const {user,boot}=await workspacePage();const query=await searchParams;
 let data:QuoteBuilderData;
 try{data=await quoteBuilderData(user,query);}catch(error){
  if(error instanceof HttpError&&error.status===404)notFound();
  if(error instanceof HttpError&&error.status===409&&query.edit)redirect(`/products/quotes/${encodeURIComponent(query.edit)}`);
  throw error;
 }
 return <BOSShell boot={boot}><QuoteBuilder key={query.edit||query.from||'new'} data={jsonForClient(data)}/></BOSShell>;
}
