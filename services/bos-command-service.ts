import { db } from '@/lib/db';
import { Actor,scope } from '@/lib/auth';
import { bosDateRange,bosStages,emptyChannels,CommandData } from '@/lib/bos';
export async function commandCenter(user:Actor,now=new Date()):Promise<CommandData>{
 const settings=await db.setting.findUniqueOrThrow({where:{id:'system'}});
 const {today,start,end,monthStart}=bosDateRange(now,settings.timezone),customer=scope(user);
 const [newLeads,followUps,quotes,orders,revenue,stages,lateQuotes]=await Promise.all([
  db.customer.count({where:{...customer,createdAt:{gte:start,lt:end}}}),
  db.customer.count({where:{...customer,stage:{notIn:['WON','LOST','INVALID','PAUSED']},OR:[{nextFollowUpAt:{lt:end}},{tasks:{some:{deletedAt:null,status:{not:'DONE'},dueDate:{lt:end}}}}]}}),
  db.quotation.count({where:{customer,createdAt:{gte:monthStart,lt:end}}}),
  db.deal.count({where:{customer,dealDate:{gte:monthStart,lt:end}}}),
  db.deal.groupBy({by:['currency'],where:{customer,dealDate:{gte:monthStart,lt:end}},_sum:{dealAmount:true}}),
  db.customer.groupBy({by:['stage'],where:customer,_count:{_all:true}}),
  db.quotation.count({where:{customer:{...customer,stage:{notIn:['WON','LOST','INVALID','PAUSED']},tasks:{some:{deletedAt:null,type:'QUOTATION',status:{not:'DONE'}}}},status:'SENT',sentAt:{lt:new Date(now.getTime()-7*86400000)}}}),
 ]);
 const funnel=bosStages.map(s=>({key:s.key,label:s.label,title:s.title,count:stages.filter(row=>(s.stages as readonly string[]).includes(row.stage)).reduce((sum,row)=>sum+row._count._all,0)}));
 const suggestions:CommandData['suggestions']=[];
 if(followUps)suggestions.push({id:'followups',title:`${followUps} 位客户需要跟进`,detail:'截至今日的跟进安排及未完成任务，优先处理有明确采购需求的客户。',href:'/sales?queue=today',priority:'HIGH'});
 if(lateQuotes)suggestions.push({id:'quotes',title:`${lateQuotes} 份报价已发送超过 7 天`,detail:'这些客户仍有未完成的报价跟进任务，建议确认价格和交付条件。',href:'/tasks?view=OVERDUE',priority:'HIGH'});
 if(!suggestions.length)suggestions.push({id:'clear',title:'今天的跟进节奏很从容',detail:'暂无需要优先处理的客户或长期未处理报价。打开销售工作台查看新线索。',href:'/sales',priority:'NORMAL'});
 return {generatedAt:now.toISOString(),timezone:settings.timezone,today,scope:user.role==='ADMIN'?'TEAM':'PERSONAL',newLeads,followUps,quotes,orders,revenue:revenue.map(r=>({currency:r.currency,amount:String(r._sum.dealAmount||0)})),funnel,excludedStages:stages.reduce((sum,s)=>sum+s._count._all,0)-funnel.reduce((sum,s)=>sum+s.count,0),channels:emptyChannels(settings.currency),suggestions};
}
