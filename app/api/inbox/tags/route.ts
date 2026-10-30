import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { tagLibrary } from '@/services/customer-tag-service';
export const dynamic='force-dynamic';
// The shared tag library with how many of this person's customers carry each tag.
export async function GET(){return handle(async()=>ok(await tagLibrary(await requireUser())));}
