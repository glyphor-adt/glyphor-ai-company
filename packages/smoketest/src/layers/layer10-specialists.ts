/**
 * Layer 10 – Specialist Agents
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpPost } from '../utils/http.js';
import { query } from '../utils/db.js';
import { runTest } from '../utils/test.js';

const SPECIALISTS = [
  'enterprise-account-researcher',
  'bob-the-tax-pro',
  'data-integrity-auditor',
  'tax-strategy-specialist',
  'lead-gen-specialist',
  'marketing-intelligence-analyst',
  'adi-rose',
] as const;

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // T10.1 — Dynamic Runner Works
  tests.push(
    await runTest('T10.1', 'Dynamic Runner Works', async () => {
      const res = await httpPost(
        `${config.schedulerUrl}/run`,
        {
          agentRole: 'adi-rose',
          task: 'on_demand',
          message: 'Hello, please confirm you are working and tell me your role.',
        },
        60_000,
      );
      if (!res.ok) throw new Error(`Scheduler /run returned HTTP ${res.status}`);
      if (!res.raw || res.raw.trim().length === 0) {
        throw new Error('Scheduler /run returned empty response');
      }
      return `Response received (${res.raw.length} chars)`;
    }),
  );

  // T10.2 — All Specialists Have Briefs
  tests.push(
    await runTest('T10.2', 'All Specialists Have Briefs', async () => {
      const specialistList = SPECIALISTS.map((_, i) => `$${i + 1}`).join(', ');
      const agents = await query<{ role: string }>(
        `SELECT role FROM company_agents WHERE role IN (${specialistList})`,
        [...SPECIALISTS],
      );
      const briefs = await query<{ agent_id: string }>(
        `SELECT agent_id FROM agent_briefs WHERE agent_id IN (${specialistList})`,
        [...SPECIALISTS],
      );
      const profiles = await query<{ agent_id: string }>(
        `SELECT agent_id FROM agent_profiles WHERE agent_id IN (${specialistList})`,
        [...SPECIALISTS],
      );

      const missing: string[] = [];
      for (const role of SPECIALISTS) {
        if (!agents.some((a) => a.role === role)) missing.push(`${role} missing from company_agents`);
        if (!briefs.some((b) => b.agent_id === role)) missing.push(`${role} missing from agent_briefs`);
        if (!profiles.some((p) => p.agent_id === role)) missing.push(`${role} missing from agent_profiles`);
      }
      if (missing.length > 0) throw new Error(missing.join('; '));
      return `All ${SPECIALISTS.length} specialists found in company_agents, agent_briefs, and agent_profiles`;
    }),
  );

  // T10.3 — Specialists in Authority Gates
  tests.push(
    await runTest('T10.3', 'Specialists in Authority Gates', async () => {
      const specialistList = SPECIALISTS.map((_, i) => `$${i + 1}`).join(', ');
      const grants = await query<{ agent_role: string }>(
        `SELECT agent_role FROM agent_tool_grants WHERE agent_role IN (${specialistList}) AND is_active = true`,
        [...SPECIALISTS],
      );

      const withGrants = new Set(grants.map((g) => g.agent_role));
      const missing = SPECIALISTS.filter((s) => !withGrants.has(s));
      if (missing.length === SPECIALISTS.length) {
        return 'No specialists have active tool grants yet — run authority gate setup';
      }
      if (missing.length > 0) {
        return `${withGrants.size}/${SPECIALISTS.length} specialists have grants (missing: ${missing.join(', ')})`;
      }
      return `All ${SPECIALISTS.length} specialists have active tool grants`;
    }),
  );

  return { layer: 10, name: 'Specialist Agents', tests };
}
