import { NextRequest } from 'next/server';
import { HttpError, requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { createImageNote,createNote,wall } from '@/services/idea-wall-service';
export const dynamic='force-dynamic';
/** GET ?q&kind&tag&archived: my wall — notes, counts, tags, what to tidy, reminders due, 今日一句. */
export async function GET(req:NextRequest){return handle(async()=>ok(await wall(await requireUser(),Object.fromEntries(req.nextUrl.searchParams))));}
/** POST JSON {text, kind?, source?, color?, tags?, capturedOn?} or multipart {file, text?, capturedOn?} for a screenshot. */
export async function POST(req:NextRequest){return handle(async()=>{
  const user=await requireUser();
  if((req.headers.get('content-type')??'').startsWith('multipart/form-data')){
    const form=await req.formData();const file=form.get('file');if(!(file instanceof File))throw new HttpError(400,'请选择图片');
    return ok(await createImageNote(user,file,Object.fromEntries([...form.entries()].filter(([,v])=>typeof v==='string'))));
  }
  return ok(await createNote(user,await req.json()));
});}
