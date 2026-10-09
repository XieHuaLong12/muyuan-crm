import { db } from '@/lib/db';
import { duplicates,saveCustomer } from './customer-service';
import { Actor } from '@/lib/auth';
import { z } from 'zod';
export function mapWebhookLead(raw:unknown){return z.object({name:z.string(),companyName:z.string().optional(),country:z.string().optional(),phone:z.string().optional(),whatsapp:z.string().optional(),email:z.string().optional(),source:z.string().optional(),sourceDetail:z.string().optional(),productInterest:z.string().optional(),productModel:z.string().optional(),purchaseType:z.string().optional(),quantity:z.number().optional(),notes:z.string().optional()}).parse(raw);}
let queue:Promise<unknown>=Promise.resolve();
export function importLead(raw:unknown){const execute=async()=>{const mapped=mapWebhookLead(raw);const dup=await duplicates(mapped);if(dup.length)return {potentialDuplicate:true,duplicateDetected:true,created:false};const owner=await db.user.findFirstOrThrow({where:{role:'ADMIN',isActive:true}});const actor:Actor={id:owner.id,name:owner.name,email:owner.email,role:owner.role};const customer=await saveCustomer({...mapped,ownerId:owner.id,stage:'NEW',isQualified:null},actor);return {customerId:customer.id,created:true,potentialDuplicate:false};};const result=queue.then(execute,execute);queue=result.catch(()=>{});return result;}
