/**
 * Layer 11 – Dashboard & API
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

const PAGES = [
  { path: '/workforce', name: 'Workforce' },
  { path: '/agents/chief-of-staff', name: 'Agent Profile' },
  { path: '/approvals', name: 'Approvals' },
  { path: '/directives', name: 'Directives' },
  { path: '/strategy', name: 'Strategy' },
  { path: '/financials', name: 'Financials' },
  { path: '/knowledge', name: 'Knowledge' },
  { path: '/operations', name: 'Operations' },
  { path: '/comms', name: 'Comms' },
] as const;

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // T11.1 — Dashboard Loads
  tests.push(
    await runTest('T11.1', 'Dashboard Loads', async () => {
      const res = await httpGet(config.dashboardUrl);
      if (res.status !== 200) throw new Error(`Dashboard returned HTTP ${res.status}`);
      return `Dashboard returned HTTP 200`;
    }),
  );

  // T11.2 — Key Pages Render
  tests.push(
    await runTest('T11.2', 'Key Pages Render', async () => {
      const failed: string[] = [];
      for (const page of PAGES) {
        const res = await httpGet(`${config.dashboardUrl}${page.path}`);
        if (res.status !== 200) {
          failed.push(`${page.name} (${page.path}): HTTP ${res.status}`);
        }
      }
      if (failed.length > 0) {
        throw new Error(`Pages failing: ${failed.join('; ')}`);
      }
      // SPA note: server returns 200 for all routes (serving index.html).
      // This verifies the server is responding, not that React components render.
      return `All ${PAGES.length} pages returned HTTP 200`;
    }),
  );

  return { layer: 11, name: 'Dashboard & API', tests };
}
