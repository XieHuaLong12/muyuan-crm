import { BOSShell } from '@/components/bos/BOSShell';
import { GrowthCenter } from '@/components/bos/GrowthCenter';
import { workspacePage } from '@/services/workspace-page';
import { growthCenter,growthQuery } from '@/services/bos-growth-service';
import { Reveal,MOTION_DELAY } from '@/components/ui/motion';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){const {user,boot}=await workspacePage();const parsed=growthQuery.safeParse(await searchParams);return <BOSShell boot={boot}><Reveal delay={MOTION_DELAY.main}><GrowthCenter data={await growthCenter(user,parsed.success?parsed.data:{})}/></Reveal></BOSShell>;}
