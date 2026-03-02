/**
 * Layer 12 – Voice Gateway
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpGet } from '../utils/http.js';
import { runTest } from '../utils/test.js';

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

  // T12.2 — Voice Session Endpoint
  tests.push(
    await runTest('T12.2', 'Voice Session Endpoint', async () => {
      // Verify the session endpoint exists and responds (without starting a full WebRTC session)
      const res = await httpGet(`${config.voiceGatewayUrl}/session`);
      // 400/405 = endpoint exists but needs proper request params; 200 = ready
      if (res.status === 404) {
        throw new Error('Voice /session endpoint not found — voice session route not deployed');
      }
      return `Voice session endpoint reachable (HTTP ${res.status})`;
    }),
  );

  return { layer: 12, name: 'Voice Gateway', tests };
}
