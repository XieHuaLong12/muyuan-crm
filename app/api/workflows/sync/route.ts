import { requireUser, scope } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { syncWorkflows } from '@/services/workflow-service';
import { fillMissingCountries } from '@/services/customer-country-service';
import { gradeUngradedLeads } from '@/services/lead-grade-service';
import { deliverLeadAlerts } from '@/services/lead-alert-service';
import { afterResponse } from '@/lib/after-response';

// An explicit mutation endpoint: page rendering and GET polling remain read-only.
export async function POST() {
  return handle(async () => {
    const user = await requireUser();
    await syncWorkflows(user);
    // Older customers get their country from their WhatsApp number soon after this release, without a manual step.
    const countries = await fillMissingCountries(scope(user));
    // Safety net while the CRM is open: alerts whose immediate delivery failed, and older leads without a grade.
    const alerts = await deliverLeadAlerts();
    const grades = user.role === 'ADMIN' ? await gradeUngradedLeads() : { graded: 0 };
    // The morning brief and the overdue / lead-drop alerts also run without a scheduled job, while anyone has the
    // CRM open. The brief may wait for the AI, so this runs after the response.
    afterResponse(async () => {
      const { checkAnomalies, deliverDailyBrief } = await import('@/services/boss-brief-service');
      await checkAnomalies();
      await deliverDailyBrief();
    });
    return ok({ synced: true, countries, alerts, grades });
  });
}
