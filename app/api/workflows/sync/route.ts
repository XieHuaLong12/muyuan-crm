import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { syncWorkflows } from '@/services/workflow-service';

// An explicit mutation endpoint: page rendering and GET polling remain read-only.
export async function POST() {
  return handle(async () => {
    await syncWorkflows(await requireUser());
    return ok({ synced: true });
  });
}
