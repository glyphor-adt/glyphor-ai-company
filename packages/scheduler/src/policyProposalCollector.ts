/**
 * Policy Proposal Collector — Gathers policy change proposals from across the system
 *
 * Runs twice daily (3 AM / 3 PM UTC, 1 hour after batch evaluation) to scan
 * multiple data sources for actionable policy proposals and insert them as
 * draft policy_versions for the Learning Governor pipeline.
 *
 * 6 Proposal Sources:
 *  1. Prompt proposals from agent_reflections.prompt_suggestions
 *  2. Constitutional proposals from proposed_constitutional_amendments
 *  3. Routing proposals from task_run_outcomes failure patterns
 *  4. Model selection proposals from task_run_outcomes quality comparisons
 *  5. Rubric proposals from shared_procedures with high success rates
 *  6. Knowledge gap proposals from agent_reflections.knowledge_gaps
 */

import { systemQuery } from '@glyphor/shared/db';
import { getRedisCache } from '@glyphor/agent-runtime';

// ─── Types ──────────────────────────────────────────────────────

export interface CollectionReport {
  prompt_proposals: number;
  constitutional_proposals: number;
  routing_proposals: number;
  model_proposals: number;
  rubric_proposals: number;
  skipped_duplicates: number;
}

// ─── Configuration ──────────────────────────────────────────────

const LOCK_KEY = 'policy-proposal-collection-lock';
const LOCK_TTL_SECONDS = 30 * 60; // 30 minutes
const LOG_PREFIX = '[PolicyProposalCollector]';

// Thresholds
const PROMPT_THEME_MIN_COUNT = 3;      // min reflections suggesting same theme
const ROUTING_FAILURE_RATE = 0.5;       // 50% failure rate triggers routing proposal
const ROUTING_LOOKBACK_DAYS = 14;
const MODEL_QUALITY_ADVANTAGE = 0.5;    // non-default model must outperform by 0.5 pts
const MODEL_MIN_RUNS = 20;
const RUBRIC_SUCCESS_THRESHOLD = 0.8;
const RUBRIC_USAGE_THRESHOLD = 5;
const KNOWLEDGE_GAP_MIN_COUNT = 3;      // recurring gaps across agents

// ─── Main Entry Point ───────────────────────────────────────────

export async function collectProposals(): Promise<CollectionReport> {
  const report: CollectionReport = {
    prompt_proposals: 0,
    constitutional_proposals: 0,
    routing_proposals: 0,
    model_proposals: 0,
    rubric_proposals: 0,
    skipped_duplicates: 0,
  };

  // Acquire Redis lock to prevent concurrent runs
  const cache = getRedisCache();
  const existingLock = await cache.get<string>(LOCK_KEY);
  if (existingLock) {
    console.log(`${LOG_PREFIX} Skipping — another collection is in progress`);
    return report;
  }
  await cache.set(LOCK_KEY, new Date().toISOString(), LOCK_TTL_SECONDS);

  try {
    // 1. Prompt proposals from agent_reflections.prompt_suggestions
    const promptResult = await collectPromptProposals();
    report.prompt_proposals = promptResult.created;
    report.skipped_duplicates += promptResult.skipped;

    // 2. Constitutional proposals from proposed_constitutional_amendments
    const constResult = await collectConstitutionalProposals();
    report.constitutional_proposals = constResult.created;
    report.skipped_duplicates += constResult.skipped;

    // 3. Routing proposals from task_run_outcomes failure patterns
    const routingResult = await collectRoutingProposals();
    report.routing_proposals = routingResult.created;
    report.skipped_duplicates += routingResult.skipped;

    // 4. Model selection proposals from quality comparisons
    const modelResult = await collectModelSelectionProposals();
    report.model_proposals = modelResult.created;
    report.skipped_duplicates += modelResult.skipped;

    // 5. Rubric proposals from shared_procedures
    const rubricResult = await collectRubricProposals();
    report.rubric_proposals = rubricResult.created;
    report.skipped_duplicates += rubricResult.skipped;

    // 6. Knowledge gap proposals from agent_reflections.knowledge_gaps
    const gapResult = await collectKnowledgeGapProposals();
    report.prompt_proposals += gapResult.created; // knowledge gaps produce prompt-type proposals
    report.skipped_duplicates += gapResult.skipped;

    console.log(`${LOG_PREFIX} Complete:`, JSON.stringify(report));
  } finally {
    await cache.del(LOCK_KEY);
  }

  return report;
}

// ─── Deduplication Helper ───────────────────────────────────────

async function hasSimilarDraft(policyType: string, agentRole: string | null): Promise<boolean> {
  try {
    const rows = await systemQuery<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM policy_versions
       WHERE policy_type = $1
         AND ($2::TEXT IS NULL AND agent_role IS NULL OR agent_role = $2)
         AND status IN ('draft', 'candidate')
         AND created_at > NOW() - INTERVAL '7 days'`,
      [policyType, agentRole],
    );
    return (rows[0]?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

// ─── Tokenization Helper ────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
}

function computeJaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter(w => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// ─── Source 1: Prompt Proposals ─────────────────────────────────

async function collectPromptProposals(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  try {
    const reflections = await systemQuery<{
      agent_role: string;
      prompt_suggestions: string[];
    }>(
      `SELECT agent_role, prompt_suggestions
       FROM agent_reflections
       WHERE created_at > NOW() - INTERVAL '7 days'
         AND prompt_suggestions != '{}'
         AND prompt_suggestions IS NOT NULL`,
      [],
    );

    // Group suggestions by agent_role
    const byRole = new Map<string, string[]>();
    for (const r of reflections) {
      const suggestions = Array.isArray(r.prompt_suggestions) ? r.prompt_suggestions : [];
      if (suggestions.length === 0) continue;
      const existing = byRole.get(r.agent_role) ?? [];
      existing.push(...suggestions);
      byRole.set(r.agent_role, existing);
    }

    // For each role, cluster suggestions by keyword similarity
    for (const [role, suggestions] of byRole) {
      const clusters = clusterByTheme(suggestions);

      for (const cluster of clusters) {
        if (cluster.length < PROMPT_THEME_MIN_COUNT) continue;

        if (await hasSimilarDraft('prompt', role)) {
          skipped++;
          continue;
        }

        try {
          await systemQuery(
            `INSERT INTO policy_versions (policy_type, agent_role, content, source, status)
             VALUES ('prompt', $1, $2, 'reflection', 'draft')`,
            [role, JSON.stringify({
              theme: 'prompt_improvement',
              suggestions: cluster,
              source_count: cluster.length,
              collected_at: new Date().toISOString(),
            })],
          );
          created++;
        } catch (err) {
          console.warn(`${LOG_PREFIX} Prompt proposal insert failed:`, (err as Error).message);
        }
      }
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Prompt proposals query failed:`, (err as Error).message);
  }

  return { created, skipped };
}

// ─── Source 2: Constitutional Proposals ─────────────────────────

async function collectConstitutionalProposals(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  try {
    const amendments = await systemQuery<{
      id: string;
      agent_role: string;
      action: string;
      principle_text: string;
      rationale: string;
    }>(
      `SELECT pca.id, pca.agent_role, pca.action, pca.principle_text, pca.rationale
       FROM proposed_constitutional_amendments pca
       WHERE pca.status = 'approved'
         AND NOT EXISTS (
           SELECT 1 FROM policy_versions pv
           WHERE pv.policy_type = 'constitution'
             AND pv.content->>'amendment_id' = pca.id::text
         )`,
      [],
    );

    for (const amendment of amendments) {
      if (await hasSimilarDraft('constitution', null)) {
        skipped++;
        continue;
      }

      try {
        await systemQuery(
          `INSERT INTO policy_versions (policy_type, agent_role, content, source, status)
           VALUES ('constitution', NULL, $1, 'constitutional_amendment', 'draft')`,
          [JSON.stringify({
            amendment_id: amendment.id,
            agent_role: amendment.agent_role,
            action: amendment.action,
            principle_text: amendment.principle_text,
            rationale: amendment.rationale,
            collected_at: new Date().toISOString(),
          })],
        );
        created++;
      } catch (err) {
        console.warn(`${LOG_PREFIX} Constitutional proposal insert failed:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Constitutional proposals query failed:`, (err as Error).message);
  }

  return { created, skipped };
}

// ─── Source 3: Routing Proposals ────────────────────────────────

async function collectRoutingProposals(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  try {
    const failures = await systemQuery<{
      agent_role: string;
      total_runs: number;
      failed_runs: number;
      failure_rate: number;
    }>(
      `SELECT agent_role,
              COUNT(*)::int AS total_runs,
              COUNT(*) FILTER (WHERE was_revised = true OR final_status IN ('aborted', 'failed'))::int AS failed_runs,
              ROUND(
                COUNT(*) FILTER (WHERE was_revised = true OR final_status IN ('aborted', 'failed'))::numeric / COUNT(*),
                2
              )::float AS failure_rate
       FROM task_run_outcomes
       WHERE created_at > NOW() - INTERVAL '${ROUTING_LOOKBACK_DAYS} days'
       GROUP BY agent_role
       HAVING COUNT(*) >= 5
         AND COUNT(*) FILTER (WHERE was_revised = true OR final_status IN ('aborted', 'failed'))::float / COUNT(*) > $1`,
      [ROUTING_FAILURE_RATE],
    );

    for (const f of failures) {
      if (await hasSimilarDraft('routing', f.agent_role)) {
        skipped++;
        continue;
      }

      try {
        await systemQuery(
          `INSERT INTO policy_versions (policy_type, agent_role, content, source, status)
           VALUES ('routing', $1, $2, 'batch_evaluator', 'draft')`,
          [f.agent_role, JSON.stringify({
            reason: 'high_failure_rate',
            agent_role: f.agent_role,
            total_runs: f.total_runs,
            failed_runs: f.failed_runs,
            failure_rate: f.failure_rate,
            lookback_days: ROUTING_LOOKBACK_DAYS,
            collected_at: new Date().toISOString(),
          })],
        );
        created++;
      } catch (err) {
        console.warn(`${LOG_PREFIX} Routing proposal insert failed:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Routing proposals query failed:`, (err as Error).message);
  }

  return { created, skipped };
}

// ─── Source 4: Model Selection Proposals ────────────────────────

async function collectModelSelectionProposals(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  try {
    // Compare avg batch_quality_score per model per role
    // Join task_run_outcomes with company_agents to get the configured model
    const modelPerf = await systemQuery<{
      agent_role: string;
      model: string;
      avg_score: number;
      run_count: number;
    }>(
      `SELECT tro.agent_role,
              COALESCE(ca.model, 'unknown') AS model,
              ROUND(AVG(tro.batch_quality_score)::numeric, 2)::float AS avg_score,
              COUNT(*)::int AS run_count
       FROM task_run_outcomes tro
       LEFT JOIN company_agents ca ON ca.role = tro.agent_role
       WHERE tro.batch_quality_score IS NOT NULL
         AND tro.created_at > NOW() - INTERVAL '30 days'
       GROUP BY tro.agent_role, ca.model
       HAVING COUNT(*) >= $1`,
      [MODEL_MIN_RUNS],
    );

    // Find the best-performing model overall
    const modelAverages = new Map<string, { totalScore: number; totalRuns: number }>();
    for (const perf of modelPerf) {
      const existing = modelAverages.get(perf.model) ?? { totalScore: 0, totalRuns: 0 };
      existing.totalScore += perf.avg_score * perf.run_count;
      existing.totalRuns += perf.run_count;
      modelAverages.set(perf.model, existing);
    }

    const overallAvgByModel = new Map<string, number>();
    for (const [model, data] of modelAverages) {
      overallAvgByModel.set(model, data.totalScore / data.totalRuns);
    }

    // For each role, check if a different model's global average outperforms the role's current score
    for (const perf of modelPerf) {
      for (const [otherModel, otherAvg] of overallAvgByModel) {
        if (otherModel === perf.model || otherModel === 'unknown') continue;
        if (otherAvg - perf.avg_score > MODEL_QUALITY_ADVANTAGE) {
          if (await hasSimilarDraft('model_selection', perf.agent_role)) {
            skipped++;
            continue;
          }

          try {
            await systemQuery(
              `INSERT INTO policy_versions (policy_type, agent_role, content, source, status)
               VALUES ('model_selection', $1, $2, 'batch_evaluator', 'draft')`,
              [perf.agent_role, JSON.stringify({
                current_model: perf.model,
                current_avg_score: perf.avg_score,
                suggested_model: otherModel,
                suggested_avg_score: otherAvg,
                advantage: Math.round((otherAvg - perf.avg_score) * 100) / 100,
                run_count: perf.run_count,
                collected_at: new Date().toISOString(),
              })],
            );
            created++;
          } catch (err) {
            console.warn(`${LOG_PREFIX} Model selection proposal insert failed:`, (err as Error).message);
          }
          break; // only one proposal per role
        }
      }
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Model selection proposals query failed:`, (err as Error).message);
  }

  return { created, skipped };
}

// ─── Source 5: Rubric Proposals ─────────────────────────────────

async function collectRubricProposals(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  try {
    const procedures = await systemQuery<{
      id: string;
      name: string;
      domain: string;
      description: string;
      steps: unknown;
      success_rate: number;
      times_used: number;
      discovered_by: string;
    }>(
      `SELECT sp.id, sp.name, sp.domain, sp.description, sp.steps,
              sp.success_rate, sp.times_used, sp.discovered_by
       FROM shared_procedures sp
       WHERE sp.status = 'active'
         AND sp.success_rate > $1
         AND sp.times_used >= $2
         AND NOT EXISTS (
           SELECT 1 FROM policy_versions pv
           WHERE pv.policy_type = 'rubric'
             AND pv.content->>'procedure_id' = sp.id::text
         )
       LIMIT 20`,
      [RUBRIC_SUCCESS_THRESHOLD, RUBRIC_USAGE_THRESHOLD],
    );

    for (const proc of procedures) {
      if (await hasSimilarDraft('rubric', null)) {
        skipped++;
        continue;
      }

      try {
        await systemQuery(
          `INSERT INTO policy_versions (policy_type, agent_role, content, source, status)
           VALUES ('rubric', NULL, $1, 'reflection', 'draft')`,
          [JSON.stringify({
            procedure_id: proc.id,
            name: proc.name,
            domain: proc.domain,
            description: proc.description,
            steps: proc.steps,
            success_rate: proc.success_rate,
            times_used: proc.times_used,
            discovered_by: proc.discovered_by,
            collected_at: new Date().toISOString(),
          })],
        );
        created++;
      } catch (err) {
        console.warn(`${LOG_PREFIX} Rubric proposal insert failed:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Rubric proposals query failed:`, (err as Error).message);
  }

  return { created, skipped };
}

// ─── Source 6: Knowledge Gap Proposals ──────────────────────────

async function collectKnowledgeGapProposals(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  try {
    const reflections = await systemQuery<{
      agent_role: string;
      knowledge_gaps: string[];
    }>(
      `SELECT agent_role, knowledge_gaps
       FROM agent_reflections
       WHERE created_at > NOW() - INTERVAL '7 days'
         AND knowledge_gaps != '{}'
         AND knowledge_gaps IS NOT NULL`,
      [],
    );

    // Collect all gaps across all agents
    const allGaps: Array<{ role: string; gap: string }> = [];
    for (const r of reflections) {
      const gaps = Array.isArray(r.knowledge_gaps) ? r.knowledge_gaps : [];
      for (const gap of gaps) {
        allGaps.push({ role: r.agent_role, gap });
      }
    }

    // Cluster gaps by keyword similarity
    const gapTexts = allGaps.map(g => g.gap);
    const clusters = clusterByTheme(gapTexts);

    for (const cluster of clusters) {
      if (cluster.length < KNOWLEDGE_GAP_MIN_COUNT) continue;

      // Determine which roles are affected
      const affectedRoles = new Set<string>();
      for (const gapText of cluster) {
        const match = allGaps.find(g => g.gap === gapText);
        if (match) affectedRoles.add(match.role);
      }

      const primaryRole = affectedRoles.size === 1 ? [...affectedRoles][0] : null;

      if (await hasSimilarDraft('prompt', primaryRole)) {
        skipped++;
        continue;
      }

      try {
        await systemQuery(
          `INSERT INTO policy_versions (policy_type, agent_role, content, source, status)
           VALUES ('prompt', $1, $2, 'reflection', 'draft')`,
          [primaryRole, JSON.stringify({
            theme: 'knowledge_gap',
            gaps: cluster,
            affected_roles: [...affectedRoles],
            source_count: cluster.length,
            collected_at: new Date().toISOString(),
          })],
        );
        created++;
      } catch (err) {
        console.warn(`${LOG_PREFIX} Knowledge gap proposal insert failed:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Knowledge gap proposals query failed:`, (err as Error).message);
  }

  return { created, skipped };
}

// ─── Theme Clustering ───────────────────────────────────────────

function clusterByTheme(texts: string[]): string[][] {
  if (texts.length === 0) return [];

  const tokenized = texts.map(t => tokenize(t));
  const assigned = new Set<number>();
  const clusters: string[][] = [];

  for (let i = 0; i < texts.length; i++) {
    if (assigned.has(i)) continue;
    const cluster = [texts[i]];
    assigned.add(i);

    for (let j = i + 1; j < texts.length; j++) {
      if (assigned.has(j)) continue;
      const similarity = computeJaccard(tokenized[i], tokenized[j]);
      if (similarity > 0.3) {
        cluster.push(texts[j]);
        assigned.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}
