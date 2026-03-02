/**
 * Layer 9 — Strategy & Analysis Engines
 *
 * Validates strategic analysis, T+1 simulation, chain-of-thought reasoning,
 * and deep-dive analysis via the scheduler API.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpPost } from '../utils/http.js';
import type { HttpResponse } from '../utils/http.js';
import { runTest } from '../utils/test.js';

interface RunResponse {
  id?: string;
  runId?: string;
  status?: string;
  [key: string]: unknown;
}

function extractId(resp: HttpResponse<unknown>): string {
  const body = resp.data as RunResponse;
  const id = body?.id ?? body?.runId;
  if (!id) throw new Error(`No id in response: ${resp.raw}`);
  return id;
}

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];
  const sched = config.schedulerUrl;

  // Fire-and-forget: only verify the POST succeeds, don't poll for completion.
  // Full poll-to-completion is too slow for smoke testing (engines can take 10+ min).

  // T9.1 — Strategic Analysis
  tests.push(
    await runTest('T9.1', 'Strategic Analysis', async () => {
      const resp = await httpPost(`${sched}/analysis/run`, {
        type: 'competitive_landscape',
        query: 'AI agent platforms market',
        depth: 'quick',
      });
      if (!resp.ok) {
        throw new Error(`POST /analysis/run returned ${resp.status}: ${resp.raw}`);
      }
      const id = extractId(resp);
      return `Analysis ${id} accepted (status: ${(resp.data as RunResponse)?.status ?? 'started'})`;
    }),
  );

  // T9.2 — T+1 Simulation
  tests.push(
    await runTest('T9.2', 'T+1 Simulation', async () => {
      const resp = await httpPost(`${sched}/simulation/run`, {
        action: 'Increase marketing budget by 50%',
        perspective: 'neutral',
      });
      if (!resp.ok) {
        throw new Error(`POST /simulation/run returned ${resp.status}: ${resp.raw}`);
      }
      const id = extractId(resp);
      return `Simulation ${id} accepted (status: ${(resp.data as RunResponse)?.status ?? 'started'})`;
    }),
  );

  // T9.3 — Chain of Thought
  tests.push(
    await runTest('T9.3', 'Chain of Thought', async () => {
      const resp = await httpPost(`${sched}/cot/run`, {
        query: 'Should we prioritize enterprise sales or self-serve growth?',
      });
      if (!resp.ok) {
        throw new Error(`POST /cot/run returned ${resp.status}: ${resp.raw}`);
      }
      const id = extractId(resp);
      return `CoT ${id} accepted (status: ${(resp.data as RunResponse)?.status ?? 'started'})`;
    }),
  );

  // T9.4 — Deep Dive
  tests.push(
    await runTest('T9.4', 'Deep Dive', async () => {
      const resp = await httpPost(`${sched}/deep-dive/run`, {
        target: 'Glyphor competitive positioning',
        context: 'AI agent platform market 2026',
      });
      if (!resp.ok) {
        throw new Error(`POST /deep-dive/run returned ${resp.status}: ${resp.raw}`);
      }
      const id = extractId(resp);
      return `Deep dive ${id} accepted (status: ${(resp.data as RunResponse)?.status ?? 'started'})`;
    }),
  );

  // T9.5 — Strategy Lab
  tests.push(
    await runTest('T9.5', 'Strategy Lab', async () => {
      const resp = await httpPost(`${sched}/strategy-lab/run`, {
        query: 'Evaluate Glyphor ADT go-to-market strategy for enterprise segment',
        depth: 'quick',
      });
      if (!resp.ok) {
        throw new Error(`POST /strategy-lab/run returned ${resp.status}: ${resp.raw}`);
      }
      const id = extractId(resp);
      return `Strategy lab ${id} accepted (status: ${(resp.data as RunResponse)?.status ?? 'started'})`;
    }),
  );

  return { layer: 9, name: 'Strategy & Analysis Engines', tests };
}
