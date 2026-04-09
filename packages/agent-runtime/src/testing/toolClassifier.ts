// packages/agent-runtime/src/testing/toolClassifier.ts
// Extended to cover actual Glyphor tool naming patterns.
// Run classifyAllTools() to re-classify — existing manual_reviewed=TRUE rows
// are preserved and never overwritten.

import { db } from '../db.js';

export type ToolRiskTier =
  | 'read_only'
  | 'idempotent_write'
  | 'destructive'
  | 'external_api'
  | 'infrastructure'
  | 'unknown';

export type TestStrategy =
  | 'live'
  | 'probe'
  | 'mock'
  | 'sandbox'
  | 'schema_only';

// ─── CLASSIFICATION RULES ────────────────────────────────────────────────────
// Rules are evaluated top-to-bottom. First match wins.
// Each rule has: pattern (regex), tier, strategy, optional notes.

const CLASSIFICATION_RULES: Array<{
  pattern: RegExp;
  tier: ToolRiskTier;
  strategy: TestStrategy;
  notes?: string;
}> = [

  // ── INFRASTRUCTURE (always first — highest risk, must not run in prod tests) ──
  {
    pattern: /deploy|rollback|scale_service|update_cloud_run|migrate|terraform|cloud_build|trigger_vercel|update_agent_schedule|update_model_config|update_cloud_run_secrets/i,
    tier: 'infrastructure',
    strategy: 'schema_only',
    notes: 'Infra mutations — schema validation only',
  },

  // ── DESTRUCTIVE (send, post, delete, charge, publish, external writes) ──────
  {
    pattern: /^(send_|post_to_|notify_|publish_|email|reply_email|draft_email|set_campaign|send_transactional|call_meeting|create_github_pr|merge_github_pr|create_incident|create_decision|fire_webhook|trigger_alert|emit_alert)/i,
    tier: 'destructive',
    strategy: 'sandbox',
  },
  {
    pattern: /(delete_|remove_|purge_|archive_|deactivate_|retire_|revoke_)/i,
    tier: 'destructive',
    strategy: 'sandbox',
  },
  {
    pattern: /^(charge_|invoice_|pay_|refund_|stripe_)/i,
    tier: 'destructive',
    strategy: 'sandbox',
    notes: 'Financial mutations — sandbox only',
  },

  // ── EXTERNAL API (calls third-party services) ─────────────────────────────
  {
    pattern: /slack|teams|github|stripe|mercury|figma|canva|vercel|linear|notion|hubspot|salesforce|mailchimp|twilio|sendgrid|synthesia|mcp_|agent365|entra/i,
    tier: 'external_api',
    strategy: 'probe',
  },
  {
    pattern: /^(web_fetch|web_search|screenshot_page|deploy_preview|check_ai_smell|run_accessibility_audit)/i,
    tier: 'external_api',
    strategy: 'probe',
    notes: 'Web/browser tools — probe connectivity only',
  },
  {
    pattern: /^(codex$|codex-reply|invoke_fuse|invoke_pulse|storybook)/i,
    tier: 'external_api',
    strategy: 'probe',
    notes: 'AI build tools — probe only',
  },

  // ── READ ONLY (analysis, queries, calculations, audits, comparisons) ─────
  {
    pattern: /^(get_|list_|read_|query_|check_|fetch_|inspect_|search_|find_|show_|describe_|view_)/i,
    tier: 'read_only',
    strategy: 'live',
  },
  // camelCase variants of the above
  {
    pattern: /^(get[A-Z]|list[A-Z]|read[A-Z]|query[A-Z]|check[A-Z]|fetch[A-Z])/,
    tier: 'read_only',
    strategy: 'live',
  },
  {
    pattern: /^(analyze_|analyse_|calculate_|compute_|estimate_|evaluate_|measure_|score_|rank_|compare_|contrast_)/i,
    tier: 'read_only',
    strategy: 'live',
    notes: 'Analysis and computation — read inputs, no side effects',
  },
  {
    pattern: /^(audit_|review_|validate_|verify_|test_|diagnose_|assess_|classify_|detect_|identify_|scan_)/i,
    tier: 'read_only',
    strategy: 'live',
  },
  {
    pattern: /^(compile_|aggregate_|summarize_|summarise_|digest_|report_|export_|format_|parse_|extract_|transform_)/i,
    tier: 'read_only',
    strategy: 'live',
    notes: 'Data transformation — reads input, returns output, no writes',
  },
  {
    pattern: /^(browse_|navigate_|trace_|traverse_|explore_|lookup_|resolve_)/i,
    tier: 'read_only',
    strategy: 'live',
  },
  {
    pattern: /(health$|status$|metrics$|stats$|info$|summary$|report$|history$|log$|feed$)/i,
    tier: 'read_only',
    strategy: 'live',
  },
  {
    pattern: /^(recall_|recall_memories|read_company|get_company|get_platform|get_agent|get_cloud|get_service|get_event|get_data|get_infra)/i,
    tier: 'read_only',
    strategy: 'live',
  },

  // ── IDEMPOTENT WRITE (safe to repeat, low blast radius) ───────────────────
  {
    pattern: /^(save_|update_|upsert_|set_|mark_|tag_|label_|assign_|approve_|flag_|resolve_)/i,
    tier: 'idempotent_write',
    strategy: 'live',
    notes: 'Idempotent writes — safe to call repeatedly',
  },
  {
    pattern: /^(add_|add_channel|add_graph|add_knowledge|contribute_knowledge)/i,
    tier: 'idempotent_write',
    strategy: 'live',
  },
  {
    pattern: /^(capture_|record_|log_|track_|register_|enroll_)/i,
    tier: 'idempotent_write',
    strategy: 'live',
    notes: 'Logging/tracking writes — idempotent',
  },
  {
    pattern: /^(activate_|enable_|disable_|pause_|resume_|toggle_)/i,
    tier: 'idempotent_write',
    strategy: 'live',
    notes: 'Status changes — safe, reversible',
  },

  // ── CREATE — split by what is being created ───────────────────────────────
  // Safe creates (internal records, drafts, plans, analyses)
  {
    pattern: /^create_(draft|plan|spec|report|analysis|summary|template|brief|outline|proposal|estimate|model|benchmark|budget|experiment|monitor|handoff|content_draft|compliance_alert)/i,
    tier: 'idempotent_write',
    strategy: 'live',
  },
  // Safe creates (graph nodes, knowledge, memory, research artifacts)
  {
    pattern: /^create_(graph|knowledge|memory|research|digest|dossier|component_branch|component_pr|bug_report)/i,
    tier: 'idempotent_write',
    strategy: 'live',
  },
  // Destructive creates (PRs, issues, incidents, decisions, contracts, filings, campaigns)
  {
    pattern: /^create_(github_pr|github_issue|incident|decision|contract|ip_filing|logo_variation|mailchimp|channel|specialist)/i,
    tier: 'destructive',
    strategy: 'sandbox',
  },
  // Default create — anything not matched above = sandbox to be safe
  {
    pattern: /^create_/i,
    tier: 'destructive',
    strategy: 'sandbox',
    notes: 'Unclassified create — sandbox until reviewed',
  },

  // ── GENERATE — usually safe (produces content, no external write) ─────────
  {
    pattern: /^(generate_|draft_|write_|compose_|render_|build_report|build_brief)/i,
    tier: 'idempotent_write',
    strategy: 'live',
    notes: 'Content generation — writes to internal store, no external side effects',
  },

  // ── SPECIFIC KNOWN TOOLS ──────────────────────────────────────────────────
  // Tools whose names are ambiguous — classified by known behavior
  {
    pattern: /^(comment_on_pr|capture_lead|call_meeting|clone_and_modify|batch_similar_tickets)/i,
    tier: 'destructive',
    strategy: 'sandbox',
  },
  {
    pattern: /^(propose_|recommend_|suggest_|plan_|forecast_|model_market)/i,
    tier: 'read_only',
    strategy: 'live',
    notes: 'Advisory tools — return analysis, no mutations',
  },
  {
    pattern: /^(upload_|import_|ingest_)/i,
    tier: 'idempotent_write',
    strategy: 'sandbox',
    notes: 'File operations — sandbox to avoid real file writes',
  },
  {
    pattern: /^(grant_|revoke_|assign_team_task|request_tool|review_tool|register_tool|grant_tool|deactivate_tool)/i,
    tier: 'infrastructure',
    strategy: 'schema_only',
    notes: 'Permission/registry mutations — schema only',
  },

  // ── READ ONLY — analysis, monitoring, discovery, lookup ──────────────────
  {
    pattern: /^(cross_reference_|discover_|predict_|project_costs|rollup_|peer_data_request|who_handles|tool_search)/i,
    tier: 'read_only',
    strategy: 'live',
    notes: 'Analysis and lookup — no side effects',
  },
  {
    pattern: /^(monitor_|run_access_audit|run_cohort_analysis|run_health_check|run_lighthouse|run_engagement_survey)/i,
    tier: 'read_only',
    strategy: 'live',
    notes: 'Monitoring and audit runs — read-only signal collection',
  },
  {
    pattern: /^(design_experiment|design_onboarding|normalize_design_brief|segment_users|emit_insight)/i,
    tier: 'read_only',
    strategy: 'live',
    notes: 'Planning and analysis tools — produce output, no external writes',
  },

  // ── EXTERNAL API — web fetching, browser tools, lighthouse ───────────────
  {
    pattern: /^(web_fetch|web_get_url|screenshot_component)/i,
    tier: 'external_api',
    strategy: 'probe',
    notes: 'Web fetch tools — external HTTP calls',
  },

  // ── IDEMPOTENT WRITE — internal submissions, knowledge, scaffolding ───────
  {
    pattern: /^(submit_|promote_to_org|store_intel|grade_build|optimize_image|restyle_logo|scaffold_|rollup_agent)/i,
    tier: 'idempotent_write',
    strategy: 'live',
    notes: 'Internal record writes — safe to repeat',
  },

  // ── DESTRUCTIVE — dispatch, escalate, reply, social posting, retries ──────
  {
    pattern: /^(dispatch_assignment|escalate_|reply_to_social|schedule_social_post|respond_to_ticket|reject_content_draft)/i,
    tier: 'destructive',
    strategy: 'sandbox',
    notes: 'Dispatches work or sends external replies',
  },
  {
    pattern: /^(request_new_tool|request_peer_work|file_decision|push_component|resend_envelope|void_envelope)/i,
    tier: 'destructive',
    strategy: 'sandbox',
    notes: 'Creates external artifacts or sends notifications',
  },
  {
    pattern: /^(retry_data_sync|retry_failed_run|trigger_agent_run|run_onboarding|run_test_suite)/i,
    tier: 'destructive',
    strategy: 'sandbox',
    notes: 'Triggers or retries execution — side effects possible',
  },

  // ── INFRASTRUCTURE — secrets, access, feature flags ──────────────────────
  {
    pattern: /^(gcp_create_secret|rotate_secrets|provision_access|manage_feature_flags)/i,
    tier: 'infrastructure',
    strategy: 'schema_only',
    notes: 'Secret and access management — never run in tests',
  },

  // ── CREATIVE / AI GENERATION TOOLS ────────────────────────────────────────
  {
    pattern: /synthesize_video|generate_image|generate_video|render_video/i,
    tier: 'external_api',
    strategy: 'probe',
    notes: 'AI media generation — expensive, probe only',
  },
];

// ─── CLASSIFIER ──────────────────────────────────────────────────────────────

export interface ToolClassification {
  toolName: string;
  riskTier: ToolRiskTier;
  testStrategy: TestStrategy;
  matchedRule?: string;
  source: 'static' | 'dynamic' | 'mcp';
  manuallyReviewed: boolean;
  /** Optional overrides merged into generated Tier 2 test input (when present). */
  testInput?: Record<string, unknown>;
}

export function classifyTool(toolName: string): ToolClassification {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(toolName)) {
      return {
        toolName,
        riskTier: rule.tier,
        testStrategy: rule.strategy,
        matchedRule: rule.pattern.toString(),
        source: 'static',
        manuallyReviewed: false,
      };
    }
  }

  // Nothing matched
  return {
    toolName,
    riskTier: 'unknown',
    testStrategy: 'schema_only',
    source: 'static',
    manuallyReviewed: false,
  };
}

// ─── BATCH RE-CLASSIFICATION ─────────────────────────────────────────────────

export async function reclassifyAllTools(): Promise<{
  total: number;
  reclassified: number;
  stillUnknown: number;
  distribution: Record<string, number>;
}> {
  // Get all tools that are NOT manually reviewed
  // Never overwrite manually_reviewed = TRUE rows
  const rows = await db.query(`
    SELECT tool_name, source FROM tool_test_classifications
    WHERE manually_reviewed = FALSE
    UNION
    SELECT name AS tool_name, 'dynamic' AS source FROM tool_registry
      WHERE is_active = true
      AND name NOT IN (SELECT tool_name FROM tool_test_classifications)
  `);

  let reclassified = 0;
  let stillUnknown = 0;
  const distribution: Record<string, number> = {};

  for (const row of rows) {
    const classification = classifyTool(row.tool_name);
    distribution[classification.riskTier] =
      (distribution[classification.riskTier] ?? 0) + 1;

    if (classification.riskTier !== 'unknown') reclassified++;
    else stillUnknown++;

    await db.query(`
      INSERT INTO tool_test_classifications
        (tool_name, risk_tier, test_strategy, source, classified_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (tool_name) DO UPDATE SET
        risk_tier = EXCLUDED.risk_tier,
        test_strategy = EXCLUDED.test_strategy,
        classified_at = NOW()
      WHERE tool_test_classifications.manually_reviewed = FALSE
    `, [
      row.tool_name,
      classification.riskTier,
      classification.testStrategy,
      row.source,
    ]);
  }

  return { total: rows.length, reclassified, stillUnknown, distribution };
}

// ─── REMAINING UNKNOWNS REPORT ───────────────────────────────────────────────
// Run this after reclassifyAllTools() to see what still needs human eyes.
// Should be <20 tools after the rules above are applied.

export async function getUnknownTools(): Promise<Array<{
  toolName: string;
  source: string;
  suggestedQuestions: string[];
}>> {
  const unknowns = await db.query(`
    SELECT tool_name, source FROM tool_test_classifications
    WHERE risk_tier = 'unknown' AND manually_reviewed = FALSE
    ORDER BY tool_name
  `);

  return unknowns.map(row => ({
    toolName: row.tool_name,
    source: row.source,
    // Give Cursor/reviewer a hint about what to determine
    suggestedQuestions: [
      'Does this tool write to an external service (email, Teams, GitHub, Slack)?',
      'Does this tool modify production data or state?',
      'Is this safe to call repeatedly with the same params?',
      'What does the execute() function actually do?',
    ],
  }));
}

// ─── MANUAL REVIEW HELPER ────────────────────────────────────────────────────
// After a human reviews an unknown tool, use this to lock the classification.

export async function manuallyClassifyTool(
  toolName: string,
  tier: ToolRiskTier,
  strategy: TestStrategy,
  reviewedBy: string,
  notes?: string
): Promise<void> {
  await db.query(`
    UPDATE tool_test_classifications SET
      risk_tier = $2,
      test_strategy = $3,
      manually_reviewed = TRUE,
      classified_by = $4,
      skip_reason = $5,
      classified_at = NOW()
    WHERE tool_name = $1
  `, [toolName, tier, strategy, reviewedBy, notes ?? null]);
}
