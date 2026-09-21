import { dayKey,localDate } from './time';
export const channels=['FACEBOOK','INSTAGRAM','TIKTOK','ALIBABA'] as const;
export type Channel=typeof channels[number];
export const channelLabels:Record<Channel,string>={FACEBOOK:'Facebook',INSTAGRAM:'Instagram',TIKTOK:'TikTok',ALIBABA:'Alibaba'};
export const bosStages=[{key:'NEW',label:'New Lead',title:'新线索',stages:['NEW']},{key:'CONTACTED',label:'Contacted',title:'已联系',stages:['CONTACTED']},{key:'REPLIED',label:'Replied',title:'已回复',stages:['REPLIED','NEEDS_CONFIRMED']},{key:'QUOTED',label:'Quoted',title:'已报价',stages:['QUOTED']},{key:'NEGOTIATION',label:'Negotiation',title:'洽谈中',stages:['FOLLOW_UP','ORDER']},{key:'WON',label:'Won',title:'已成交',stages:['WON']}] as const;
export function opportunityStage(stage:string){return bosStages.find(s=>(s.stages as readonly string[]).includes(stage))?.key||stage;}
export function bosDateRange(now:Date,timezone:string){const today=dayKey(now,timezone);const next=new Date(`${today}T12:00:00Z`);next.setUTCDate(next.getUTCDate()+1);return {today,start:localDate(`${today}T00:00`,timezone),end:localDate(`${next.toISOString().slice(0,10)}T00:00`,timezone),monthStart:localDate(`${today.slice(0,7)}-01T00:00`,timezone)};}
export function greeting(now:Date,timezone:string){const hour=Number(new Intl.DateTimeFormat('en',{hour:'numeric',hourCycle:'h23',timeZone:timezone}).format(now));return hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';}
export type ChannelSummary={channel:Channel;status:'NOT_CONNECTED'|'RECORDED';spend:string|null;currency:string;leads:number;cpl:string|null};
export function emptyChannels(currency:string):ChannelSummary[]{return channels.map(channel=>({channel,status:'NOT_CONNECTED',spend:null,currency,leads:0,cpl:null}));}
export type CommandData={generatedAt:string;timezone:string;today:string;scope:'TEAM'|'PERSONAL';newLeads:number;followUps:number;quotes:number;orders:number;revenue:{currency:string;amount:string}[];funnel:{key:string;label:string;title:string;count:number}[];excludedStages:number;channels:ChannelSummary[];suggestions:{id:string;title:string;detail:string;href:string;priority:'HIGH'|'NORMAL'}[]};
