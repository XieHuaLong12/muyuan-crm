/**
 * /api/meta/webhook — an older address of the Meta lead webhook, kept for Meta apps already configured with it.
 * Both addresses run the same handlers; see /api/leads/webhook for verification, signatures and retries.
 */
export { GET, POST } from '../../leads/webhook/route';
