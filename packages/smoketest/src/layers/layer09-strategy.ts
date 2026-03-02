/**
 * Layer 9 — Strategy & Analysis Engines
 *
 * Validates strategic analysis, T+1 simulation, chain-of-thought reasoning,
 * and deep-dive analysis via the scheduler API.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpGet, httpPost, pollUntil } from '../utils/http.js';
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

async function pollStatus(
  url: string,
  intervalMs: number,
  maxWaitMs: number,
): Promise<RunResponse> {
  const result = await pollUntil<HttpResponse<unknown>>(
    () => httpGet(url),
    resp => {
      const body = resp.data as RunResponse;
      return body?.status === 'completed' || body?.status === 'failed';
    },
    intervalMs,
    maxWaitMs,
  );
  const body = result.data as RunResponse;
  if (body?.status === 'failed') {
    throw new Error(`Run failed: ${JSON.stringify(body)}`);
  }
  return body;
}

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];
  const sched = config.schedulerUrl;

  // T9.1 — Strategic Analysis
  tests.push(
    await runTest('T9.1', 'Strategic Analysis', async () => {
      const resp = await httpPost(`${sched}/analysis/run`, {
        type: 'competitive_landscape',
        query: 'AI agent platforms market',
        depth: 'quick',
      });
      if (!resp.ok) throw new Error(`POST /analysis/run returned ${resp.status}: ${resp.raw}`);

      const id = extractId(resp);
      const result = await pollStatus(`${sched}/analysis/${id}`, 30_000, 600_000);
      return `Analysis ${id} completed (status: ${result.status})`;
    }),
  );

  // T9.2 — T+1 Simulation
  tests.push(
    await runTest('T9.2', 'T+1 Simulation', async () => {
      const resp = await httpPost(`${sched}/simulation/run`, {
        action: 'Increase marketing budget by 50%',
        perspective: 'neutral',
      });
      if (!resp.ok) throw new Error(`POST /simulation/run returned ${resp.status}: ${resp.raw}`);

      const id = extractId(resp);
      const result = await pollStatus(`${sched}/simulation/${id}`, 30_000, 600_000);
      return `Simulation ${id} completed (status: ${result.status})`;
    }),
  );

  // T9.3 — Chain of Thought
  tests.push(
    await runTest('T9.3', 'Chain of Thought', async () => {
      const resp = await httpPost(`${sched}/cot/run`, {
        query: 'Should we prioritize enterprise sales or self-serve growth?',
      });
      if (!resp.ok) throw new Error(`POST /cot/run returned ${resp.status}: ${resp.raw}`);

      const id = extractId(resp);
      const result = await pollStatus(`${sched}/cot/${id}`, 30_000, 300_000);
      return `CoT ${id} completed (status: ${result.status})`;
    }),
  );

  // T9.4 — Deep Dive
  tests.push(
    await runTest('T9.4', 'Deep Dive', async () => {
      const resp = await httpPost(`${sched}/deep-dive/run`, {
        target: 'Glyphor competitive positioning',
        context: 'AI agent platform market 2026',
      });
      if (!resp.ok) throw new Error(`POST /deep-dive/run returned ${resp.status}: ${resp.raw}`);

      const id = extractId(resp);
      const result = await pollStatus(`${sched}/deep-dive/${id}`, 30_000, 600_000);
      return `Deep dive ${id} completed (status: ${result.status})`;
    }),
  );

  return { layer: 9, name: 'Strategy & Analysis Engines', tests };
}
