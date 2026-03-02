/**
 * Layer 11 – Dashboard & API
 *
 * Validates that every dashboard page route returns HTTP 200,
 * security headers (including COOP) are present, and the SPA
 * bundle loads without 404s.
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

/** Every routable page in the dashboard SPA. */
const PAGES = [
  { path: '/', name: 'Dashboard (Home)' },
  { path: '/directives', name: 'Directives' },
  { path: '/workforce', name: 'Workforce' },
  { path: '/agents/new', name: 'Agent Builder' },
  { path: '/builder', name: 'Workforce Builder' },
  { path: '/agents/chief-of-staff', name: 'Agent Profile' },
  { path: '/agents/chief-of-staff/settings', name: 'Agent Settings' },
  { path: '/approvals', name: 'Approvals' },
  { path: '/financials', name: 'Financials' },
  { path: '/operations', name: 'Operations' },
  { path: '/strategy', name: 'Strategy' },
  { path: '/knowledge', name: 'Knowledge' },
  { path: '/capabilities', name: 'Capabilities' },
  { path: '/skills/research', name: 'Skill Detail' },
  { path: '/comms', name: 'Comms' },
  { path: '/chat/chief-of-staff', name: 'Chat' },
  { path: '/teams-config', name: 'Teams Config' },
  { path: '/governance', name: 'Governance' },
  { path: '/change-requests', name: 'Change Requests' },
  { path: '/settings', name: 'Settings' },
] as const;

/** Required security headers on every response. */
const REQUIRED_HEADERS: Record<string, string | RegExp> = {
  'content-security-policy': /frame-ancestors/,
  'cross-origin-opener-policy': 'same-origin-allow-popups',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // T11.1 — Dashboard Loads
  tests.push(
    await runTest('T11.1', 'Dashboard Loads', async () => {
      const res = await httpGet(config.dashboardUrl);
      if (res.status !== 200) throw new Error(`Dashboard returned HTTP ${res.status}`);
      return 'Dashboard returned HTTP 200';
    }),
  );

  // T11.2 — All Pages Render (SPA routes)
  tests.push(
    await runTest('T11.2', 'All Pages Render', async () => {
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

  // T11.3 — Security Headers Present
  tests.push(
    await runTest('T11.3', 'Security Headers Present', async () => {
      const resp = await fetch(config.dashboardUrl);
      const missing: string[] = [];
      for (const [header, expected] of Object.entries(REQUIRED_HEADERS)) {
        const value = resp.headers.get(header);
        if (!value) {
          missing.push(`${header}: missing`);
        } else if (expected instanceof RegExp) {
          if (!expected.test(value)) missing.push(`${header}: got "${value}", expected match ${expected}`);
        } else if (value !== expected) {
          missing.push(`${header}: got "${value}", expected "${expected}"`);
        }
      }
      if (missing.length > 0) {
        throw new Error(`Header issues: ${missing.join('; ')}`);
      }
      return `All ${Object.keys(REQUIRED_HEADERS).length} security headers verified`;
    }),
  );

  // T11.4 — SPA Bundle Loads (index.html contains JS asset references)
  tests.push(
    await runTest('T11.4', 'SPA Bundle Loads', async () => {
      const res = await httpGet<string>(config.dashboardUrl);
      const html = res.raw;
      if (!html.includes('<script')) {
        throw new Error('index.html has no <script> tags — bundle missing');
      }
      // Extract JS asset paths and verify they load
      const scriptMatches = html.match(/src="(\/assets\/[^"]+\.js)"/g) ?? [];
      if (scriptMatches.length === 0) {
        throw new Error('No /assets/*.js references found in index.html');
      }
      const failed: string[] = [];
      for (const match of scriptMatches) {
        const path = match.replace(/^src="/, '').replace(/"$/, '');
        const assetRes = await httpGet(`${config.dashboardUrl}${path}`);
        if (assetRes.status !== 200) {
          failed.push(`${path}: HTTP ${assetRes.status}`);
        }
      }
      if (failed.length > 0) {
        throw new Error(`Asset load failures: ${failed.join('; ')}`);
      }
      return `${scriptMatches.length} JS bundle(s) loaded successfully`;
    }),
  );

  // T11.5 — Health Check Endpoint (skipped if not yet deployed)
  {
    const start = Date.now();
    try {
      const res = await httpGet(`${config.dashboardUrl}/healthz`);
      if (res.status === 404) {
        tests.push({ id: 'T11.5', name: 'Health Check Endpoint', status: 'skipped', message: '/healthz not deployed yet', durationMs: Date.now() - start });
      } else if (res.status !== 200) {
        tests.push({ id: 'T11.5', name: 'Health Check Endpoint', status: 'fail', message: `/healthz returned HTTP ${res.status}`, durationMs: Date.now() - start });
      } else {
        tests.push({ id: 'T11.5', name: 'Health Check Endpoint', status: 'pass', message: '/healthz returned HTTP 200', durationMs: Date.now() - start });
      }
    } catch (err) {
      tests.push({ id: 'T11.5', name: 'Health Check Endpoint', status: 'fail', message: (err as Error).message, durationMs: Date.now() - start });
    }
  }

  // T11.6 — Legacy Redirects Resolve
  tests.push(
    await runTest('T11.6', 'Legacy Redirects Resolve', async () => {
      const legacyPaths = ['/agents', '/chat', '/activity', '/graph', '/skills', '/meetings', '/world-model', '/group-chat'];
      const failed: string[] = [];
      for (const path of legacyPaths) {
        const res = await httpGet(`${config.dashboardUrl}${path}`);
        if (res.status !== 200) {
          failed.push(`${path}: HTTP ${res.status}`);
        }
      }
      if (failed.length > 0) {
        throw new Error(`Legacy redirects failing: ${failed.join('; ')}`);
      }
      return `All ${legacyPaths.length} legacy redirects returned HTTP 200`;
    }),
  );

  return { layer: 11, name: 'Dashboard & API', tests };
}
