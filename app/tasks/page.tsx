import { BOSShell } from '@/components/bos/BOSShell';
import { ActionCenter } from '@/components/bos/ActionCenter';
import { workspacePage } from '@/services/workspace-page';
import { actionCenter } from '@/services/action-center-service';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const {user,boot}=await workspacePage();
 return <BOSShell boot={boot}><ActionCenter data={await actionCenter(user,await searchParams)} name={user.name} people={user.role==='ADMIN'?boot.users.filter(person=>person.isActive!==false).map(person=>({id:person.id,name:person.name})):[]}/></BOSShell>;
}
