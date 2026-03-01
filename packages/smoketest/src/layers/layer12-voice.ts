/**
 * Layer 12 – Voice Gateway
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpGet } from '../utils/http.js';

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

  // T12.1 — Voice Service Health
  tests.push(
    await runTest('T12.1', 'Voice Service Health', async () => {
      const res = await httpGet<Record<string, unknown>>(
        `${config.voiceGatewayUrl}/health`,
      );
      if (!res.ok) throw new Error(`Voice /health returned HTTP ${res.status}`);
      if (typeof res.data !== 'object' || res.data === null) {
        throw new Error('Voice /health did not return valid JSON');
      }
      return `Voice service healthy (HTTP ${res.status})`;
    }),
  );

  // T12.2 — Voice Session (requires interactive/browser)
  const start = Date.now();
  if (!config.interactive) {
    tests.push({
      id: 'T12.2',
      name: 'Voice Session',
      status: 'skipped',
      message: 'Voice session test requires manual browser interaction.',
      durationMs: Date.now() - start,
    });
  } else {
    tests.push(
      await runTest('T12.2', 'Voice Session', async () => {
        // Interactive voice session testing would require WebRTC/browser automation.
        // Placeholder for future implementation with Puppeteer or similar.
        throw new Error('Interactive voice session test not yet implemented');
      }),
    );
  }

  return { layer: 12, name: 'Voice Gateway', tests };
}
