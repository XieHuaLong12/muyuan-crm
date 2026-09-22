import { ZodError } from 'zod';
import { HttpError } from '@/lib/auth';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { syncCustomerWorkflow } from '@/services/workflow-service';
import { updateWhatsAppStage } from '@/services/whatsapp-stage-service';
import { ingestWhatsAppWebhook } from '@/services/whatsapp-webhook-service';


export const dynamic = 'force-dynamic';


function safeEqual(a:string,b:string){

 const left = Buffer.from(a);
 const right = Buffer.from(b);

 return (
   left.length === right.length &&
   timingSafeEqual(left,right)
 );
}


/**
 * GET verification
 */
export async function GET(req:NextRequest){

 const mode =
 req.nextUrl.searchParams.get('hub.mode');

 const token =
 req.nextUrl.searchParams.get('hub.verify_token');

 const challenge =
 req.nextUrl.searchParams.get('hub.challenge');

 const expected =
 process.env.WHATSAPP_VERIFY_TOKEN;


 if(
  mode==="subscribe" &&
  expected &&
  token &&
  safeEqual(token,expected)
 ){

  return new NextResponse(
    challenge ?? '',
    {
      status:200,
      headers:{
       "Content-Type":"text/plain"
      }
    }
  );
 }


 return NextResponse.json({
  success:true,
  message:"Webhook ready"
 });

}



/**
 * WhatsApp webhook receiver
 */
export async function POST(req:NextRequest){

 const raw = await req.text();


 console.log(
  "[WhatsApp Webhook] received",
  new Date().toISOString()
 );


 console.log(
  "[WhatsApp Webhook Body]",
  raw.slice(0,2000)
 );


 let payload:any;


 try{

  payload = JSON.parse(raw);

 }catch{

  return NextResponse.json(
   {
    success:false,
    error:"Invalid JSON"
   },
   {
    status:400
   }
  );

 }



 /**
  * Normalize Gupshup wrapper
  *
  * 支持:
  * {
  *  app:"",
  *  payload:{}
  * }
  */

 if(
  payload?.payload &&
  typeof payload.payload==="object"
 ){

   payload =
   {
    ...payload.payload,
    app:payload.app
   };

 }



 const isMetaWebhook =
 payload?.object ===
 "whatsapp_business_account";




 /**
  * Gupshup security
  */

 if(!isMetaWebhook){

   const secret =
   process.env.GUPSHUP_WEBHOOK_SECRET;


   if(secret){

    const token =
    req.headers.get(
      "x-webhook-secret"
    )
    ||
    req.nextUrl.searchParams.get(
      "token"
    )
    ||
    "";


    if(!safeEqual(token,secret)){

      console.warn(
       "Invalid Gupshup secret"
      );

      return NextResponse.json(
       {
        success:false,
        error:"Invalid secret"
       },
       {
        status:401
       }
      );

    }

   }



   const app =
   process.env.GUPSHUP_APP_NAME;


   if(
    app &&
    payload?.app &&
    payload.app !== app
   ){

    return NextResponse.json(
     {
      success:false,
      error:"Invalid app"
     },
     {
      status:400
     }
    );

   }

 }



 /**
  * Meta signature
  *
  * 不阻断Gupshup
  */

 if(isMetaWebhook){

  const appSecret =
  process.env.META_APP_SECRET;


  const signature =
  req.headers.get(
   "x-hub-signature-256"
  );


  if(appSecret && signature){

   const expected =
   "sha256="+
   createHmac(
    "sha256",
    appSecret
   )
   .update(raw)
   .digest("hex");


   if(!safeEqual(signature,expected)){

    return NextResponse.json(
     {
      success:false,
      error:"Invalid signature"
     },
     {
      status:401
     }
    );

   }

  }

 }



 try{


  const result =
  await ingestWhatsAppWebhook(
    payload
  );



  /**
   * AI workflow
   */

  Promise.all(
   result.customerIds.map(
    async(customerId)=>{

     try{

      await syncCustomerWorkflow(
       customerId
      );


      await updateWhatsAppStage(
       customerId
      );


     }catch(error){

      console.error(
       "workflow failed",
       customerId,
       error
      );

     }

    }
   )
  );



  return NextResponse.json(
   {
    success:true,
    received:true,
    messages:
     result.messages ?? 0,

    customers:
     result.customerIds.length
   }
  );


 }catch(error){


  console.error(
   "Webhook ingestion failed",
   error
  );


  if(
   error instanceof ZodError ||
   error instanceof HttpError
  ){

   return NextResponse.json(
    {
     success:false,
     error:
      error.message
    },
    {
     status:
      error instanceof HttpError
      ? error.status
      :400
    }
   );

  }



  return NextResponse.json(
   {
    success:false,
    error:"Webhook processing failed"
   },
   {
    status:500
   }
  );


 }

}
