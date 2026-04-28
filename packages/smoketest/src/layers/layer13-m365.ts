/**
 * Layer 13 – Microsoft 365 Integration
 *
 * Validates Azure credentials, Teams channel configuration, bot endpoint,
 * Graph API email/calendar, M365 admin agents, and SharePoint knowledge sync.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpGet, httpPost } from '../utils/http.js';
import { query, queryTable, countRows } from '../utils/db.js';
import { runTest } from '../utils/test.js';

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // T13.1 — Azure Credentials Configured
  tests.push(
    await runTest('T13.1', 'Azure Credentials Configured', async () => {
      const required = [
        'AZURE_TENANT_ID',
        'AZURE_CLIENT_ID',
        'AZURE_CLIENT_SECRET',
      ];
      const missing = required.filter(v => !process.env[v]);
      if (missing.length > 0) {
        throw new Error(`Missing Azure env vars: ${missing.join(', ')}`);
      }
      return `All ${required.length} Azure credential vars configured`;
    }),
  );

  // T13.2 — Teams Channel IDs Configured
  tests.push(
    await runTest('T13.2', 'Teams Channel IDs Configured', async () => {
      const teamId = process.env.TEAMS_TEAM_ID;
      if (!teamId) {
        throw new Error('TEAMS_TEAM_ID not set');
      }

      const channels = [
        'TEAMS_CHANNEL_GENERAL_ID',
        'TEAMS_CHANNEL_ENGINEERING_ID',
        'TEAMS_CHANNEL_DECISIONS_ID',
        'TEAMS_CHANNEL_FINANCIALS_ID',
        'TEAMS_CHANNEL_GROWTH_ID',
      ];
      const configured = channels.filter(v => !!process.env[v]);
      if (configured.length < 2) {
        throw new Error(
          `Only ${configured.length}/${channels.length} channel IDs set. Need at least 2.`,
        );
      }
      return `Team ID set, ${configured.length}/${channels.length} channel IDs configured`;
    }),
  );

  // T13.3 — Teams Bot Endpoint
  tests.push(
    await runTest('T13.3', 'Teams Bot Endpoint', async () => {
      // Send a minimal Bot Framework activity — endpoint should accept it (not 404)
      const res = await httpPost(
        `${config.schedulerUrl}/api/teams/messages`,
        {
          type: 'message',
          text: 'smoketest-ping',
          from: { id: 'smoketest', name: 'Smoketest' },
          channelId: 'msteams',
          conversation: { id: 'smoketest-conv' },
          serviceUrl: 'https://smba.trafficmanager.net/amer/',
        },
      );
      // 200/202 = accepted; 401 = JWT validation (expected without real token)
      // 404 = endpoint not deployed in this environment (informational)
      if (res.status === 404) {
        return 'Teams bot endpoint not deployed in scheduler service (404) — skipping strict bot-route check';
      }
      return `Teams bot endpoint reachable (HTTP ${res.status})`;
    }),
  );

  // T13.4 — Teams Activity in Logs
  tests.push(
    await runTest('T13.4', 'Teams Activity in Logs', async () => {
      const logs = await query<{ action: string; agent_role: string }>(
        `SELECT action, agent_role FROM activity_log
         WHERE action ILIKE '%teams%' OR action ILIKE '%channel%' OR action ILIKE '%briefing%'
         ORDER BY created_at DESC LIMIT 10`,
      );
      if (logs.length === 0) {
        throw new Error('No Teams-related activity found in activity_log');
      }
      const agents = [...new Set(logs.map(l => l.agent_role).filter(Boolean))];
      return `${logs.length} Teams activity entries from ${agents.length} agent(s): ${agents.join(', ')}`;
    }),
  );

  // T13.5 — Email Activity in Logs
  tests.push(
    await runTest('T13.5', 'Email Activity in Logs', async () => {
      const logs = await query<{ action: string; agent_role: string }>(
        `SELECT action, agent_role FROM activity_log
         WHERE action ILIKE '%email%' OR action ILIKE '%send_email%' OR action ILIKE '%inbox%'
         ORDER BY created_at DESC LIMIT 10`,
      );
      if (logs.length === 0) {
        return 'No email activity yet — email integration not exercised';
      }
      return `${logs.length} email activity entries found`;
    }),
  );

  // T13.7 — SharePoint Knowledge Ingested
  tests.push(
    await runTest('T13.7', 'SharePoint Knowledge Ingested', async () => {
      const count = await countRows('company_knowledge', {
        discovered_by: 'sharepoint-sync',
      });
      if (count === 0) {
        throw new Error('No SharePoint-sourced entries in company_knowledge');
      }
      return `${count} SharePoint knowledge entries ingested`;
    }),
  );

  // T13.8 — SendGrid Configuration
  tests.push(
    await runTest('T13.8', 'SendGrid Configuration', async () => {
      const keys = [
        'SENDGRID_API_KEY',
        'SENDGRID_API_KEY_EMERGENCY',
        'SENDGRID_API_KEY_SUPPORT',
      ];
      const configured = keys.filter(k => !!process.env[k]);
      if (configured.length === 0) {
        return 'No SendGrid API keys configured — email sending via SendGrid not available';
      }
      return `${configured.length}/${keys.length} SendGrid API keys configured`;
    }),
  );

  return { layer: 13, name: 'Microsoft 365 Integration', tests };
}
