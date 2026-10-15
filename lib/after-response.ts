import { after } from 'next/server';

/**
 * Runs work after the response has been sent (Next's after()), so a webhook or a click answers at once while the
 * slower follow-up (AI grading, phone pushes) continues. Outside a request (scripts, tests) nothing runs here: the
 * scheduled jobs and the in-app sync pick the work up instead. Only next/server is imported, so webhook routes can
 * use this at the top level.
 */
export function afterResponse(work: () => Promise<unknown>) {
  try {
    after(() => work().catch(error => console.error('[after-response] failed', error instanceof Error ? error.message : 'unknown')));
  } catch {
    // No request scope.
  }
}

/** Lead alerts (grading + phone push) after the response; the alert service is loaded only when it runs. */
export function deliverLeadAlertsAfterResponse() {
  afterResponse(async () => (await import('@/services/lead-alert-service')).deliverLeadAlerts());
}
