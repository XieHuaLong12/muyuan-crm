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
 * 是否为 Meta Lead Ads 推送。
 *
 * 只按结构判断：entry[].changes[] 里存在 field === 'leadgen'。
 * 这样任何非 Lead Ads 的 payload（含 Gupshup 包装、WhatsApp Cloud API）都不会被误判。
 */
function containsLeadgenEvent(
  payload: Record<string, unknown>
) {

  const entries =
    payload.entry;


  if (!Array.isArray(entries)) return false;


  return entries.some(entry => {

    if (!isObject(entry)) return false;


    const changes =
      entry.changes;


    if (!Array.isArray(changes)) return false;


    return changes.some(change =>
      isObject(change) &&
      change.field === 'leadgen'
    );

  });

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


  /**
   * 同一个回调地址服务两条产品线，因此接受两个 verify token：
   *   - WHATSAPP_VERIFY_TOKEN      → WhatsApp / Gupshup
   *   - META_LEAD_WEBHOOK_SECRET   → Facebook Lead Ads
   * 任一个匹配即通过；行为与原来一致（原来只认第一个）。
   */
  const accepted = [
    process.env.WHATSAPP_VERIFY_TOKEN,
    process.env.META_LEAD_WEBHOOK_SECRET,
  ].filter((value): value is string => Boolean(value));


  const verified =
    mode === 'subscribe' &&
    Boolean(token) &&
    accepted.some(candidate => safeEqual(token as string, candidate));


  if (verified) {

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
   * Meta Lead Ads 分支
   *
   * 只认**结构**，不认 object 字段：必须存在 entry[].changes[].field === 'leadgen'。
   * 用 object !== 'whatsapp_business_account' 判断会把 Gupshup 的 payload 也劫持走，
   * 因此这里做精确检测，其余一切 payload 原样落到下方的 WhatsApp 流程。
   */
  if (containsLeadgenEvent(payload)) {

    const {
      verifyMetaSignature,
      handleWebhookPayload,
    } = await import('@/services/meta-lead-service');


    const signature =
      verifyMetaSignature(
        raw,
        req.headers.get('x-hub-signature-256')
      );


    if (!signature.ok) {

      console.warn(
        '[meta-lead] 签名校验失败',
        signature.reason
      );


      return new NextResponse(
        'unauthorized',
        {
          status:401,
          headers:{
            'Content-Type':'text/plain; charset=utf-8',
          },
        }
      );

    }


    try {

      const result =
        await handleWebhookPayload(payload);


      if (result.error) {

        console.warn(
          '[meta-lead] 推送解析异常',
          result.error
        );

      } else {

        console.log(
          `[meta-lead] 收到 ${result.accepted} 条 leadgen 事件`
        );

      }

    } catch (error) {

      // 仍返回 200：非 200 会让 Meta 持续重推，事件已登记可在后台重试
      console.error(
        '[meta-lead] 处理推送失败',
        error
      );

    }


    return new NextResponse(
      'EVENT_RECEIVED',
      {
        status:200,
        headers:{
          'Content-Type':'text/plain; charset=utf-8',
        },
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
