import { notFound } from 'next/navigation';
import { BOSShell } from '@/components/bos/BOSShell';
import { QuoteView } from '@/components/bos/quote/QuoteView';
import { HttpError } from '@/lib/auth';
import { workspacePage } from '@/services/workspace-page';
import { quoteDetail,type QuoteDetail } from '@/services/itemized-quote-service';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|undefined>>}){
 const {user,boot}=await workspacePage();const {id}=await params;const {saved}=await searchParams;
 let detail:QuoteDetail;
 try{detail=await quoteDetail(user,id);}catch(error){if(error instanceof HttpError&&error.status===404)notFound();throw error;}
 return <BOSShell boot={boot}><QuoteView detail={detail} justSaved={saved==='1'}/></BOSShell>;
}
