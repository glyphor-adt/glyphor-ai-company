-- 20260427235100_purge_16_orphan_agent_roles.sql
--
-- DB-side cleanup for 16 agent roles whose source code was removed in
-- commit 42dfe4ee (chore(agents): remove 16 retired/orphaned agent roles)
-- and follow-up 9819c122. Audit reference:
--   audit-reports/diagnostic-2026-04-27.md (sections "Orphan code &
--   retired roles" and "Deleted-role residue").
--
-- Removed roles (alphabetical, 16):
--   competitive-intel, competitive-research-analyst, content-creator,
--   design-critic, frontend-engineer, global-admin, head-of-hr,
--   m365-admin, market-research-analyst, platform-intel, seo-analyst,
--   social-media-manager, template-architect, ui-ux-designer,
--   user-researcher, vp-sales
--
-- This migration purges every row whose role / agent_role / agent_id /
-- responsible_agent / owner_role / etc. column matches one of the 16.
-- Each block uses GET DIAGNOSTICS + RAISE NOTICE so the application log
-- preserves a row-count audit trail.
--
-- Pre-flight counts (captured 2026-04-27 against ai-glyphor-company:
-- us-central1:glyphor-db) total approximately 37,800 source rows plus
-- 21 cascade-deleted abac_policies. Tables with zero matching rows are
-- documented in comments rather than deleted from defensively, except
-- where the spec explicitly listed them.
--
-- FK behaviour verified before writing:
--   * abac_policies.agent_role_id  -> agent_roles(id)        ON DELETE CASCADE
--   * abac_audit_log.policy_id     -> abac_policies(id)      ON DELETE SET NULL
--   * action_reversals.audit_log_id -> activity_log(id)      ON DELETE CASCADE
--   * decision_traces.audit_log_id -> activity_log(id)       ON DELETE CASCADE
--   * agent_eval_results.scenario_id -> agent_eval_scenarios ON DELETE CASCADE
--   * cz_runs.prompt_version_id    -> agent_prompt_versions  ON DELETE NO ACTION (0 affected)
--   * cz_shadow_evals.prompt_version_id -> agent_prompt_versions ON DELETE CASCADE
--   * content_drafts/deliverables/founder_directives/scheduled_posts
--     .initiative_id -> initiatives(id) ON DELETE NO ACTION (0 affected children)
--
-- This migration does NOT drop any tables.

BEGIN;

DO $$
DECLARE
  removed_roles TEXT[] := ARRAY[
    'competitive-intel','competitive-research-analyst','content-creator',
    'design-critic','frontend-engineer','global-admin','head-of-hr',
    'm365-admin','market-research-analyst','platform-intel','seo-analyst',
    'social-media-manager','template-architect','ui-ux-designer',
    'user-researcher','vp-sales'
  ];
  affected INTEGER;
BEGIN
  -- ---------------------------------------------------------------
  -- High-volume audit / log tables.
  -- abac_audit_log carries (agent_id, agent_role) on every row; the two
  -- columns hold the same slug for our matched rows (verified: by_role =
  -- by_id = by_both = 33641). One DELETE on agent_role removes them all.
  -- ---------------------------------------------------------------
  DELETE FROM abac_audit_log WHERE agent_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'abac_audit_log: % rows removed', affected;

  DELETE FROM activity_log WHERE agent_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'activity_log: % rows removed (cascades to action_reversals, decision_traces)', affected;

  DELETE FROM kg_access_log WHERE agent_id = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'kg_access_log: % rows removed', affected;

  DELETE FROM platform_audit_log WHERE agent_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'platform_audit_log: % rows removed', affected;

  DELETE FROM security_anomalies WHERE agent_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'security_anomalies: % rows removed', affected;

  -- ---------------------------------------------------------------
  -- Per-role activity / behavior tables.
  -- ---------------------------------------------------------------
  DELETE FROM agent_activities WHERE agent_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'agent_activities: % rows removed', affected;

  DELETE FROM agent_growth WHERE agent_id = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'agent_growth: % rows removed', affected;

  DELETE FROM agent_memory WHERE agent_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'agent_memory: % rows removed', affected;

  DELETE FROM agent_reflections WHERE agent_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'agent_reflections: % rows removed', affected;

  DELETE FROM agent_schedules WHERE agent_id = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'agent_schedules: % rows removed', affected;

  DELETE FROM agent_tool_grants WHERE agent_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'agent_tool_grants: % rows removed', affected;

  DELETE FROM agent_trust_scores WHERE agent_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'agent_trust_scores: % rows removed', affected;

  -- ---------------------------------------------------------------
  -- Catalog / config tables.
  -- ---------------------------------------------------------------
  DELETE FROM agent_catalog_templates WHERE default_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'agent_catalog_templates: % rows removed', affected;

  -- agent_prompt_versions: cz_runs (NO ACTION) referenced 0 rows pre-flight;
  -- cz_shadow_evals (CASCADE) referenced 0. Safe to delete directly.
  DELETE FROM agent_prompt_versions WHERE agent_id = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'agent_prompt_versions: % rows removed', affected;

  -- agent_roles is the canonical role catalog. Deleting cascades to
  -- abac_policies (~21 rows pre-flight), and abac_audit_log.policy_id
  -- is SET NULL via FK so historical audit rows survive with a null
  -- policy reference -- intentional: keep the audit, drop the policy.
  DELETE FROM agent_roles WHERE name = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'agent_roles: % rows removed (cascades to abac_policies; abac_audit_log.policy_id SET NULL)', affected;

  DELETE FROM initiatives WHERE owner_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'initiatives: % rows removed', affected;

  DELETE FROM platform_iam_state WHERE agent_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'platform_iam_state: % rows removed', affected;

  DELETE FROM policy_versions WHERE agent_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'policy_versions: % rows removed', affected;

  DELETE FROM role_rubrics WHERE role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'role_rubrics: % rows removed', affected;

  DELETE FROM standing_objectives WHERE agent_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'standing_objectives: % rows removed', affected;

  DELETE FROM tenant_agents WHERE agent_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'tenant_agents: % rows removed', affected;

  DELETE FROM voice_usage WHERE agent_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'voice_usage: % rows removed', affected;

  -- ---------------------------------------------------------------
  -- Knowledge graph: drop the single platform-intel entity.
  -- ---------------------------------------------------------------
  DELETE FROM kg_entities WHERE name = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'kg_entities: % rows removed', affected;

  -- ---------------------------------------------------------------
  -- executive_orchestration_config.allowed_assignees is a text[] column.
  -- Per spec: prune deleted roles from the array rather than DELETE the
  -- row. After pruning, cmo's allowed_assignees becomes []; cto retains
  -- platform-engineer / quality-engineer / devops-engineer.
  -- ---------------------------------------------------------------
  UPDATE executive_orchestration_config
     SET allowed_assignees = ARRAY(
           SELECT a FROM unnest(allowed_assignees) a
            WHERE a <> ALL (removed_roles)
         )
   WHERE allowed_assignees && removed_roles;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'executive_orchestration_config: % rows updated (allowed_assignees pruned)', affected;

  -- ---------------------------------------------------------------
  -- Tables explicitly listed in the spec but verified zero matching
  -- rows pre-flight -- defensive deletes so the migration log records
  -- that we checked them:
  --   * company_agents.role             (already absent)
  --   * agent_eval_scenarios.agent_role (already absent;
  --       agent_eval_results would CASCADE if any survived)
  --   * cz_tasks.responsible_agent      (cleaned by
  --       20260421130000_cz_reassign_retired_agents.sql)
  -- ---------------------------------------------------------------
  DELETE FROM company_agents WHERE role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'company_agents: % rows removed (expected 0)', affected;

  DELETE FROM agent_eval_scenarios WHERE agent_role = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'agent_eval_scenarios: % rows removed (expected 0; cascades to agent_eval_results)', affected;

  DELETE FROM cz_tasks WHERE responsible_agent = ANY(removed_roles);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'cz_tasks: % rows removed (expected 0; reassigned 2026-04-21)', affected;

  RAISE NOTICE 'purge_16_orphan_agent_roles: complete';
END $$;

COMMIT;
