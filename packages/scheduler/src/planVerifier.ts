/**
 * Plan Verifier — Pre-flight decomposition review for directive assignments.
 *
 * Validates proposed work assignments BEFORE dispatching them to agents:
 *   1. Deterministic  — Dependency cycles, tool coverage, workload balance
 *   2. LLM (optional) — Atomicity & context sufficiency via cross-model check
 *   3. Compose        — Aggregate checks into APPROVE / WARN / REVISE verdict
 *
 * No side-effects — pure validation, never mutates assignments.
 */

import { systemQuery } from '@glyphor/shared/db';
import { getVerifierFor } from '@glyphor/shared/models';
import type { ModelClient } from '@glyphor/agent-runtime';

// ─── Types ──────────────────────────────────────────────────────

export interface PlanVerificationRequest {
  directive: {
    id: string;
    title: string;
    description: string;
    priority: string;
    target_agents?: string[];
  };
  proposed_assignments: Array<{
    assigned_to: string;
    task_description: string;
    expected_output: string;
    depends_on?: string[];
    sequence_order: number;
  }>;
}

export interface PlanVerificationResult {
  verdict: 'APPROVE' | 'WARN' | 'REVISE';
  overall_score: number;
  checks: {
    atomicity: { passed: boolean; issues: string[] };
    tool_coverage: { passed: boolean; issues: string[] };
    dependency_validity: { passed: boolean; issues: string[] };
    context_sufficiency: { passed: boolean; issues: string[] };
    workload_balance: { passed: boolean; issues: string[] };
  };
  suggestions: string[];
}

// ─── Keyword → Tool Mapping ─────────────────────────────────────

const KEYWORD_TOOL_MAP: Record<string, string[]> = {
  email:       ['draft_email', 'send_dm'],
  github:      ['get_file_contents', 'create_or_update_file', 'create_github_pr', 'create_github_issue'],
  code:        ['get_file_contents', 'create_or_update_file', 'create_branch'],
  research:    ['web_search', 'recall_memories', 'read_company_memory'],
  financial:   ['get_financials', 'query_stripe_mrr', 'calculate_unit_economics'],
  finance:     ['get_financials', 'query_stripe_mrr', 'calculate_unit_economics'],
  metrics:     ['get_product_metrics', 'get_cloud_run_metrics'],
  calendar:    ['create_calendar_event', 'list_calendar_events'],
  meeting:     ['call_meeting', 'create_calendar_event'],
  report:      ['write_health_report', 'write_financial_report', 'write_product_analysis'],
  deploy:      ['get_pipeline_runs', 'query_cloud_run_metrics'],
  design:      ['run_lighthouse', 'get_design_tokens', 'get_component_library'],
  content:     ['draft_blog_post', 'draft_social_post', 'write_content'],
  support:     ['query_support_tickets', 'classify_ticket', 'respond_to_ticket'],
  seo:         ['query_seo_rankings', 'query_keyword_data', 'analyze_content_seo'],
  social:      ['schedule_social_post', 'query_social_metrics'],
  onboarding:  ['query_onboarding_funnel', 'query_activation_rate'],
};

const MAX_ASSIGNMENTS_PER_AGENT = 3;

// ─── Deterministic Checks ───────────────────────────────────────

/**
 * DFS-based cycle detection + missing-dependency + self-reference checks.
 */
function checkDependencyValidity(
  assignments: PlanVerificationRequest['proposed_assignments'],
): { passed: boolean; issues: string[] } {
  const issues: string[] = [];
  const ids = new Set(assignments.map((_, i) => String(i)));

  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];
    if (!a.depends_on?.length) continue;

    for (const dep of a.depends_on) {
      // Self-reference
      if (dep === String(i)) {
        issues.push(`Assignment #${i} ("${a.task_description.slice(0, 40)}…") depends on itself`);
      }
      // Missing dependency — resolve by assigned_to or index
      const depIdx = assignments.findIndex(
        (other, j) => String(j) === dep || other.assigned_to === dep,
      );
      if (depIdx === -1 && !ids.has(dep)) {
        issues.push(`Assignment #${i} depends on unknown reference "${dep}"`);
      }
    }
  }

  // Cycle detection via DFS on sequence_order / depends_on graph
  const graph = new Map<string, string[]>();
  for (let i = 0; i < assignments.length; i++) {
    graph.set(String(i), assignments[i].depends_on ?? []);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(id: string, path: string[]): boolean {
    if (inStack.has(id)) {
      issues.push(`Cycle detected: ${[...path, id].join(' → ')}`);
      return true;
    }
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    for (const dep of graph.get(id) ?? []) {
      if (dfs(dep, [...path, id])) return true;
    }
    inStack.delete(id);
    return false;
  }

  for (const id of graph.keys()) {
    if (!visited.has(id) && dfs(id, [])) break;
  }

  return { passed: issues.length === 0, issues };
}

/**
 * Verify each assigned agent has tools matching keywords in the task description.
 * Queries agent_tool_grants for active grants.
 */
async function checkToolCoverage(
  assignments: PlanVerificationRequest['proposed_assignments'],
): Promise<{ passed: boolean; issues: string[] }> {
  const issues: string[] = [];

  // Collect unique agent roles
  const roles = [...new Set(assignments.map((a) => a.assigned_to))];

  // Batch-fetch active tool grants for all involved agents
  let grantRows: Array<{ agent_role: string; tool_name: string }> = [];
  try {
    grantRows = await systemQuery<{ agent_role: string; tool_name: string }>(
      `SELECT agent_role, tool_name FROM agent_tool_grants
       WHERE agent_role = ANY($1) AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [roles],
    );
  } catch (err) {
    // DB unavailable — warn but don't block
    issues.push(`Could not verify tool grants: ${(err as Error).message}`);
    return { passed: true, issues };
  }

  // Build role → tool set
  const toolsByRole = new Map<string, Set<string>>();
  for (const row of grantRows) {
    if (!toolsByRole.has(row.agent_role)) toolsByRole.set(row.agent_role, new Set());
    toolsByRole.get(row.agent_role)!.add(row.tool_name);
  }

  for (const a of assignments) {
    const agentTools = toolsByRole.get(a.assigned_to);
    if (!agentTools) {
      issues.push(`Agent "${a.assigned_to}" has no known tool grants`);
      continue;
    }

    const desc = a.task_description.toLowerCase();
    for (const [keyword, requiredTools] of Object.entries(KEYWORD_TOOL_MAP)) {
      if (!desc.includes(keyword)) continue;
      const hasAny = requiredTools.some((t) => agentTools.has(t));
      if (!hasAny) {
        issues.push(
          `Agent "${a.assigned_to}" lacks tools for "${keyword}" ` +
          `(needs one of: ${requiredTools.join(', ')})`,
        );
      }
    }
  }

  return { passed: issues.length === 0, issues };
}

/**
 * Check that no agent is overloaded (> MAX_ASSIGNMENTS_PER_AGENT tasks).
 */
function checkWorkloadBalance(
  assignments: PlanVerificationRequest['proposed_assignments'],
): { passed: boolean; issues: string[] } {
  const issues: string[] = [];
  const counts = new Map<string, number>();

  for (const a of assignments) {
    counts.set(a.assigned_to, (counts.get(a.assigned_to) ?? 0) + 1);
  }

  for (const [agent, count] of counts) {
    if (count > MAX_ASSIGNMENTS_PER_AGENT) {
      issues.push(
        `Agent "${agent}" has ${count} assignments (max ${MAX_ASSIGNMENTS_PER_AGENT}) — consider redistribution`,
      );
    }
  }

  // Check if work could be better distributed across target agents
  if (counts.size >= 2) {
    const vals = [...counts.values()];
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    if (max - min > 2) {
      issues.push(
        `Uneven distribution: busiest agent has ${max} tasks, lightest has ${min}`,
      );
    }
  }

  return { passed: issues.length === 0, issues };
}

// ─── LLM Verification Pass ─────────────────────────────────────

const PLAN_VERIFIER_PROMPT = `You are a plan verification agent. Evaluate the proposed work decomposition for quality.

You will receive a directive and its proposed assignments. Assess:
1. **Atomicity**: Is each assignment a single, well-defined unit of work? Can each be completed independently (given its dependencies)?
2. **Context sufficiency**: Does each assignment contain enough context for the assigned agent to execute without ambiguity?

Respond with JSON (no markdown fences):
{
  "atomicity_score": <0.0 to 1.0>,
  "atomicity_issues": ["<list of issues, empty if none>"],
  "context_score": <0.0 to 1.0>,
  "context_issues": ["<list of issues, empty if none>"]
}

Be practical. Flag vague tasks, overly broad scope, or missing context. Do NOT flag stylistic preferences.`;

interface LlmCheckResult {
  atomicity: { passed: boolean; issues: string[]; score: number };
  context_sufficiency: { passed: boolean; issues: string[]; score: number };
}

async function runLlmVerification(
  request: PlanVerificationRequest,
  modelClient: ModelClient,
): Promise<LlmCheckResult> {
  // Cross-model: use a different provider for verification
  const verifierModel = getVerifierFor('gemini-2.0-flash');

  const userContent = [
    `## Directive`,
    `Title: ${request.directive.title}`,
    `Description: ${request.directive.description}`,
    `Priority: ${request.directive.priority}`,
    '',
    `## Proposed Assignments (${request.proposed_assignments.length})`,
    ...request.proposed_assignments.map((a, i) =>
      `### #${i} — ${a.assigned_to} (seq ${a.sequence_order})` +
      `\nTask: ${a.task_description}` +
      `\nExpected output: ${a.expected_output}` +
      (a.depends_on?.length ? `\nDepends on: ${a.depends_on.join(', ')}` : ''),
    ),
  ].join('\n');

  try {
    const response = await modelClient.generate({
      model: verifierModel,
      systemInstruction: PLAN_VERIFIER_PROMPT,
      contents: [{ role: 'user', content: userContent, timestamp: Date.now() }],
      temperature: 0.1,
      maxTokens: 1024,
    });

    const cleaned = (response.text ?? '').replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const atomScore = Math.max(0, Math.min(1, Number(parsed.atomicity_score) || 0.5));
    const ctxScore = Math.max(0, Math.min(1, Number(parsed.context_score) || 0.5));

    return {
      atomicity: {
        passed: atomScore >= 0.5,
        issues: Array.isArray(parsed.atomicity_issues) ? parsed.atomicity_issues.map(String) : [],
        score: atomScore,
      },
      context_sufficiency: {
        passed: ctxScore >= 0.5,
        issues: Array.isArray(parsed.context_issues) ? parsed.context_issues.map(String) : [],
        score: ctxScore,
      },
    };
  } catch (err) {
    // LLM failure — warn but don't block
    return {
      atomicity: { passed: true, issues: [`LLM check failed: ${(err as Error).message}`], score: 0.5 },
      context_sufficiency: { passed: true, issues: [`LLM check failed: ${(err as Error).message}`], score: 0.5 },
    };
  }
}

// ─── Main Export ────────────────────────────────────────────────

/**
 * Pre-flight verification of a proposed plan decomposition.
 *
 * Runs deterministic checks (dependency graph, tool coverage, workload balance)
 * on every request. For critical/high priority directives or plans with >5
 * assignments, also runs an LLM-based atomicity & context review via
 * cross-model verification.
 *
 * @returns A verdict (APPROVE / WARN / REVISE) with per-check details.
 */
export async function verifyPlan(
  request: PlanVerificationRequest,
  options?: { modelClient?: ModelClient; skipLlm?: boolean },
): Promise<PlanVerificationResult> {
  const t0 = Date.now();

  // 1. Deterministic pre-checks (always run)
  const [depResult, toolResult, workloadResult] = await Promise.all([
    Promise.resolve(checkDependencyValidity(request.proposed_assignments)),
    checkToolCoverage(request.proposed_assignments),
    Promise.resolve(checkWorkloadBalance(request.proposed_assignments)),
  ]);

  // 2. LLM verification (conditional)
  const priority = request.directive.priority?.toLowerCase();
  const needsLlm =
    !options?.skipLlm &&
    options?.modelClient &&
    (priority === 'critical' || priority === 'high' || request.proposed_assignments.length > 5);

  let atomResult = { passed: true, issues: [] as string[] };
  let ctxResult = { passed: true, issues: [] as string[] };
  let llmScore = 1;

  if (needsLlm) {
    const llm = await runLlmVerification(request, options!.modelClient!);
    atomResult = { passed: llm.atomicity.passed, issues: llm.atomicity.issues };
    ctxResult = { passed: llm.context_sufficiency.passed, issues: llm.context_sufficiency.issues };
    llmScore = (llm.atomicity.score + llm.context_sufficiency.score) / 2;
  }

  // 3. Compose verdict
  const checks = {
    atomicity: atomResult,
    tool_coverage: toolResult,
    dependency_validity: depResult,
    context_sufficiency: ctxResult,
    workload_balance: workloadResult,
  };

  const allChecks = [depResult, toolResult, workloadResult, atomResult, ctxResult];
  const totalIssues = allChecks.reduce((n, c) => n + c.issues.length, 0);
  const passedCount = allChecks.filter((c) => c.passed).length;

  // Score: ratio of passed checks, weighted down by LLM score when applicable
  const detScore = passedCount / allChecks.length;
  const overall_score = needsLlm ? (detScore + llmScore) / 2 : detScore;

  // Collect suggestions from all failing checks
  const suggestions: string[] = allChecks.flatMap((c) => c.issues);

  let verdict: PlanVerificationResult['verdict'];
  if (!depResult.passed || (needsLlm && !atomResult.passed && llmScore < 0.5)) {
    verdict = 'REVISE';
  } else if (totalIssues > 0) {
    verdict = 'WARN';
  } else {
    verdict = 'APPROVE';
  }

  const result = { verdict, overall_score, checks, suggestions };

  // 4. Persist result (best-effort, never blocks)
  persistVerification(request.directive.id, result, {
    assignmentCount: request.proposed_assignments.length,
    llmVerified: !!needsLlm,
    durationMs: Date.now() - t0,
  }).catch(() => {});

  return result;
}

// ─── Persistence ────────────────────────────────────────────────

/**
 * Persist a plan verification result to the plan_verifications table.
 * Best-effort — never throws; failures are logged silently.
 */
export async function persistVerification(
  directiveId: string,
  result: PlanVerificationResult,
  meta: { assignmentCount: number; llmVerified: boolean; costUsd?: number; durationMs?: number },
): Promise<void> {
  try {
    await systemQuery(
      `INSERT INTO plan_verifications
         (directive_id, verdict, overall_score, checks, suggestions, assignment_count, llm_verified, cost_usd, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        directiveId,
        result.verdict,
        result.overall_score,
        JSON.stringify(result.checks),
        result.suggestions,
        meta.assignmentCount,
        meta.llmVerified,
        meta.costUsd ?? 0,
        meta.durationMs ?? null,
      ],
    );
  } catch (err) {
    console.error('[PlanVerifier] Failed to persist verification:', (err as Error).message);
  }
}
