import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { pushPublicKey, removePushSubscription, savePushSubscription } from '@/services/push-service';

export const dynamic = 'force-dynamic';

/** The public key this device subscribes with. */
export async function GET() {
  return handle(async () => { await requireUser(); return ok(await pushPublicKey()); });
}

/** This device wants system notifications for the signed-in user. */
export async function POST(req: NextRequest) {
  return handle(async () => ok(await savePushSubscription(await requireUser(), await req.json(), req.headers.get('user-agent') ?? '')));
}

/** Signing out, or notifications turned off on this device. */
export async function DELETE(req: NextRequest) {
  return handle(async () => ok(await removePushSubscription(await requireUser(), await req.json())));
}
