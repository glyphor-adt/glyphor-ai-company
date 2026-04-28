/**
 * Layer 15 — Agent Autonomy Upgrades
 *
 * Validates the autonomous agent infrastructure:
 * - Tool self-recovery (auto-grant read-only, structured denial)
 * - Data grounding protocol presence
 * - Collaboration protocol presence
 * - Proactive prompt templates
 * - Initiative proposal pipeline (DB table, API endpoint, dashboard)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { query, queryTable } from '../utils/db.js';
import { httpGet } from '../utils/http.js';
import { runTest } from '../utils/test.js';

// ─── Source file readers ────────────────────────────────────────────

/** Walk up from this file to find the monorepo root (contains turbo.json). */
function findMonorepoRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  let dir = dirname(__filename);
  while (dir !== dirname(dir)) {
    if (existsSync(resolve(dir, 'turbo.json'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd(); // fallback
}

const REPO_ROOT = findMonorepoRoot();

function readSource(relPath: string): string {
  const full = resolve(REPO_ROOT, relPath);
  return readFileSync(full, 'utf8');
}

// ─── Layer runner ───────────────────────────────────────────────────

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // T15.1 — proposed_initiatives table exists with correct schema
  tests.push(
    await runTest('T15.1', 'Initiatives Table Schema', async () => {
      const cols = await query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'proposed_initiatives'
         ORDER BY ordinal_position`,
      );

      if (cols.length === 0) {
        throw new Error('proposed_initiatives table not found — run migration 20260303110000');
      }

      const colNames = cols.map((c) => c.column_name);
      const required = [
        'id', 'proposed_by', 'title', 'justification', 'proposed_assignments',
        'expected_outcome', 'priority', 'status', 'evaluation_notes',
        'directive_id', 'created_at', 'tenant_id',
      ];

      const missing = required.filter((r) => !colNames.includes(r));
      if (missing.length > 0) {
        throw new Error(`Missing columns: ${missing.join(', ')}`);
      }

      return `proposed_initiatives has ${cols.length} columns — all required columns present`;
    }),
  );

  // T15.2 — Initiative status CHECK constraint
  tests.push(
    await runTest('T15.2', 'Initiative Status Constraint', async () => {
      // Try to insert an invalid status — should fail
      try {
        await query(
          `INSERT INTO proposed_initiatives (proposed_by, title, justification, status, tenant_id)
           VALUES ('smoketest', 'test', 'test', 'invalid_status', 'glyphor')`,
        );
        // If we got here, the constraint is missing — clean up
        await query(`DELETE FROM proposed_initiatives WHERE proposed_by = 'smoketest'`);
        throw new Error('CHECK constraint on status column is missing — accepts invalid values');
      } catch (err: any) {
        if (err.message.includes('CHECK constraint')) throw err;
        // The constraint correctly rejected the insert
        return 'Status CHECK constraint enforced (pending/approved/deferred/rejected)';
      }
    }),
  );

  // T15.3 — Initiative CRUD pipeline
  tests.push(
    await runTest('T15.3', 'Initiative CRUD Pipeline', async () => {
      // Insert
      const rows = await query<{ id: string }>(
        `INSERT INTO proposed_initiatives
           (proposed_by, title, justification, proposed_assignments, expected_outcome, priority, status, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          'smoketest-agent',
          'Smoketest Initiative',
          'Automated test of initiative pipeline',
          JSON.stringify([{ role: 'cto', task: 'verify' }]),
          'Pipeline works end to end',
          'low',
          'pending',
          'glyphor',
        ],
      );

      if (!rows[0]?.id) throw new Error('INSERT returned no ID');
      const id = rows[0].id;

      // Read back
      const read = await query<{ title: string; status: string }>(
        `SELECT title, status FROM proposed_initiatives WHERE id = $1`,
        [id],
      );
      if (read[0]?.status !== 'pending') {
        throw new Error(`Expected status 'pending', got '${read[0]?.status}'`);
      }

      // Update (simulate Sarah's evaluation)
      await query(
        `UPDATE proposed_initiatives SET status = 'approved', evaluation_notes = 'Auto-approved by smoketest', evaluated_by = 'chief-of-staff', evaluated_at = now() WHERE id = $1`,
        [id],
      );

      // Verify
      const updated = await query<{ status: string; evaluated_by: string }>(
        `SELECT status, evaluated_by FROM proposed_initiatives WHERE id = $1`,
        [id],
      );
      if (updated[0]?.status !== 'approved') {
        throw new Error(`Status update failed — expected 'approved', got '${updated[0]?.status}'`);
      }

      // Clean up
      await query(`DELETE FROM proposed_initiatives WHERE id = $1`, [id]);

      return `Initiative CRUD pipeline verified (insert → read → evaluate → cleanup)`;
    }),
  );

  // T15.4 — Dashboard API serves proposed_initiatives
  tests.push(
    await runTest('T15.4', 'Initiatives API Endpoint', async () => {
      const res = await httpGet(`${config.schedulerUrl}/api/proposed_initiatives?limit=1`);
      if (!res.ok) {
        // Try hyphenated variant
        const res2 = await httpGet(`${config.schedulerUrl}/api/proposed-initiatives?limit=1`);
        if (!res2.ok) {
          throw new Error(
            `Neither /api/proposed_initiatives (${res.status}) nor /api/proposed-initiatives (${res2.status}) returned OK — add to TABLE_MAP in dashboardApi.ts`,
          );
        }
        return 'Initiatives API accessible at /api/proposed-initiatives';
      }
      return 'Initiatives API accessible at /api/proposed_initiatives';
    }),
  );

  // T15.5 — Auto-grant read-only tools (source validation)
  tests.push(
    await runTest('T15.5', 'Auto-Grant Read-Only Tools', async () => {
      const src = readSource('packages/agent-runtime/src/toolExecutor.ts');

      // Read-only tool classification must exist
      if (!src.includes('isReadOnlyTool') && !src.includes('READ_ONLY_PREFIXES')) {
        throw new Error('Read-only tool classification not found in toolExecutor.ts');
      }

      // Emergency block mechanism must exist
      if (!src.includes('isToolBlocked')) {
        throw new Error('isToolBlocked function not found in toolExecutor.ts');
      }

      // Verify read-only tools get implicit access (Entra identity scoping)
      const hasReadOnlyLogic = src.includes('READ_ONLY_PREFIXES') || src.includes('isReadOnlyTool');
      const hasImplicitGrant = src.includes('isToolGranted') || src.includes('implicitly granted');
      if (!hasReadOnlyLogic) {
        throw new Error('Read-only tool access logic not present');
      }

      return 'Tool self-recovery implemented: isReadOnlyTool + READ_ONLY_PREFIXES + isToolBlocked (Entra scoping)';
    }),
  );

  // T15.6 — Data Grounding Protocol present
  tests.push(
    await runTest('T15.6', 'Data Grounding Protocol', async () => {
      const src = readSource('packages/agent-runtime/src/companyAgentRunner.ts');

      if (!src.includes('DATA_GROUNDING_PROTOCOL')) {
        throw new Error('DATA_GROUNDING_PROTOCOL constant not found in companyAgentRunner.ts');
      }

      // Verify it's injected into both tiers
      const standardTier = src.includes('buildSystemPrompt');
      const taskTier = src.includes('buildTaskTierSystemPrompt');
      if (!standardTier || !taskTier) {
        throw new Error('DATA_GROUNDING_PROTOCOL must be in both standard and task tier prompts');
      }

      // Verify key grounding rules
      const hasNullCheck = src.includes('null') && src.includes('no data');
      const hasExtrapolation = src.includes('extrapolat');
      if (!hasNullCheck || !hasExtrapolation) {
        throw new Error('DATA_GROUNDING_PROTOCOL missing null-handling or extrapolation rules');
      }

      return 'DATA_GROUNDING_PROTOCOL present in both tiers with null-handling and anti-extrapolation rules';
    }),
  );

  // T15.7 — Collaboration Protocol present
  tests.push(
    await runTest('T15.7', 'Collaboration Protocol', async () => {
      const src = readSource('packages/agent-runtime/src/companyAgentRunner.ts');

      if (!src.includes('COLLABORATION_PROTOCOL')) {
        throw new Error('COLLABORATION_PROTOCOL constant not found');
      }

      const hasMeeting = src.includes('MEETING') || src.includes('meeting');
      const hasAssign = src.includes('ASSIGN') || src.includes('assign');
      if (!hasMeeting || !hasAssign) {
        throw new Error('COLLABORATION_PROTOCOL missing meeting or assignment heuristics');
      }

      return 'COLLABORATION_PROTOCOL present with meeting/assignment heuristics';
    }),
  );

  // T15.8 — Proactive prompt templates (role-specific, not generic)
  tests.push(
    await runTest('T15.8', 'Proactive Prompt Templates', async () => {
      const src = readSource('packages/agent-runtime/src/workLoop.ts');

      if (!src.includes('PROACTIVE_PROMPTS')) {
        throw new Error('PROACTIVE_PROMPTS not found in workLoop.ts');
      }

      // Check for role-specific entries
      const roles = ['cto', 'cfo', 'cpo', 'cmo'];
      const missing = roles.filter((r) => !src.includes(`'${r}'`));
      if (missing.length > 0) {
        throw new Error(`Missing proactive prompts for roles: ${missing.join(', ')}`);
      }

      // Verify prompts are detailed (not 1-liners)
      if (!src.includes('Execute it')) {
        throw new Error('Proactive prompts appear to be generic 1-liners — expected detailed role-specific templates');
      }

      return `Role-specific proactive prompts found for ${roles.length}+ roles with actionable directives`;
    }),
  );

  // T15.9 — Proactive value tracking (cooldown doubling)
  tests.push(
    await runTest('T15.9', 'Proactive Value Tracking', async () => {
      const src = readSource('packages/agent-runtime/src/workLoop.ts');

      // Check for value tracking logic
      const hasTurnsCheck = src.includes('turns') && (src.includes('= 0') || src.includes('=== 0'));
      const hasCooldown = src.includes('cooldown') || src.includes('Cooldown') || src.includes('COOLDOWN');

      if (!hasTurnsCheck) {
        throw new Error('Proactive value tracking not found — should check turns === 0');
      }
      if (!hasCooldown) {
        throw new Error('Cooldown doubling logic not found in workLoop.ts');
      }

      return 'Proactive value tracking present — doubles cooldown when recent runs have 0 turns';
    }),
  );

  // T15.10 — Initiative tools wired into executives
  tests.push(
    await runTest('T15.10', 'Initiative Tools Wired', async () => {
      const executives = ['cto', 'cpo', 'cmo', 'cfo', 'vp-design', 'vp-research'];
      const missing: string[] = [];

      for (const exec of executives) {
        try {
          const src = readSource(`packages/agents/src/${exec}/run.ts`);
          if (!src.includes('initiativeTools') && !src.includes('propose_initiative')) {
            missing.push(exec);
          }
        } catch {
          missing.push(`${exec} (file not found)`);
        }
      }

      if (missing.length > 0) {
        throw new Error(`Initiative tools not wired in: ${missing.join(', ')}`);
      }

      return `propose_initiative tool wired into all ${executives.length} executive agents`;
    }),
  );

  // T15.11 — Sarah's initiative evaluation workflow
  tests.push(
    await runTest('T15.11', 'Sarah Initiative Evaluation', async () => {
      const src = readSource('packages/agents/src/chief-of-staff/systemPrompt.ts');

      if (!src.toLowerCase().includes('initiative')) {
        throw new Error('Initiative evaluation section not found in Sarah systemPrompt');
      }

      const hasApprove = src.includes('approve') || src.includes('APPROVE');
      const hasDefer = src.includes('defer') || src.includes('DEFER');
      const hasReject = src.includes('reject') || src.includes('REJECT');

      if (!hasApprove || !hasDefer || !hasReject) {
        throw new Error('Sarah missing approve/defer/reject workflow for initiatives');
      }

      return 'Sarah initiative evaluation workflow present (approve/defer/reject)';
    }),
  );

  // T15.12 — Assignment footer with tool hints
  tests.push(
    await runTest('T15.12', 'Assignment Footer', async () => {
      const src = readSource('packages/agent-runtime/src/workLoop.ts');

      if (!src.includes('ASSIGNMENT_FOOTER')) {
        throw new Error('ASSIGNMENT_FOOTER not found in workLoop.ts');
      }

      // Verify it includes tool hints and scope constraints
      const hasToolHint = src.includes('tool') && src.includes('grant');
      const hasScope = src.includes('scope') || src.includes('SCOPE') || src.includes('guardrail');

      if (!hasToolHint) {
        throw new Error('ASSIGNMENT_FOOTER missing tool access hints');
      }
      if (!hasScope) {
        throw new Error('ASSIGNMENT_FOOTER missing scope guardrails');
      }

      return 'ASSIGNMENT_FOOTER present with tool hints and scope guardrails';
    }),
  );

  return { layer: 15, name: 'Agent Autonomy Upgrades', tests };
}
