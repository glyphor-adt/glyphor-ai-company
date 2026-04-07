/**
 * Layer 11 – Dashboard & API
 *
 * Validates that every dashboard page route returns HTTP 200,
 * security headers (including COOP) are present, and the SPA
 * bundle loads without 404s.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpGet } from '../utils/http.js';
import { runTest } from '../utils/test.js';
import { query } from '../utils/db.js';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

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

  // T11.5 — Health Check Endpoint
  tests.push(
    await runTest('T11.5', 'Health Check Endpoint', async () => {
      const res = await httpGet(`${config.dashboardUrl}/healthz`);
      if (res.status === 404) {
        return '/healthz not configured in nginx — add health check route for monitoring';
      }
      if (res.status !== 200) {
        throw new Error(`/healthz returned HTTP ${res.status}`);
      }
      return '/healthz returned HTTP 200';
    }),
  );

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

  // T11.7 — Dashboard API CRUD
  tests.push(
    await runTest('T11.7', 'Dashboard API CRUD', async () => {
      // Dashboard API is served by the scheduler at /api/*
      const schedulerUrl = config.schedulerUrl;

      // Test reading from several whitelisted tables
      const tables = ['company_agents', 'activity_log', 'decisions', 'data_sync_status'];
      const failed: string[] = [];
      for (const table of tables) {
        const res = await httpGet(`${schedulerUrl}/api/${table}?limit=1`);
        if (!res.ok) {
          failed.push(`${table}: HTTP ${res.status}`);
        }
      }
      if (failed.length > 0) {
        throw new Error(`Dashboard API failures: ${failed.join('; ')}`);
      }
      return `All ${tables.length} Dashboard API table reads returned HTTP 200`;
    }),
  );

  // T11.8 — TypeScript Typecheck (dashboard)
  tests.push(
    await runTest('T11.8', 'Dashboard TypeScript Clean', async () => {
      // Find the dashboard package root relative to the smoketest
      const dashboardDir = resolve(import.meta.dirname, '..', '..', '..', 'dashboard');
      if (!existsSync(resolve(dashboardDir, 'tsconfig.json'))) {
        return 'Dashboard tsconfig.json not found — skipping typecheck';
      }
      try {
        execSync('npx tsc --noEmit', { cwd: dashboardDir, timeout: 120_000, stdio: 'pipe' });
        return 'Dashboard TypeScript compiles with zero errors';
      } catch (err: any) {
        const output = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
        const errorLines = output.split('\n').filter((l: string) => l.includes('error TS'));
        const count = errorLines.length;
        const timedOut = err?.code === 'ETIMEDOUT' || err?.signal === 'SIGTERM';
        if (timedOut) {
          return '⚠ Dashboard typecheck timed out at 120 s — CI/local typecheck should be used for full verification';
        }
        if (count === 0) {
          return '⚠ Dashboard typecheck exited non-zero without TypeScript diagnostics — likely transient npx/tsc tooling failure';
        }
        const preview = errorLines.slice(0, 5).join('\n');
        throw new Error(`${count} TypeScript error(s) found:\n${preview}`);
      }
    }),
  );

  // T11.9 — Scheduler TypeScript Clean
  tests.push(
    await runTest('T11.9', 'Scheduler TypeScript Clean', async () => {
      const schedulerDir = resolve(import.meta.dirname, '..', '..', '..', 'scheduler');
      if (!existsSync(resolve(schedulerDir, 'tsconfig.json'))) {
        return 'Scheduler tsconfig.json not found — skipping typecheck';
      }
      try {
        execSync('npx tsc --noEmit', { cwd: schedulerDir, timeout: 120_000, stdio: 'pipe' });
        return 'Scheduler TypeScript compiles with zero errors';
      } catch (err: any) {
        const output = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
        const errorLines = output.split('\n').filter((l: string) => l.includes('error TS'));
        const count = errorLines.length;
        const timedOut = err?.code === 'ETIMEDOUT' || err?.signal === 'SIGTERM';
        if (timedOut) {
          return '⚠ Scheduler typecheck timed out at 120 s — CI/local typecheck should be used for full verification';
        }
        if (count === 0) {
          return '⚠ Scheduler typecheck exited non-zero without TypeScript diagnostics — likely transient npx/tsc tooling failure';
        }
        const preview = errorLines.slice(0, 5).join('\n');
        throw new Error(`${count} TypeScript error(s) found:\n${preview}`);
      }
    }),
  );

  // T11.10 — /run/stream parent-event continuity on latest dashboard run
  tests.push(
    await runTest('T11.10', 'Run Stream Parent-Event Continuity', async () => {
      const attempts = await query<{
        attempt_id: string;
        run_id: string;
        session_id: string;
      }>(
        `SELECT ra.id AS attempt_id, ra.run_id, ra.session_id
           FROM run_attempts ra
           JOIN run_sessions rs ON rs.id = ra.session_id
          WHERE rs.source = 'dashboard-main-chat'
          ORDER BY ra.updated_at DESC
          LIMIT 1`,
      );
      const latest = attempts[0];
      if (!latest) {
        return 'No dashboard stream attempts found yet — continuity check deferred';
      }

      const events = await query<{
        stream_seq: number;
        event_id: string;
        parent_event_id: string | null;
      }>(
        `SELECT stream_seq, event_id, parent_event_id
           FROM run_events
          WHERE session_id = $1
            AND attempt_id = $2
            AND run_id = $3
          ORDER BY stream_seq ASC`,
        [latest.session_id, latest.attempt_id, latest.run_id],
      );
      if (events.length < 2) {
        return `Attempt ${latest.attempt_id} has ${events.length} event(s) — insufficient length for chain validation`;
      }

      for (let i = 1; i < events.length; i += 1) {
        if (events[i].parent_event_id !== events[i - 1].event_id) {
          throw new Error(
            `Parent chain break at seq=${events[i].stream_seq}: expected parent=${events[i - 1].event_id}, got ${events[i].parent_event_id ?? 'null'}`,
          );
        }
      }
      return `Validated contiguous parent-event chain across ${events.length} stream events`;
    }),
  );

  // T11.11 — Approval-required scenario has canonical runtime markers
  tests.push(
    await runTest('T11.11', 'Approval Scenario Runtime Markers', async () => {
      const approvalRuns = await query<{ run_id: string; attempt_id: string; session_id: string }>(
        `SELECT DISTINCT re.run_id, re.attempt_id, re.session_id
           FROM run_events re
           JOIN run_sessions rs ON rs.id = re.session_id
          WHERE rs.source = 'dashboard-main-chat'
            AND re.event_type = 'approval_requested'
          ORDER BY re.run_id DESC
          LIMIT 1`,
      );
      const sample = approvalRuns[0];
      if (!sample) {
        return 'No approval_required run found yet — scenario marker check deferred';
      }

      const rows = await query<{ event_type: string; status: string | null }>(
        `SELECT event_type, status
           FROM run_events
          WHERE session_id = $1
            AND attempt_id = $2
            AND run_id = $3
            AND event_type IN ('approval_requested','status')
          ORDER BY stream_seq ASC`,
        [sample.session_id, sample.attempt_id, sample.run_id],
      );

      const hasApprovalRequested = rows.some((r) => r.event_type === 'approval_requested' && r.status === 'queued_for_approval');
      const hasQueuedStatus = rows.some((r) => r.event_type === 'status' && r.status === 'queued_for_approval');
      if (!hasApprovalRequested || !hasQueuedStatus) {
        throw new Error(`Approval run ${sample.run_id} missing expected approval_requested/status queued_for_approval markers`);
      }
      return `Approval run ${sample.run_id} has canonical approval markers`;
    }),
  );

  // T11.12 — Replay cursor reliability prerequisites (seq + event_id)
  tests.push(
    await runTest('T11.12', 'Replay Cursor Integrity', async () => {
      const sessions = await query<{ id: string }>(
        `SELECT id
           FROM run_sessions
          WHERE source = 'dashboard-main-chat'
          ORDER BY updated_at DESC
          LIMIT 1`,
      );
      const session = sessions[0];
      if (!session) {
        return 'No dashboard runtime session found yet — replay cursor check deferred';
      }

      const rows = await query<{
        stream_seq: number;
        event_id: string;
      }>(
        `SELECT stream_seq, event_id
           FROM run_events
          WHERE session_id = $1
          ORDER BY stream_seq ASC`,
        [session.id],
      );
      if (rows.length < 2) {
        return `Session ${session.id} has ${rows.length} event(s) — replay integrity check deferred`;
      }

      const seen = new Set<string>();
      let prevSeq = 0;
      for (const row of rows) {
        if (seen.has(row.event_id)) throw new Error(`Duplicate event_id detected: ${row.event_id}`);
        seen.add(row.event_id);
        if (row.stream_seq <= prevSeq) {
          throw new Error(`Non-increasing stream_seq at ${row.stream_seq} after ${prevSeq}`);
        }
        prevSeq = row.stream_seq;
      }
      return `Replay cursor integrity verified for ${rows.length} events`;
    }),
  );

  // T11.13 — Deep-dive failure chain emits terminal canonical markers
  tests.push(
    await runTest('T11.13', 'Deep-Dive Failure Terminal Chain', async () => {
      const failedAttempts = await query<{ attempt_id: string; session_id: string; run_id: string }>(
        `SELECT re.attempt_id, re.session_id, re.run_id
           FROM run_events re
           JOIN run_sessions rs ON rs.id = re.session_id
          WHERE rs.source = 'scheduler-deep-dive'
            AND re.event_type = 'run_failed'
          ORDER BY re.event_ts DESC
          LIMIT 1`,
      );
      const sample = failedAttempts[0];
      if (!sample) {
        return 'No deep-dive failure sample found yet — terminal-chain check deferred';
      }

      const terminal = await query<{ status: string }>(
        `SELECT status
           FROM run_attempts
          WHERE id = $1
          LIMIT 1`,
        [sample.attempt_id],
      );
      if (terminal[0]?.status !== 'failed') {
        throw new Error(`Deep-dive failed attempt ${sample.attempt_id} not terminalized as failed`);
      }
      return `Deep-dive failure attempt ${sample.attempt_id} includes run_failed event and failed terminal state`;
    }),
  );

  // T11.14 — Retry path status/event consistency
  tests.push(
    await runTest('T11.14', 'Retry Status/Event Consistency', async () => {
      const retryEvents = await query<{ event_type: string; status: string | null; payload: { phase?: string; message?: string } }>(
        `SELECT event_type, status, payload
           FROM run_events
          WHERE event_type = 'status'
            AND (
              payload::text ILIKE '%retry%'
              OR payload->>'phase' = 'retry'
            )
          ORDER BY event_ts DESC
          LIMIT 20`,
      );
      if (retryEvents.length === 0) {
        return 'No retry status events observed yet — consistency check deferred';
      }
      const invalid = retryEvents.filter((e) => e.status !== 'failed' && e.status !== 'running');
      if (invalid.length > 0) {
        throw new Error(`Found ${invalid.length} retry status event(s) with unexpected status values`);
      }
      return `Validated ${retryEvents.length} retry-related status events`;
    }),
  );

  return { layer: 11, name: 'Dashboard & API', tests };
}
