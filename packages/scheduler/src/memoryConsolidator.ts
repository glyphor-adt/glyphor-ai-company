/**
 * Memory Consolidator — Daily raw → distilled memory promotion
 *
 * Runs nightly (3 AM UTC) to promote high-value raw memories into
 * distilled organizational knowledge and draft operative policies.
 *
 * Phases:
 *  1. Identify promotion candidates (DB queries only, no LLM)
 *  2. Deduplicate against existing company_knowledge
 *  3. Promote via batch LLM distillation → company_knowledge
 *  4. Promote proven procedures → policy_versions (draft)
 */

import { systemQuery } from '@glyphor/shared/db';
import { getTierModel } from '@glyphor/shared';
import { getRedisCache, ModelClient } from '@glyphor/agent-runtime';

// ─── Types ──────────────────────────────────────────────────────

export interface ConsolidationReport {
  candidates_found: number;
  promoted: number;
  merged: number;
  skipped: number;
  errors: number;
}

interface EpisodeCandidate {
  id: string;
  source_table: 'shared_episodes';
  summary: string;
  author_agent: string;
  domains: string[];
  tags: string[];
}

interface ReflectionCandidate {
  id: string;
  source_table: 'agent_reflections';
  summary: string;
  agent_role: string;
  prompt_suggestions: string[];
  knowledge_gaps: string[];
}

interface OutcomeCandidate {
  source_table: 'task_run_outcomes';
  agent_role: string;
  total_runs: number;
  abort_count: number;
  abort_rate: number;
}

type PromotionCandidate = EpisodeCandidate | ReflectionCandidate | OutcomeCandidate;

interface ExistingKnowledge {
  id: string;
  content: string;
  tags: string[];
}

// ─── Configuration ──────────────────────────────────────────────

const LOCK_KEY = 'memory-consolidation-lock';
const LOCK_TTL_SECONDS = 30 * 60; // 30 minutes
const EPISODE_SIG_THRESHOLD = 0.7;
const REFLECTION_QUALITY_THRESHOLD = 70;
const ABORT_RATE_THRESHOLD = 0.3;
const PROCEDURE_SUCCESS_THRESHOLD = 0.8;
const PROCEDURE_USAGE_THRESHOLD = 5;
const BATCH_SIZE = 20;
const DISTILL_MODEL = getTierModel('default');

// ─── Main Entry Point ───────────────────────────────────────────

export async function consolidateMemory(): Promise<ConsolidationReport> {
  const report: ConsolidationReport = {
    candidates_found: 0,
    promoted: 0,
    merged: 0,
    skipped: 0,
    errors: 0,
  };

  // Acquire Redis lock to prevent concurrent runs
  const cache = getRedisCache();
  const existingLock = await cache.get<string>(LOCK_KEY);
  if (existingLock) {
    console.log('[MemoryConsolidator] Skipping — another consolidation is in progress');
    return report;
  }
  await cache.set(LOCK_KEY, new Date().toISOString(), LOCK_TTL_SECONDS);

  try {
    // PHASE 1: Identify promotion candidates
    const candidates = await identifyCandidates();
    report.candidates_found = candidates.length;

    if (candidates.length === 0) {
      console.log('[MemoryConsolidator] No candidates found');
      return report;
    }

    // PHASE 2 & 3: Deduplicate and promote
    const existing = await fetchExistingKnowledge();
    const novel: PromotionCandidate[] = [];
    const toMerge: Array<{ candidate: PromotionCandidate; existingId: string }> = [];

    for (const candidate of candidates) {
      const candidateText = getCandidateText(candidate);
      const match = findBestMatch(candidateText, existing);

      if (match && match.similarity > 0.9) {
        report.skipped++;
      } else if (match && match.similarity > 0.75) {
        toMerge.push({ candidate, existingId: match.id });
      } else {
        novel.push(candidate);
      }
    }

    // Promote novel candidates in batches via LLM
    for (let i = 0; i < novel.length; i += BATCH_SIZE) {
      const batch = novel.slice(i, i + BATCH_SIZE);
      try {
        const promoted = await distillAndPromote(batch);
        report.promoted += promoted;
      } catch (err) {
        console.error('[MemoryConsolidator] Batch distillation error:', (err as Error).message);
        report.errors++;
      }
    }

    // Merge partially-similar candidates (strengthen existing entries)
    for (const { candidate, existingId } of toMerge) {
      try {
        await mergeCandidate(candidate, existingId);
        report.merged++;
      } catch (err) {
        console.error('[MemoryConsolidator] Merge error:', (err as Error).message);
        report.errors++;
      }
    }

    // PHASE 4: Promote proven procedures → policy_versions (draft)
    try {
      const policiesCreated = await promoteToOperative();
      report.promoted += policiesCreated;
    } catch (err) {
      console.error('[MemoryConsolidator] Operative promotion error:', (err as Error).message);
      report.errors++;
    }

    console.log('[MemoryConsolidator] Complete:', JSON.stringify(report));
  } finally {
    // Release lock
    await cache.del(LOCK_KEY);
  }

  return report;
}

// ─── Phase 1: Identify Candidates ───────────────────────────────

async function identifyCandidates(): Promise<PromotionCandidate[]> {
  const candidates: PromotionCandidate[] = [];
  const now = new Date();
  const h48Ago = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const h24Ago = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const d7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 1a. High-significance episodes from last 24-48h, not already tracked
  try {
    const episodes = await systemQuery<{
      id: string; summary: string; author_agent: string; domains: string[]; tags: string[];
    }>(
      `SELECT se.id, se.summary, se.author_agent, se.domains, se.tags
       FROM shared_episodes se
       WHERE se.significance_score >= $1
         AND se.created_at >= $2
         AND se.created_at <= $3
         AND NOT EXISTS (
           SELECT 1 FROM memory_lifecycle ml
           WHERE ml.source_table = 'shared_episodes' AND ml.source_id = se.id
         )
       ORDER BY se.significance_score DESC
       LIMIT 100`,
      [EPISODE_SIG_THRESHOLD, h48Ago, h24Ago],
    );
    for (const e of episodes) {
      candidates.push({
        id: e.id,
        source_table: 'shared_episodes',
        summary: e.summary,
        author_agent: e.author_agent,
        domains: e.domains ?? [],
        tags: e.tags ?? [],
      });
    }
  } catch (err) {
    console.warn('[MemoryConsolidator] Episode query failed:', (err as Error).message);
  }

  // 1b. High-quality reflections with actionable insights
  try {
    const reflections = await systemQuery<{
      id: string; summary: string; agent_role: string;
      prompt_suggestions: string[]; knowledge_gaps: string[];
    }>(
      `SELECT ar.id, ar.summary, ar.agent_role, ar.prompt_suggestions, ar.knowledge_gaps
       FROM agent_reflections ar
       WHERE ar.quality_score >= $1
         AND ar.created_at >= $2
         AND (ar.prompt_suggestions != '{}' OR ar.knowledge_gaps != '{}')
         AND NOT EXISTS (
           SELECT 1 FROM memory_lifecycle ml
           WHERE ml.source_table = 'agent_reflections' AND ml.source_id = ar.id
         )
       ORDER BY ar.quality_score DESC
       LIMIT 50`,
      [REFLECTION_QUALITY_THRESHOLD, h48Ago],
    );
    for (const r of reflections) {
      candidates.push({
        id: r.id,
        source_table: 'agent_reflections',
        summary: r.summary,
        agent_role: r.agent_role,
        prompt_suggestions: r.prompt_suggestions ?? [],
        knowledge_gaps: r.knowledge_gaps ?? [],
      });
    }
  } catch (err) {
    console.warn('[MemoryConsolidator] Reflection query failed:', (err as Error).message);
  }

  // 1c. Roles with high abort rates over last 7 days
  try {
    const outcomes = await systemQuery<{
      agent_role: string; total_runs: number; abort_count: number;
    }>(
      `SELECT agent_role,
              COUNT(*)::int AS total_runs,
              COUNT(*) FILTER (WHERE final_status = 'aborted')::int AS abort_count
       FROM task_run_outcomes
       WHERE created_at >= $1
       GROUP BY agent_role
       HAVING COUNT(*) >= 3
         AND COUNT(*) FILTER (WHERE final_status = 'aborted')::float / COUNT(*) > $2`,
      [d7Ago, ABORT_RATE_THRESHOLD],
    );
    for (const o of outcomes) {
      candidates.push({
        source_table: 'task_run_outcomes',
        agent_role: o.agent_role,
        total_runs: o.total_runs,
        abort_count: o.abort_count,
        abort_rate: o.abort_count / o.total_runs,
      });
    }
  } catch (err) {
    console.warn('[MemoryConsolidator] Outcome query failed:', (err as Error).message);
  }

  return candidates;
}

// ─── Phase 2: Deduplication Helpers ─────────────────────────────

async function fetchExistingKnowledge(): Promise<ExistingKnowledge[]> {
  try {
    return await systemQuery<ExistingKnowledge>(
      "SELECT id, content, tags FROM company_knowledge WHERE status = 'active' ORDER BY created_at DESC LIMIT 500",
      [],
    );
  } catch {
    return [];
  }
}

function getCandidateText(candidate: PromotionCandidate): string {
  if (candidate.source_table === 'shared_episodes') {
    return `${candidate.summary} ${candidate.domains.join(' ')} ${candidate.tags.join(' ')}`;
  }
  if (candidate.source_table === 'agent_reflections') {
    return `${candidate.summary} ${candidate.prompt_suggestions.join(' ')} ${candidate.knowledge_gaps.join(' ')}`;
  }
  // task_run_outcomes
  return `Agent ${candidate.agent_role} has ${(candidate.abort_rate * 100).toFixed(0)}% abort rate over ${candidate.total_runs} runs`;
}

function findBestMatch(
  text: string,
  existing: ExistingKnowledge[],
): { id: string; similarity: number } | null {
  const words = new Set(tokenize(text));
  if (words.size === 0) return null;

  let best: { id: string; similarity: number } | null = null;

  for (const entry of existing) {
    const entryWords = new Set(tokenize(`${entry.content} ${entry.tags.join(' ')}`));
    if (entryWords.size === 0) continue;

    const intersection = new Set([...words].filter(w => entryWords.has(w)));
    const union = new Set([...words, ...entryWords]);
    const similarity = intersection.size / union.size; // Jaccard similarity

    if (!best || similarity > best.similarity) {
      best = { id: entry.id, similarity };
    }
  }

  return best;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
}

// ─── Phase 3: Distill & Promote ─────────────────────────────────

async function distillAndPromote(candidates: PromotionCandidate[]): Promise<number> {
  const summaryBlock = candidates.map((c, i) => {
    const text = getCandidateText(c);
    const source = c.source_table === 'shared_episodes' ? `episode by ${c.author_agent}`
      : c.source_table === 'agent_reflections' ? `reflection by ${c.agent_role}`
      : `outcome pattern for ${c.agent_role}`;
    return `[${i + 1}] (${source}) ${text}`;
  }).join('\n');

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });

  const response = await modelClient.generate({
    model: DISTILL_MODEL,
    systemInstruction: `You distill operational observations into concise organizational lessons. Return a JSON array (no markdown fences):
[{
  "lesson": "<1-2 sentence concise organizational lesson>",
  "evidence": "<brief supporting evidence from the observations>",
  "knowledge_type": "<one of: cross_functional, causal_link, risk, opportunity, constraint, capability>",
  "tags": ["<relevant tags>"],
  "departments": ["<affected departments>"],
  "confidence": <0.0-1.0>
}]
If no meaningful lessons can be extracted, return [].`,
    contents: [{
      role: 'user',
      content: `Distill these ${candidates.length} operational observations into concise organizational lessons:\n\n${summaryBlock}`,
      timestamp: Date.now(),
    }],
    temperature: 0.2,
    maxTokens: 2048,
  });

  let lessons: Array<{
    lesson: string;
    evidence: string;
    knowledge_type: string;
    tags: string[];
    departments: string[];
    confidence: number;
  }> = [];

  try {
    const cleaned = (response.text ?? '')
      .replace(/```json?\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) lessons = parsed;
  } catch {
    return 0;
  }

  const VALID_TYPES = new Set([
    'cross_functional', 'causal_link', 'policy',
    'constraint', 'capability', 'risk', 'opportunity',
  ]);

  let promoted = 0;
  for (const lesson of lessons) {
    try {
      const knowledgeType = VALID_TYPES.has(lesson.knowledge_type)
        ? lesson.knowledge_type
        : 'cross_functional';

      const [inserted] = await systemQuery<{ id: string }>(
        `INSERT INTO company_knowledge (knowledge_type, content, evidence, discovered_by, contributing_agents, discovery_context, departments_affected, confidence, tags, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
         RETURNING id`,
        [
          knowledgeType,
          lesson.lesson,
          lesson.evidence,
          'memory-consolidator',
          getCandidateAgents(candidates),
          'nightly_memory_consolidation',
          lesson.departments ?? [],
          Math.max(0, Math.min(1, lesson.confidence ?? 0.7)),
          lesson.tags ?? [],
        ],
      );

      // Track in memory_lifecycle for each source candidate
      for (const candidate of candidates) {
        if (candidate.source_table === 'task_run_outcomes') continue; // no single source_id
        const sourceId = 'id' in candidate ? candidate.id : undefined;
        if (!sourceId) continue;

        await systemQuery(
          `INSERT INTO memory_lifecycle (source_table, source_id, current_layer, promoted_to_table, promoted_to_id, promoted_at, promoted_by)
           VALUES ($1, $2, 'distilled', 'company_knowledge', $3, NOW(), 'memory_consolidator')
           ON CONFLICT (source_table, source_id) DO UPDATE SET
             current_layer = 'distilled', promoted_to_table = 'company_knowledge',
             promoted_to_id = $3, promoted_at = NOW(), promoted_by = 'memory_consolidator'`,
          [candidate.source_table, sourceId, inserted.id],
        );
      }

      promoted++;
    } catch (err) {
      console.warn('[MemoryConsolidator] Insert knowledge failed:', (err as Error).message);
    }
  }

  return promoted;
}

function getCandidateAgents(candidates: PromotionCandidate[]): string[] {
  const agents = new Set<string>();
  for (const c of candidates) {
    if (c.source_table === 'shared_episodes') agents.add(c.author_agent);
    else if (c.source_table === 'agent_reflections') agents.add(c.agent_role);
    else agents.add(c.agent_role);
  }
  return [...agents];
}

// ─── Phase 3 (merge): Strengthen Existing Knowledge ─────────────

async function mergeCandidate(candidate: PromotionCandidate, existingId: string): Promise<void> {
  await systemQuery(
    `UPDATE company_knowledge
     SET times_validated = times_validated + 1,
         last_validated_at = NOW(),
         confidence = LEAST(confidence + 0.05, 1.0)
     WHERE id = $1`,
    [existingId],
  );

  // Track in memory_lifecycle
  if (candidate.source_table !== 'task_run_outcomes' && 'id' in candidate) {
    await systemQuery(
      `INSERT INTO memory_lifecycle (source_table, source_id, current_layer, promoted_to_table, promoted_to_id, promoted_at, promoted_by)
       VALUES ($1, $2, 'distilled', 'company_knowledge', $3, NOW(), 'memory_consolidator')
       ON CONFLICT (source_table, source_id) DO UPDATE SET
         current_layer = 'distilled', promoted_to_table = 'company_knowledge',
         promoted_to_id = $3, promoted_at = NOW(), promoted_by = 'memory_consolidator'`,
      [candidate.source_table, candidate.id, existingId],
    );
  }
}

// ─── Phase 4: Promote Distilled → Operative ─────────────────────

async function promoteToOperative(): Promise<number> {
  // Find proven procedures ready for policy promotion
  const procedures = await systemQuery<{
    id: string; name: string; domain: string; description: string;
    steps: unknown; success_rate: number; times_used: number;
  }>(
    `SELECT sp.id, sp.name, sp.domain, sp.description, sp.steps, sp.success_rate, sp.times_used
     FROM shared_procedures sp
     WHERE sp.status = 'active'
       AND sp.success_rate > $1
       AND sp.times_used >= $2
       AND NOT EXISTS (
         SELECT 1 FROM memory_lifecycle ml
         WHERE ml.source_table = 'shared_procedures' AND ml.source_id = sp.id AND ml.current_layer = 'operative'
       )
     LIMIT 10`,
    [PROCEDURE_SUCCESS_THRESHOLD, PROCEDURE_USAGE_THRESHOLD],
  );

  let count = 0;
  for (const proc of procedures) {
    try {
      const [policy] = await systemQuery<{ id: string }>(
        `INSERT INTO policy_versions (policy_type, agent_role, content, source, status)
         VALUES ('routing', NULL, $1, 'reflection', 'draft')
         RETURNING id`,
        [JSON.stringify({
          procedure_id: proc.id,
          name: proc.name,
          domain: proc.domain,
          description: proc.description,
          steps: proc.steps,
          success_rate: proc.success_rate,
          times_used: proc.times_used,
        })],
      );

      await systemQuery(
        `INSERT INTO memory_lifecycle (source_table, source_id, current_layer, promoted_to_table, promoted_to_id, promoted_at, promoted_by)
         VALUES ('shared_procedures', $1, 'operative', 'policy_versions', $2, NOW(), 'memory_consolidator')
         ON CONFLICT (source_table, source_id) DO UPDATE SET
           current_layer = 'operative', promoted_to_table = 'policy_versions',
           promoted_to_id = $2, promoted_at = NOW(), promoted_by = 'memory_consolidator'`,
        [proc.id, policy.id],
      );

      count++;
    } catch (err) {
      console.warn('[MemoryConsolidator] Policy promotion failed:', (err as Error).message);
    }
  }

  return count;
}
