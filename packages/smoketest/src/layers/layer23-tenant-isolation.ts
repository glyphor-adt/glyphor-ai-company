/**
 * Layer 23 — Tenant Isolation & Database Integrity
 *
 * Verifies the Supabase → GCP migration is complete:
 * - All tables with tenant_id have a DEFAULT value set
 * - tenant_id defaults to the Glyphor system tenant UUID
 * - INSERT without explicit tenant_id succeeds
 * - No orphaned rows with NULL tenant_id exist
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { query } from '../utils/db.js';
import { runTest } from '../utils/test.js';

const GLYPHOR_TENANT = '00000000-0000-0000-0000-000000000000';

export async function run(_config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // T23.1 — Glyphor tenant row exists
  tests.push(
    await runTest('T23.1', 'Glyphor tenant exists', async () => {
      const rows = await query<{ id: string; name: string }>(
        `SELECT id, name FROM tenants WHERE id = $1`,
        [GLYPHOR_TENANT],
      );
      if (rows.length === 0) throw new Error('Glyphor tenant row missing from tenants table');
      return `Tenant "${rows[0].name}" present`;
    }),
  );

  // T23.2 — All tenant_id columns have DEFAULT set
  tests.push(
    await runTest('T23.2', 'tenant_id DEFAULT on all tables', async () => {
      const rows = await query<{ table_name: string }>(
        `SELECT c.table_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public'
           AND c.column_name = 'tenant_id'
           AND t.table_type = 'BASE TABLE'
           AND c.column_default IS NULL`,
      );
      if (rows.length > 0) {
        const names = rows.map((r) => r.table_name).join(', ');
        throw new Error(`Tables missing tenant_id DEFAULT: ${names}`);
      }
      return 'All tenant_id columns have DEFAULT set';
    }),
  );

  // T23.3 — DEFAULT value is the Glyphor tenant UUID
  tests.push(
    await runTest('T23.3', 'tenant_id defaults to Glyphor UUID', async () => {
      const rows = await query<{ table_name: string; column_default: string }>(
        `SELECT c.table_name, c.column_default
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public'
           AND c.column_name = 'tenant_id'
           AND t.table_type = 'BASE TABLE'
           AND c.column_default IS NOT NULL`,
      );
      const wrong = rows.filter((r) => !r.column_default.includes(GLYPHOR_TENANT));
      if (wrong.length > 0) {
        const names = wrong.map((r) => `${r.table_name} (${r.column_default})`).join(', ');
        throw new Error(`Wrong DEFAULT: ${names}`);
      }
      return `${rows.length} tables default to Glyphor tenant UUID`;
    }),
  );

  // T23.4 — No NULL tenant_id rows in critical tables
  tests.push(
    await runTest('T23.4', 'No NULL tenant_id rows', async () => {
      const critical = ['agent_runs', 'founder_directives', 'work_assignments', 'activity_log', 'agent_messages'];
      const nullTables: string[] = [];
      for (const table of critical) {
        const rows = await query<{ cnt: string }>(
          `SELECT COUNT(*) as cnt FROM ${table} WHERE tenant_id IS NULL`,
        );
        if (parseInt(rows[0].cnt, 10) > 0) nullTables.push(`${table}(${rows[0].cnt})`);
      }
      if (nullTables.length > 0) throw new Error(`NULL tenant_id rows: ${nullTables.join(', ')}`);
      return `All critical tables have tenant_id populated`;
    }),
  );

  // T23.5 — INSERT without tenant_id succeeds (founder_directives)
  tests.push(
    await runTest('T23.5', 'INSERT works without explicit tenant_id', async () => {
      const rows = await query<{ id: string; tenant_id: string }>(
        `INSERT INTO founder_directives (title, description, priority, category, target_agents, status, proposed_by, created_by, proposal_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, tenant_id`,
        ['__smoketest__', 'Smoke test tenant_id default', 'low', 'operations', ['Atlas'], 'proposed', 'smoketest', 'smoketest', 'Verifying tenant_id DEFAULT'],
      );
      const id = rows[0]?.id;
      const tid = rows[0]?.tenant_id;
      // Cleanup 
      if (id) await query(`DELETE FROM founder_directives WHERE id = $1`, [id]);
      if (tid !== GLYPHOR_TENANT) {
        throw new Error(`Expected tenant_id=${GLYPHOR_TENANT}, got ${tid}`);
      }
      return `INSERT auto-assigned tenant_id=${GLYPHOR_TENANT}`;
    }),
  );

  // T23.6 — INSERT without tenant_id succeeds (activity_log)
  tests.push(
    await runTest('T23.6', 'activity_log INSERT without tenant_id', async () => {
      const rows = await query<{ id: string; tenant_id: string }>(
        `INSERT INTO activity_log (action, agent_role, details)
         VALUES ($1, $2, $3::jsonb) RETURNING id, tenant_id`,
        ['smoketest', 'smoketest', JSON.stringify({ test: 'Verifying tenant_id DEFAULT on activity_log' })],
      );
      const id = rows[0]?.id;
      const tid = rows[0]?.tenant_id;
      if (id) await query(`DELETE FROM activity_log WHERE id = $1`, [id]);
      if (tid !== GLYPHOR_TENANT) {
        throw new Error(`Expected tenant_id=${GLYPHOR_TENANT}, got ${tid}`);
      }
      return `activity_log auto-assigned tenant_id`;
    }),
  );

  return { layer: 23, name: 'Tenant Isolation & DB Integrity', tests };
}
