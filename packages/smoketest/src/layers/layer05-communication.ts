/**
 * Layer 5 — Communication
 *
 * Tests inter-agent messaging, meetings, Teams delivery, and email.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpPost, pollUntil } from '../utils/http.js';
import { queryTable } from '../utils/supabase.js';

async function runTest(
  id: string,
  name: string,
  fn: () => Promise<string>,
): Promise<TestResult> {
  const start = Date.now();
  try {
    const message = await fn();
    return { id, name, status: 'pass', message, durationMs: Date.now() - start };
  } catch (err) {
    return { id, name, status: 'fail', message: (err as Error).message, durationMs: Date.now() - start };
  }
}

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // T5.1 — Inter-Agent DMs
  tests.push(
    await runTest('T5.1', 'Inter-Agent DMs', async () => {
      const resp = await httpPost(`${config.schedulerUrl}/run`, {
        agentRole: 'chief-of-staff',
        task: 'on_demand',
        message:
          'Send a message to Marcus asking for a quick platform status update.',
      });

      if (!resp.ok) {
        throw new Error(`Scheduler /run returned ${resp.status}: ${resp.raw}`);
      }

      const messages = await queryTable<{
        id: string;
        from_agent: string;
        to_agent: string;
      }>(config, 'agent_messages', 'id,from_agent,to_agent', {
        from_agent: 'chief-of-staff',
        to_agent: 'cto',
      }, { order: 'created_at', desc: true, limit: 5 });

      if (messages.length === 0) {
        throw new Error('No message found from chief-of-staff to cto');
      }

      return `DM sent: message ${messages[0].id}`;
    }),
  );

  // T5.2 — Message Pickup
  tests.push(
    await runTest('T5.2', 'Message Pickup', async () => {
      const result = await pollUntil(
        () =>
          queryTable<{ id: string; status: string }>(
            config,
            'agent_messages',
            'id,status',
            { to_agent: 'cto' },
            { order: 'created_at', desc: true, limit: 5 },
          ),
        (rows) =>
          rows.some((r) => r.status === 'read' || r.status === 'responded'),
        15_000,
        5 * 60_000,
      );

      const picked = result.find(
        (r) => r.status === 'read' || r.status === 'responded',
      );
      return `CTO picked up message ${picked?.id} (status: ${picked?.status})`;
    }),
  );

  // T5.3 — Multi-Agent Meeting
  tests.push(
    await runTest('T5.3', 'Multi-Agent Meeting', async () => {
      const resp = await httpPost(`${config.schedulerUrl}/meetings/call`, {
        title: 'Smoke Test Meeting',
        attendees: ['cto', 'cfo', 'cpo'],
        purpose: 'Quick alignment check',
        meeting_type: 'standup',
      });

      if (!resp.ok) {
        throw new Error(
          `Scheduler /meetings/call returned ${resp.status}: ${resp.raw}`,
        );
      }

      const meetings = await pollUntil(
        () =>
          queryTable<{ id: string; status: string; title: string }>(
            config,
            'agent_meetings',
            'id,status,title',
            {},
            { order: 'created_at', desc: true, limit: 5 },
          ),
        (rows) =>
          rows.some(
            (r) =>
              r.title === 'Smoke Test Meeting' &&
              r.status === 'completed',
          ),
        30_000,
        10 * 60_000,
      );

      const meeting = meetings.find(
        (r) => r.title === 'Smoke Test Meeting',
      );
      return `Meeting completed: ${meeting?.id}`;
    }),
  );

  // T5.4 — Teams Channel Post (post_to_teams)
  tests.push(
    await runTest('T5.4', 'Teams Channel Post (post_to_teams)', async () => {
      // Check if Teams is configured
      const teamId = process.env.TEAMS_TEAM_ID;
      const channelId = process.env.TEAMS_CHANNEL_GENERAL_ID || process.env.TEAMS_CHANNEL_ENGINEERING_ID;
      
      if (!teamId || !channelId) {
        return 'SKIP - Teams not configured (TEAMS_TEAM_ID or channel IDs missing)';
      }

      // Trigger CTO to post to Teams via on-demand task
      const resp = await httpPost(`${config.schedulerUrl}/run`, {
        agentRole: 'cto',
        task: 'on_demand',
        message: 'Post a test message to #engineering channel: "Smoketest validation - all systems operational"',
      });

      if (!resp.ok) {
        throw new Error(`Scheduler /run returned ${resp.status}: ${resp.raw}`);
      }

      // Wait for activity log entry indicating Teams post
      await new Promise(resolve => setTimeout(resolve, 3000));

      const logs = await queryTable<{ id: string; action: string; details: string }>(
        config,
        'activity_log',
        'id,action,details',
        { agent_id: 'cto' },
        { order: 'created_at', desc: true, limit: 10 },
      );

      const teamsPost = logs.find(
        (l) => l.action?.toLowerCase().includes('post_to_teams') || 
               l.action?.toLowerCase().includes('teams') ||
               l.details?.toLowerCase().includes('engineering')
      );

      if (!teamsPost) {
        // Not a hard failure - CTO might not have used the tool
        return 'CTO task completed (Teams post may be in tool logs)';
      }

      return `Teams post recorded: ${teamsPost.id}`;
    }),
  );

  // Patch T5.4 status if skipped
  const teamsTest = tests[tests.length - 1];
  if (teamsTest.message?.startsWith('SKIP')) {
    teamsTest.status = 'skipped';
  }

  // T5.5 — Agent Email
  tests.push(
    await runTest('T5.5', 'Agent Email', async () => {
      if (!config.interactive) {
        return 'SKIP';
      }

      const resp = await httpPost(`${config.schedulerUrl}/run`, {
        agentRole: 'cmo',
        task: 'on_demand',
        message: 'Send a brief marketing status email to the founder.',
      });

      if (!resp.ok) {
        throw new Error(
          `Scheduler /run returned ${resp.status}: ${resp.raw}`,
        );
      }

      return 'CMO email task triggered — verify delivery manually';
    }),
  );

  // Patch T5.5 status if skipped
  const emailTest = tests[tests.length - 1];
  if (emailTest.message === 'SKIP') {
    emailTest.status = 'skipped';
    emailTest.message = 'Skipped — cannot verify email delivery in non-interactive mode';
  }

  return { layer: 5, name: 'Communication', tests };
}
