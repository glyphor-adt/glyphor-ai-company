/**
 * Layer 23 — Tenant Isolation & Database Integrity
 *
 * Verifies the Supabase → GCP migration is complete:
 * - All tables with tenant_id have a DEFAULT value set
 * - tenant_id defaults to the Glyphor system tenant UUID
 * - INSERT without explicit tenant_id succeeds on ALL tables
 * - No orphaned rows with NULL tenant_id exist
 * - FK-dependent tables (kg_edges, constitutional_evaluations) work correctly
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { query } from '../utils/db.js';
import { runTest } from '../utils/test.js';

const GLYPHOR_TENANT = '00000000-0000-0000-0000-000000000000';
const SM = '__smoketest__'; // marker prefix for test data

interface TableSpec {
  table: string;
  sql: string;
  params: unknown[];
  idCol?: string; // override if id column isn't 'id'
}

/** Tables that have a tenant_id column — verify DEFAULT auto-assigns. */
const TENANT_ID_TABLES: TableSpec[] = [
  {
    table: 'founder_directives',
    sql: `INSERT INTO founder_directives (title, description) VALUES ($1, $2) RETURNING id, tenant_id`,
    params: [SM, 'smoketest directive'],
  },
  {
    table: 'activity_log',
    sql: `INSERT INTO activity_log (action, agent_role, details) VALUES ($1, $2, $3::jsonb) RETURNING id, tenant_id`,
    params: ['smoketest', SM, JSON.stringify({ test: true })],
  },
  {
    table: 'agent_briefs',
    sql: `INSERT INTO agent_briefs (agent_id) VALUES ($1) RETURNING agent_id AS id, tenant_id`,
    params: [SM],
    idCol: 'agent_id',
  },
  {
    table: 'agent_meetings',
    sql: `INSERT INTO agent_meetings (called_by, title, purpose, attendees) VALUES ($1, $2, $3, $4) RETURNING id, tenant_id`,
    params: [SM, SM, 'smoketest', [SM]],
  },
  {
    table: 'agent_messages',
    sql: `INSERT INTO agent_messages (from_agent, to_agent, message) VALUES ($1, $2, $3) RETURNING id, tenant_id`,
    params: [SM, SM, 'smoketest message'],
  },
  {
    table: 'agent_runs',
    sql: `INSERT INTO agent_runs (agent_id) VALUES ($1) RETURNING id, tenant_id`,
    params: [SM],
  },
  {
    table: 'agent_trust_scores',
    sql: `INSERT INTO agent_trust_scores (agent_role) VALUES ($1) RETURNING id, tenant_id`,
    params: [SM],
  },
  {
    table: 'drift_alerts',
    sql: `INSERT INTO drift_alerts (agent_role, metric, baseline_value, recent_value, deviation_sigma, direction, severity)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, tenant_id`,
    params: [SM, 'quality_score', 0.85, 0.50, 2.5, 'down', 'warning'],
  },
  {
    table: 'kg_nodes',
    sql: `INSERT INTO kg_nodes (node_type, title, content, created_by) VALUES ($1, $2, $3, $4) RETURNING id, tenant_id`,
    params: ['concept', SM, 'smoketest node', SM],
  },
  {
    table: 'platform_audit_log',
    sql: `INSERT INTO platform_audit_log (agent_role, platform, action) VALUES ($1, $2, $3) RETURNING id, tenant_id`,
    params: [SM, 'smoketest', 'test_action'],
  },
  {
    table: 'shared_episodes',
    sql: `INSERT INTO shared_episodes (author_agent, episode_type, summary) VALUES ($1, $2, $3) RETURNING id, tenant_id`,
    params: [SM, 'system_event', 'smoketest episode'],
  },
  {
    table: 'work_assignments',
    sql: `INSERT INTO work_assignments (assigned_to, task_description) VALUES ($1, $2) RETURNING id, tenant_id`,
    params: [SM, 'smoketest task'],
  },
];

/** Tables without tenant_id — verify basic INSERT works post-migration. */
const NON_TENANT_TABLES: TableSpec[] = [
  {
    table: 'agent_activities',
    sql: `INSERT INTO agent_activities (agent_role, activity_type, summary) VALUES ($1, $2, $3) RETURNING id`,
    params: [SM, 'smoketest', 'smoketest activity'],
  },
  {
    table: 'agent_growth',
    sql: `INSERT INTO agent_growth (agent_id, dimension, direction) VALUES ($1, $2, $3) RETURNING id`,
    params: [SM, 'quality', 'up'],
  },
  {
    table: 'agent_memory',
    sql: `INSERT INTO agent_memory (agent_role, memory_type, content) VALUES ($1, $2, $3) RETURNING id`,
    params: [SM, 'observation', 'smoketest memory'],
  },
  {
    table: 'agent_milestones',
    sql: `INSERT INTO agent_milestones (agent_id, type, title) VALUES ($1, $2, $3) RETURNING id`,
    params: [SM, 'achievement', SM],
  },
  {
    table: 'agent_peer_feedback',
    sql: `INSERT INTO agent_peer_feedback (from_agent, to_agent, feedback) VALUES ($1, $2, $3) RETURNING id`,
    params: [SM, SM, 'smoketest feedback'],
  },
  {
    table: 'agent_performance',
    sql: `INSERT INTO agent_performance (agent_id, date) VALUES ($1, $2) RETURNING id`,
    params: [SM, '2099-01-01'],
  },
  {
    table: 'agent_reflections',
    sql: `INSERT INTO agent_reflections (agent_role, run_id, summary) VALUES ($1, $2, $3) RETURNING id`,
    params: [SM, SM, 'smoketest reflection'],
  },
  {
    table: 'agent_schedules',
    sql: `INSERT INTO agent_schedules (agent_id, cron_expression) VALUES ($1, $2) RETURNING id`,
    params: [SM, '0 0 * * *'],
  },
  {
    table: 'agent_tool_grants',
    sql: `INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES ($1, $2, $3) RETURNING id`,
    params: [SM, 'smoketest_tool', SM],
  },
  {
    table: 'agent_world_model',
    sql: `INSERT INTO agent_world_model (agent_role) VALUES ($1) RETURNING id`,
    params: [SM],
  },
  {
    table: 'analyses',
    sql: `INSERT INTO analyses (id, type, query, requested_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    params: [SM, 'market_opportunity', 'smoketest query', SM],
  },
  {
    table: 'chat_messages',
    sql: `INSERT INTO chat_messages (agent_role, role, content, user_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    params: [SM, 'user', 'smoketest chat', SM],
  },
  {
    table: 'company_knowledge',
    sql: `INSERT INTO company_knowledge (knowledge_type, content) VALUES ($1, $2) RETURNING id`,
    params: ['cross_functional', 'smoketest knowledge'],
  },
  {
    table: 'company_profile',
    sql: `INSERT INTO company_profile (key, value, updated_by) VALUES ($1, $2::jsonb, $3) RETURNING id`,
    params: [SM, JSON.stringify({ test: true }), SM],
  },
  {
    table: 'content_drafts',
    sql: `INSERT INTO content_drafts (type, content) VALUES ($1, $2) RETURNING id`,
    params: ['blog', 'smoketest draft'],
  },
  {
    table: 'cot_analyses',
    sql: `INSERT INTO cot_analyses (id, query, requested_by) VALUES ($1, $2, $3) RETURNING id`,
    params: [SM, 'smoketest query', SM],
  },
  {
    table: 'decisions',
    sql: `INSERT INTO decisions (tier, title, summary, proposed_by, reasoning) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    params: ['T3', SM, 'smoketest decision', SM, 'smoketest reasoning'],
  },
  {
    table: 'deep_dives',
    sql: `INSERT INTO deep_dives (id, target) VALUES ($1, $2) RETURNING id`,
    params: [SM, 'smoketest target'],
  },
  {
    table: 'events',
    sql: `INSERT INTO events (type, source) VALUES ($1, $2) RETURNING id`,
    params: ['smoketest', SM],
  },
  {
    table: 'incidents',
    sql: `INSERT INTO incidents (severity, title) VALUES ($1, $2) RETURNING id`,
    params: ['low', SM],
  },
  {
    table: 'proposed_constitutional_amendments',
    sql: `INSERT INTO proposed_constitutional_amendments (agent_role, action, principle_text) VALUES ($1, $2, $3) RETURNING id`,
    params: [SM, 'add', 'smoketest principle'],
  },
  {
    table: 'simulations',
    sql: `INSERT INTO simulations (id, action, requested_by) VALUES ($1, $2, $3) RETURNING id`,
    params: [SM, 'smoketest action', SM],
  },
  {
    table: 'system_status',
    sql: `INSERT INTO system_status (status, summary) VALUES ($1, $2) RETURNING id`,
    params: ['healthy', 'smoketest status'],
  },
];

export async function run(_config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // ── T23.1 — Glyphor tenant row exists ──
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

  // ── T23.2 — All tenant_id columns have DEFAULT set ──
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

  // ── T23.3 — DEFAULT value is the Glyphor tenant UUID ──
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

  // ── T23.4 — No NULL tenant_id rows in critical tables ──
  tests.push(
    await runTest('T23.4', 'No NULL tenant_id rows', async () => {
      const rows = await query<{ table_name: string }>(
        `SELECT c.table_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public'
           AND c.column_name = 'tenant_id'
           AND t.table_type = 'BASE TABLE'`,
      );
      const nullTables: string[] = [];
      for (const row of rows) {
        const cnt = await query<{ cnt: string }>(
          `SELECT COUNT(*) as cnt FROM "${row.table_name}" WHERE tenant_id IS NULL`,
        );
        if (parseInt(cnt[0].cnt, 10) > 0)
          nullTables.push(`${row.table_name}(${cnt[0].cnt})`);
      }
      if (nullTables.length > 0)
        throw new Error(`NULL tenant_id rows: ${nullTables.join(', ')}`);
      return `All ${rows.length} tenant_id tables have no NULL rows`;
    }),
  );

  // ── T23.5 — INSERT roundtrip for all tenant_id tables ──
  tests.push(
    await runTest('T23.5', 'INSERT roundtrip: tenant_id tables', async () => {
      const ok: string[] = [];
      const failures: string[] = [];
      for (const spec of TENANT_ID_TABLES) {
        try {
          const rows = await query<{ id: string; tenant_id: string }>(spec.sql, spec.params);
          const id = rows[0]?.id;
          const tid = rows[0]?.tenant_id;
          if (id) {
            const idCol = spec.idCol || 'id';
            await query(`DELETE FROM "${spec.table}" WHERE "${idCol}" = $1`, [id]);
          }
          if (tid !== GLYPHOR_TENANT) {
            failures.push(`${spec.table}: tenant_id=${tid}, expected ${GLYPHOR_TENANT}`);
          } else {
            ok.push(spec.table);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push(`${spec.table}: ${msg}`);
        }
      }
      if (failures.length > 0) throw new Error(failures.join(' | '));
      return `${ok.length} tables OK: ${ok.join(', ')}`;
    }),
  );

  // ── T23.6 — INSERT roundtrip for non-tenant_id tables ──
  tests.push(
    await runTest('T23.6', 'INSERT roundtrip: non-tenant_id tables', async () => {
      const ok: string[] = [];
      const failures: string[] = [];
      for (const spec of NON_TENANT_TABLES) {
        try {
          const rows = await query<{ id: string }>(spec.sql, spec.params);
          const id = rows[0]?.id;
          if (id) {
            await query(`DELETE FROM "${spec.table}" WHERE id = $1`, [id]);
          }
          ok.push(spec.table);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push(`${spec.table}: ${msg}`);
        }
      }
      if (failures.length > 0) throw new Error(failures.join(' | '));
      return `${ok.length} tables OK: ${ok.join(', ')}`;
    }),
  );

  // ── T23.7 — FK-dependent tables (kg_edges, constitutional_evaluations, agent_profiles) ──
  tests.push(
    await runTest('T23.7', 'INSERT roundtrip: FK-dependent tables', async () => {
      const ok: string[] = [];
      const failures: string[] = [];

      // kg_edges: requires 2 kg_nodes (source + target)
      try {
        const [n1] = await query<{ id: string }>(
          `INSERT INTO kg_nodes (node_type, title, content, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
          ['concept', SM + '_src', 'source node', SM],
        );
        const [n2] = await query<{ id: string }>(
          `INSERT INTO kg_nodes (node_type, title, content, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
          ['concept', SM + '_tgt', 'target node', SM],
        );
        const [edge] = await query<{ id: string; tenant_id: string }>(
          `INSERT INTO kg_edges (source_id, target_id, edge_type, created_by) VALUES ($1,$2,$3,$4) RETURNING id, tenant_id`,
          [n1.id, n2.id, 'related_to', SM],
        );
        await query(`DELETE FROM kg_edges WHERE id = $1`, [edge.id]);
        await query(`DELETE FROM kg_nodes WHERE id IN ($1, $2)`, [n1.id, n2.id]);
        if (edge.tenant_id !== GLYPHOR_TENANT)
          failures.push(`kg_edges: tenant_id=${edge.tenant_id}`);
        else ok.push('kg_edges');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`kg_edges: ${msg}`);
        // attempt cleanup
        await query(`DELETE FROM kg_edges WHERE created_by = $1`, [SM]).catch(() => {});
        await query(`DELETE FROM kg_nodes WHERE created_by = $1`, [SM]).catch(() => {});
      }

      // constitutional_evaluations: requires an agent_run
      try {
        const [run] = await query<{ id: string }>(
          `INSERT INTO agent_runs (agent_id) VALUES ($1) RETURNING id`,
          [SM],
        );
        const [evalRow] = await query<{ id: string }>(
          `INSERT INTO constitutional_evaluations (run_id, agent_role, constitution_version, overall_adherence)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [run.id, SM, 1, 0.95],
        );
        await query(`DELETE FROM constitutional_evaluations WHERE id = $1`, [evalRow.id]);
        await query(`DELETE FROM agent_runs WHERE id = $1`, [run.id]);
        ok.push('constitutional_evaluations');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`constitutional_evaluations: ${msg}`);
        await query(`DELETE FROM constitutional_evaluations WHERE agent_role = $1`, [SM]).catch(() => {});
        await query(`DELETE FROM agent_runs WHERE agent_id = $1`, [SM]).catch(() => {});
      }

      // agent_profiles: requires a company_agents row (FK on agent_id → company_agents.role)
      try {
        await query(
          `INSERT INTO company_agents (role, display_name, model) VALUES ($1, $2, $3)`,
          [SM, 'Smoketest Agent', 'claude-sonnet-4-20250514'],
        );
        const [profile] = await query<{ agent_id: string }>(
          `INSERT INTO agent_profiles (agent_id) VALUES ($1) RETURNING agent_id`,
          [SM],
        );
        await query(`DELETE FROM agent_profiles WHERE agent_id = $1`, [profile.agent_id]);
        await query(`DELETE FROM company_agents WHERE role = $1`, [SM]);
        ok.push('agent_profiles + company_agents');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`agent_profiles: ${msg}`);
        await query(`DELETE FROM agent_profiles WHERE agent_id = $1`, [SM]).catch(() => {});
        await query(`DELETE FROM company_agents WHERE role = $1`, [SM]).catch(() => {});
      }

      // proposed_initiatives: tenant_id is TEXT type (not UUID)
      try {
        const [init] = await query<{ id: string; tenant_id: string }>(
          `INSERT INTO proposed_initiatives (proposed_by, title, justification) VALUES ($1,$2,$3) RETURNING id, tenant_id`,
          [SM, SM, 'smoketest justification'],
        );
        await query(`DELETE FROM proposed_initiatives WHERE id = $1`, [init.id]);
        if (!init.tenant_id || init.tenant_id === '')
          failures.push(`proposed_initiatives: tenant_id empty`);
        else ok.push('proposed_initiatives');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`proposed_initiatives: ${msg}`);
      }

      if (failures.length > 0) throw new Error(failures.join(' | '));
      return `${ok.length} FK-dependent tables OK: ${ok.join(', ')}`;
    }),
  );

  return { layer: 23, name: 'Tenant Isolation & DB Integrity', tests };
}
