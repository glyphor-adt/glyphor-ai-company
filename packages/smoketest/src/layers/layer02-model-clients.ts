/**
 * Layer 2 – Model Clients
 * Exercises each LLM provider via the scheduler's /run endpoint.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpPost } from '../utils/http.js';

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

  // T2.1 — Gemini
  tests.push(
    await runTest('T2.1', 'Gemini (ops agent)', async () => {
      const res = await httpPost(
        `${config.schedulerUrl}/run`,
        {
          agentRole: 'ops',
          task: 'on_demand',
          message: 'Say hello and confirm your model.',
        },
        60_000,
      );
      if (!res.ok) {
        throw new Error(`Gemini run failed: status=${res.status}, body=${res.raw}`);
      }
      return `Gemini responded (${res.status})`;
    }),
  );

  // T2.2 — OpenAI
  tests.push(
    await runTest('T2.2', 'OpenAI (cto agent)', async () => {
      const res = await httpPost(
        `${config.schedulerUrl}/run`,
        {
          agentRole: 'cto',
          task: 'on_demand',
          message: 'Just say hello, do not use any tools.',
        },
        60_000,
      );
      if (!res.ok) {
        throw new Error(`OpenAI run failed: status=${res.status}, body=${res.raw}`);
      }
      return `OpenAI responded (${res.status})`;
    }),
  );

  // T2.3 — Anthropic
  tests.push(
    await runTest('T2.3', 'Anthropic (clo agent)', async () => {
      const res = await httpPost(
        `${config.schedulerUrl}/run`,
        {
          agentRole: 'clo',
          task: 'on_demand',
          message: 'Say hello briefly.',
        },
        60_000,
      );
      if (!res.ok) {
        throw new Error(`Anthropic run failed: status=${res.status}, body=${res.raw}`);
      }
      return `Anthropic responded (${res.status})`;
    }),
  );

  // T2.4 — Multi-Tool Turn (regression for duplicate tool_call_id bug)
  tests.push(
    await runTest('T2.4', 'Multi-Tool Turn (regression)', async () => {
      const res = await httpPost(
        `${config.schedulerUrl}/run`,
        {
          agentRole: 'cto',
          task: 'on_demand',
          message:
            'Give me a full platform health check — check all services, all repos, all CI pipelines.',
        },
        120_000,
      );

      const rawLower = (res.raw ?? '').toLowerCase();
      if (rawLower.includes('duplicate value for tool_call_id')) {
        throw new Error(
          'Known bug: Duplicate value for tool_call_id detected in multi-tool turn',
        );
      }

      if (!res.ok) {
        throw new Error(`Multi-tool run failed: status=${res.status}, body=${res.raw}`);
      }
      return `Multi-tool turn completed without duplicate tool_call_id (${res.status})`;
    }),
  );

  return { layer: 2, name: 'Model Clients', tests };
}
