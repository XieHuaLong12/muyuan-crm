import { BOSShell } from '@/components/bos/BOSShell';
import { FreightLibrary } from '@/components/bos/quote/FreightLibrary';
import { workspacePage } from '@/services/workspace-page';
import { listFreightRates } from '@/services/freight-service';
import { quoteFxRates } from '@/services/quote-template-service';
import { Reveal,MOTION_DELAY } from '@/components/ui/motion';
export const dynamic='force-dynamic';
export default async function Page(){const {user,boot}=await workspacePage();const [rates,fx]=await Promise.all([listFreightRates(user,{status:'ALL'}),quoteFxRates()]);return <BOSShell boot={boot}><Reveal delay={MOTION_DELAY.main}><FreightLibrary initialRates={rates} isAdmin={user.role==='ADMIN'} fx={fx}/></Reveal></BOSShell>;}
