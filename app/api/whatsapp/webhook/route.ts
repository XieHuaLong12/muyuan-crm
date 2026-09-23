import { ZodError } from 'zod';
import { HttpError } from '@/lib/auth';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { syncCustomerWorkflow } from '@/services/workflow-service';
import { updateWhatsAppStage } from '@/services/whatsapp-stage-service';
import { ingestWhatsAppWebhook } from '@/services/whatsapp-webhook-service';


export const dynamic = 'force-dynamic';


type JsonObject = Record<string, unknown>;


function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return (
    left.length === right.length &&
    timingSafeEqual(left, right)
  );
}


function isObject(
  value: unknown
): value is JsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}


/**
 * Meta webhook verification
 */
export async function GET(
  req: NextRequest
) {

  const mode =
    req.nextUrl.searchParams.get(
      'hub.mode'
    );

  const token =
    req.nextUrl.searchParams.get(
      'hub.verify_token'
    );

  const challenge =
    req.nextUrl.searchParams.get(
      'hub.challenge'
    );


  const expected =
    process.env.WHATSAPP_VERIFY_TOKEN;


  if (
    mode === 'subscribe' &&
    expected &&
    token &&
    safeEqual(token, expected)
  ) {

    return new NextResponse(
      challenge ?? '',
      {
        status: 200,
        headers:{
          'Content-Type':
            'text/plain; charset=utf-8',
        },
      }
    );

  }


  return NextResponse.json({
    success:true,
    message:'Webhook ready',
  });

}



/**
 * Receive WhatsApp messages
 */
export async function POST(
  req: NextRequest
) {


  const raw =
    await req.text();


  console.log(
    '[WhatsApp Webhook] Received:',
    new Date().toISOString()
  );


  console.log(
    '[WhatsApp Webhook Payload]',
    raw.slice(0,3000)
  );


  let payload: JsonObject;


  try {

    const parsed =
      JSON.parse(raw);


    if (!isObject(parsed)) {

      return NextResponse.json(
        {
          success:false,
          error:'Invalid payload',
        },
        {
          status:400,
        }
      );

    }


    payload = parsed;


  } catch {


    return NextResponse.json(
      {
        success:false,
        error:'Invalid JSON payload',
      },
      {
        status:400,
      }
    );

  }



  /**
   * Normalize Gupshup wrapper
   *
   * Example:
   *
   * {
   *   app:"JasonCRM",
   *   payload:{}
   * }
   *
   */

  if (
    isObject(payload.payload)
  ) {

    payload = {

      ...(payload.payload),

      app:
        payload.app,

    };

  }



  const isMetaWebhook =
    payload.object ===
    'whatsapp_business_account';



  /**
   * Gupshup verification
   */

  if (!isMetaWebhook) {


    const secret =
      process.env
      .GUPSHUP_WEBHOOK_SECRET
      ?.trim();



    if (secret) {


      const providedToken =
        req.headers.get(
          'x-webhook-secret'
        )
        ??
        req.nextUrl.searchParams.get(
          'token'
        )
        ??
        '';



      if (
        !safeEqual(
          providedToken,
          secret
        )
      ) {

        console.warn(
          '[WhatsApp] Invalid webhook secret'
        );


        return NextResponse.json(
          {
            success:false,
            error:'Invalid webhook token',
          },
          {
            status:401,
          }
        );

      }

    }



    const app =
      process.env
      .GUPSHUP_APP_NAME
      ?.trim();



    if (
      app &&
      payload.app &&
      payload.app !== app
    ) {

      return NextResponse.json(
        {
          success:false,
          error:'Unexpected Gupshup app',
        },
        {
          status:400,
        }
      );

    }

  }




  /**
   * Meta signature validation
   *
   * Only validate when signature exists.
   * Avoid blocking Gupshup.
   */

  if (isMetaWebhook) {


    const appSecret =
      process.env
      .META_APP_SECRET
      ?.trim();



    const signature =
      req.headers.get(
        'x-hub-signature-256'
      );



    if (
      appSecret &&
      signature
    ) {


      const expectedSignature =
        `sha256=${
          createHmac(
            'sha256',
            appSecret
          )
          .update(raw)
          .digest('hex')
        }`;



      if (
        !safeEqual(
          signature,
          expectedSignature
        )
      ) {

        return NextResponse.json(
          {
            success:false,
            error:'Invalid webhook signature',
          },
          {
            status:401,
          }
        );

      }

    }

  }



  try {


    const result =
      await ingestWhatsAppWebhook(
        payload as Parameters<
          typeof ingestWhatsAppWebhook
        >[0]
      );



    await Promise.all(

      result.customerIds.map(
        async(customerId)=>{

          try {

            await syncCustomerWorkflow(
              customerId
            );


            await updateWhatsAppStage(
              customerId
            );


          } catch(error) {


            console.error(
              '[WhatsApp Workflow Failed]',
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
          result.received,

        customers:
          result.customerIds.length,

      }
    );


  } catch(error) {


    console.error(
      '[WhatsApp Webhook Error]',
      error
    );



    if (
      error instanceof ZodError ||
      error instanceof HttpError
    ) {


      return NextResponse.json(
        {
          success:false,
          error:
            error.message,
        },
        {
          status:
            error instanceof HttpError
            ? error.status
            :400,
        }
      );

    }



    return NextResponse.json(
      {
        success:false,
        error:
          'Webhook processing failed',
      },
      {
        status:500,
      }
    );

  }

}
