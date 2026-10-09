import { cache } from 'react';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { workspaceBootstrap } from './sales-workspace-service';
export const workspacePage=cache(async()=>{const user=await currentUser();if(!user)redirect('/login');return {user,boot:await workspaceBootstrap(user)};});
export const adminWorkspacePage=cache(async()=>{const user=await currentUser();if(!user)redirect('/login');if(user.role!=='ADMIN')redirect('/sales');return {user,boot:await workspaceBootstrap(user)};});
export function jsonForClient<T>(value:unknown):T{return JSON.parse(JSON.stringify(value));}
