import { requireUser, scope } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { syncWorkflows } from '@/services/workflow-service';
import { fillMissingCountries } from '@/services/customer-country-service';
import { deliverLeadAlerts } from '@/services/lead-alert-service';
import { afterResponse } from '@/lib/after-response';

// An explicit mutation endpoint: page rendering and GET polling remain read-only.
export async function POST() {
  return handle(async () => {
    const user = await requireUser();
    await syncWorkflows(user);
    // Older customers get their country from their WhatsApp number soon after this release, without a manual step.
    const countries = await fillMissingCountries(scope(user));
    // Safety net while the CRM is open: alerts whose immediate delivery failed.
    const alerts = await deliverLeadAlerts();
    // The morning brief, the overdue / lead-drop alerts and lead grading (rules for leads without a grade, then the
    // AI reading rule-graded leads) also run without a scheduled job, while anyone has the CRM open. They may wait for
    // the AI, so they run after the response.
    afterResponse(async () => {
      const { checkAnomalies, deliverDailyBrief } = await import('@/services/boss-brief-service');
      await checkAnomalies();
      await deliverDailyBrief();
      if (user.role !== 'ADMIN') return;
      const { gradeUngradedLeads, reviewGradesWithAi } = await import('@/services/lead-grade-service');
      await gradeUngradedLeads();
      await reviewGradesWithAi();
    });
    return ok({ synced: true, countries, alerts });
  });
}
