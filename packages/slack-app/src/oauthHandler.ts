/**
 * Slack OAuth handler — exchanges the authorization code for a bot token
 * and persists the installation as a customer_tenant row.
 *
 * Flow:
 *   1. User clicks "Add to Slack" → redirected to Slack authorization page
 *   2. Slack redirects to GET /slack/oauth?code=...
 *   3. We exchange the code for tokens via oauth.v2.access
 *   4. We upsert a customer_tenants row so the workspace is known
 */
import { systemQuery } from '@glyphor/shared/db';
import { startOnboarding } from './onboardingHandler.js';
import { publishHomeTab } from './slackClient.js';

const SLACK_OAUTH_URL = 'https://slack.com/api/oauth.v2.access';

export interface OAuthResult {
  ok: true;
  tenantId: string;
  slackTeamId: string;
  teamName: string;
}

const GLYPHOR_TENANT_ID = '00000000-0000-0000-0000-000000000000';

export async function handleOAuthCallback(
  code: string,
  glyphorTenantId: string,
): Promise<OAuthResult> {
  // Guard: ensure tenant_id is a valid UUID — fall back to Glyphor default
  const tenantId = glyphorTenantId && glyphorTenantId.length >= 36
    ? glyphorTenantId
    : (process.env.DEFAULT_TENANT_ID || GLYPHOR_TENANT_ID);

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!clientId || !clientSecret || !signingSecret) {
    throw new Error('SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and SLACK_SIGNING_SECRET are required');
  }

  const params = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret });
  const res = await fetch(`${SLACK_OAUTH_URL}?${params.toString()}`);
  const data = (await res.json()) as Record<string, unknown>;

  if (!data['ok']) {
    throw new Error(`Slack OAuth failed: ${data['error'] ?? 'unknown'}`);
  }

  const teamId = (data['team'] as { id: string })?.id;
  const teamName = (data['team'] as { name: string })?.name ?? 'Unknown';
  const botToken = (data['access_token'] as string) ?? '';
  const botUserId = (data['bot_user_id'] as string) ?? null;
  const scopes = ((data['scope'] as string) ?? '').split(',').filter(Boolean);

  await systemQuery(
    `INSERT INTO customer_tenants
       (tenant_id, slack_team_id, slack_team_name, bot_user_id, bot_token, signing_secret, scopes, installed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'oauth')
     ON CONFLICT (slack_team_id) DO UPDATE
       SET bot_token      = EXCLUDED.bot_token,
           bot_user_id    = EXCLUDED.bot_user_id,
           slack_team_name = EXCLUDED.slack_team_name,
           scopes         = EXCLUDED.scopes,
           status         = 'active',
           updated_at     = NOW()`,
    [tenantId, teamId, teamName, botUserId, botToken, signingSecret, scopes],
  );

  console.log(`[Slack] OAuth install complete: team=${teamId} (${teamName})`);

  // Kick off onboarding — look up the customer_tenant row we just upserted
  const ctRows = await systemQuery<{ id: string }>(
    `SELECT id FROM customer_tenants WHERE slack_team_id = $1 AND status = 'active' LIMIT 1`,
    [teamId],
  );
  const customerTenantId = ctRows[0]?.id;
  const installerUserId = (data['authed_user'] as { id?: string })?.id ?? '';

  if (customerTenantId && botToken && installerUserId) {
    // Publish App Home tab to activate the Messages tab for DMs
    publishHomeTab(botToken, installerUserId).catch((err: unknown) => {
      console.error(`[Slack] Home tab publish failed for team=${teamId}:`, err);
    });

    startOnboarding(customerTenantId, botToken, installerUserId).catch((err: unknown) => {
      console.error(`[Slack] Onboarding start failed for team=${teamId}:`, err);
    });
  }

  return { ok: true, tenantId, slackTeamId: teamId, teamName };
}
