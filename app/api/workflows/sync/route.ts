import { requireUser, scope } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { syncWorkflows } from '@/services/workflow-service';
import { fillMissingCountries } from '@/services/customer-country-service';

// An explicit mutation endpoint: page rendering and GET polling remain read-only.
export async function POST() {
  return handle(async () => {
    const user = await requireUser();
    await syncWorkflows(user);
    // Older customers get their country from their WhatsApp number soon after this release, without a manual step.
    const countries = await fillMissingCountries(scope(user));
    return ok({ synced: true, countries });
  });
}
