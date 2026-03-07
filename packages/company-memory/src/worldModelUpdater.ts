/**
 * World Model Updater — Updates agent self-models after grading.
 *
 * Implements the REFLECTION → LEARNING → IMPROVEMENT loop:
 *   1. EXECUTE — Agent performs task (existing)
 *   2. REFLECT — Agent self-assesses against rubric
 *   3. GRADE — Orchestrator evaluates against same rubric
 *   4. UPDATE — This module evolves the agent's world model
 *
 * The updated model feeds back into the next run's system prompt.
 */

import type {
  CompanyAgentRole,
  AgentWorldModel,
  StructuredReflection,
  OrchestratorGrade,
  WorldModelDimension,
  ImprovementGoal,
} from '@glyphor/agent-runtime';
import type { GlyphorEventBus } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import type { SharedMemoryLoader } from './sharedMemoryLoader.js';

// ─── Batch Outcome Types ────────────────────────────────────────

export interface BatchOutcomeAggregates {
  avgBatchQualityScore: number;
  firstTimeAcceptRate: number;
  revisionRate: number;
  blockerRate: number;
  abortRate: number;
  avgEfficiency: number;
  totalEvaluated: number;
}

export class WorldModelUpdater {
  constructor(
    private sharedMemory: SharedMemoryLoader,
    private glyphorEventBus?: GlyphorEventBus,
  ) {}

  /**
   * Update an agent's world model after an orchestrator grades their work.
   */
  async updateFromGrade(
    agentRole: CompanyAgentRole,
    reflection: StructuredReflection,
    grade: OrchestratorGrade,
    rubricPassingScore: number,
  ): Promise<void> {
    const existing = await this.sharedMemory.getWorldModel(agentRole);

    const model: Partial<AgentWorldModel> = {
      agentRole,
      strengths: existing?.strengths ?? [],
      weaknesses: existing?.weaknesses ?? [],
      failurePatterns: existing?.failurePatterns ?? [],
      taskTypeScores: existing?.taskTypeScores ?? {},
      lastPredictions: existing?.lastPredictions ?? [],
      predictionAccuracy: existing?.predictionAccuracy ?? 0.5,
      improvementGoals: existing?.improvementGoals ?? [],
      preferredApproaches: existing?.preferredApproaches ?? {},
      rubricVersion: existing?.rubricVersion ?? 1,
    };

    // Update task_type_scores
    const taskType = reflection.taskType;
    const current = model.taskTypeScores![taskType] ?? {
      avgScore: 0, count: 0, trend: 'stable' as const,
    };
    current.avgScore = rollingAverage(current.avgScore, grade.weightedTotal, current.count);
    current.count++;
    current.trend = computeTrend(current.avgScore, current.count);
    model.taskTypeScores![taskType] = current;

    // Update prediction accuracy
    if (reflection.predictedScore > 0) {
      const accuracy = 1 - Math.abs(reflection.predictedScore - grade.weightedTotal) / 5;
      model.predictionAccuracy = rollingAverage(
        model.predictionAccuracy!, accuracy, model.lastPredictions!.length,
      );
      model.lastPredictions!.push({
        predicted: reflection.predictedScore,
        actual: grade.weightedTotal,
        delta: reflection.predictedScore - grade.weightedTotal,
        timestamp: new Date().toISOString(),
      });
      // Keep only last 20 predictions
      if (model.lastPredictions!.length > 20) {
        model.lastPredictions = model.lastPredictions!.slice(-20);
      }
    }

    // Update strengths/weaknesses from rubric scores
    for (const dim of grade.rubricScores) {
      if (dim.orchestratorScore >= 4) {
        addOrReinforce(model.strengths!, dim.dimension, dim.evidence);
        // Remove from weaknesses if present
        model.weaknesses = model.weaknesses!.filter(w => w.dimension !== dim.dimension);
      } else if (dim.orchestratorScore <= 2) {
        addOrReinforce(model.weaknesses!, dim.dimension, dim.feedback);
      }
    }

    // Detect failure patterns (3+ occurrences of same weakness)
    model.failurePatterns = detectRecurringPatterns(model.weaknesses!);

    // Generate improvement goals if score below threshold
    if (grade.weightedTotal < rubricPassingScore) {
      model.improvementGoals = generateGoals(
        model.weaknesses!, model.failurePatterns!, grade,
      );
    }

    // Record preferred approach if score was high
    if (grade.weightedTotal >= 4.0 && reflection.approachUsed) {
      model.preferredApproaches = model.preferredApproaches ?? {};
      model.preferredApproaches[taskType] = reflection.approachUsed;
    }

    await this.sharedMemory.saveWorldModel(agentRole, model);

    // Emit learning signal for the policy proposal pipeline
    if (this.glyphorEventBus && ((reflection.promptSuggestions?.length ?? 0) > 0 || (reflection.knowledgeGaps?.length ?? 0) > 0)) {
      try {
        await this.glyphorEventBus!.emit({
          type: 'learning.proposal_signal',
          source: 'system',
          payload: {
            prompt_suggestions: reflection.promptSuggestions ?? [],
            knowledge_gaps: reflection.knowledgeGaps ?? [],
            run_id: reflection.runId,
            quality_score: reflection.qualityScore ?? reflection.predictedScore,
            agent_role: agentRole,
          },
        });
      } catch (err) {
        console.warn('[WorldModelUpdater] Failed to emit learning.proposal_signal:', (err as Error).message);
      }
    }
  }

  /**
   * Update an agent's world model from batch-evaluated task outcomes.
   * Called after the batch evaluator scores a set of outcomes.
   */
  async updateFromBatchOutcomes(agentRole: CompanyAgentRole): Promise<BatchOutcomeAggregates | null> {
    try {
      const aggregates = await computeBatchAggregates(agentRole);
      if (!aggregates || aggregates.totalEvaluated === 0) return null;

      const existing = await this.sharedMemory.getWorldModel(agentRole);
      const model: Partial<AgentWorldModel> = {
        agentRole,
        strengths: existing?.strengths ?? [],
        weaknesses: existing?.weaknesses ?? [],
        failurePatterns: existing?.failurePatterns ?? [],
        taskTypeScores: existing?.taskTypeScores ?? {},
        lastPredictions: existing?.lastPredictions ?? [],
        predictionAccuracy: existing?.predictionAccuracy ?? 0.5,
        improvementGoals: existing?.improvementGoals ?? [],
        preferredApproaches: existing?.preferredApproaches ?? {},
        rubricVersion: existing?.rubricVersion ?? 1,
      };

      // Merge batch aggregates into task_type_scores under a synthetic "batch_outcomes" key
      const batchScoreEntry = model.taskTypeScores!['batch_outcomes'] ?? {
        avgScore: 0, count: 0, trend: 'stable' as const,
      };
      batchScoreEntry.avgScore = rollingAverage(
        batchScoreEntry.avgScore, aggregates.avgBatchQualityScore, batchScoreEntry.count,
      );
      batchScoreEntry.count = aggregates.totalEvaluated;
      batchScoreEntry.trend = computeTrend(batchScoreEntry.avgScore, batchScoreEntry.count);
      model.taskTypeScores!['batch_outcomes'] = batchScoreEntry;

      // Store detailed aggregates as additional keys in task_type_scores
      model.taskTypeScores!['batch_first_time_accept'] = {
        avgScore: aggregates.firstTimeAcceptRate * 5, count: aggregates.totalEvaluated, trend: 'stable',
      };
      model.taskTypeScores!['batch_efficiency'] = {
        avgScore: Math.max(1, Math.min(5, 5 - (aggregates.avgEfficiency / 5))),
        count: aggregates.totalEvaluated, trend: 'stable',
      };

      // Update strengths based on batch patterns
      if (aggregates.firstTimeAcceptRate > 0.8) {
        addOrReinforce(model.strengths!, 'first_time_acceptance',
          `${(aggregates.firstTimeAcceptRate * 100).toFixed(0)}% of submissions accepted without revision`);
      }
      if (aggregates.avgBatchQualityScore >= 4.0) {
        addOrReinforce(model.strengths!, 'batch_quality',
          `Avg batch quality score: ${aggregates.avgBatchQualityScore.toFixed(1)}/5.0`);
      }

      // Update weaknesses based on batch patterns
      if (aggregates.revisionRate > 0.4) {
        addOrReinforce(model.weaknesses!, 'high_revision_rate',
          `${(aggregates.revisionRate * 100).toFixed(0)}% of submissions required revision`);
      }
      if (aggregates.avgBatchQualityScore < 3.0) {
        addOrReinforce(model.weaknesses!, 'low_batch_quality',
          `Avg batch quality score: ${aggregates.avgBatchQualityScore.toFixed(1)}/5.0`);
      }

      // Update failure patterns based on batch patterns
      if (aggregates.abortRate > 0.2) {
        const existing = model.failurePatterns!.find(fp => fp.pattern === 'high_abort_rate');
        if (existing) {
          existing.occurrences++;
          existing.lastSeen = new Date().toISOString();
        } else {
          model.failurePatterns!.push({
            pattern: 'high_abort_rate',
            occurrences: 1,
            lastSeen: new Date().toISOString(),
          });
        }
      }
      if (aggregates.blockerRate > 0.3) {
        const existing = model.failurePatterns!.find(fp => fp.pattern === 'frequent_blockers');
        if (existing) {
          existing.occurrences++;
          existing.lastSeen = new Date().toISOString();
        } else {
          model.failurePatterns!.push({
            pattern: 'frequent_blockers',
            occurrences: 1,
            lastSeen: new Date().toISOString(),
          });
        }
      }

      await this.sharedMemory.saveWorldModel(agentRole, model);
      return aggregates;
    } catch (err) {
      console.warn('[WorldModelUpdater] updateFromBatchOutcomes failed for', agentRole, (err as Error).message);
      return null;
    }
  }

  /**
   * Initialize a world model for an agent that doesn't have one yet.
   */
  async initializeForAgent(agentRole: CompanyAgentRole): Promise<void> {
    const existing = await this.sharedMemory.getWorldModel(agentRole);
    if (existing) return;

    await this.sharedMemory.saveWorldModel(agentRole, {
      agentRole,
      strengths: [],
      weaknesses: [],
      taskTypeScores: {},
      lastPredictions: [],
      predictionAccuracy: 0.5,
      improvementGoals: [],
      rubricVersion: 1,
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function rollingAverage(current: number, newValue: number, count: number): number {
  if (count === 0) return newValue;
  // Exponential moving average with increasing stability
  const alpha = Math.max(0.1, 1 / (count + 1));
  return current * (1 - alpha) + newValue * alpha;
}

function computeTrend(avgScore: number, count: number): 'improving' | 'stable' | 'declining' {
  if (count < 3) return 'stable';
  // Simple heuristic — would be refined with actual score history
  if (avgScore >= 3.5) return 'improving';
  if (avgScore <= 2.5) return 'declining';
  return 'stable';
}

function addOrReinforce(list: WorldModelDimension[], dimension: string, evidence: string): void {
  const existing = list.find(d => d.dimension === dimension);
  if (existing) {
    existing.evidence = evidence;
    existing.confidence = Math.min(1.0, existing.confidence + 0.1);
  } else {
    list.push({ dimension, evidence, confidence: 0.6 });
  }
  // Cap at 10 items per list
  if (list.length > 10) {
    list.sort((a, b) => b.confidence - a.confidence);
    list.length = 10;
  }
}

function detectRecurringPatterns(
  weaknesses: WorldModelDimension[],
): { pattern: string; occurrences: number; lastSeen: string }[] {
  // Group by dimension — weaknesses that appear repeatedly become failure patterns
  const counts = new Map<string, number>();
  for (const w of weaknesses) {
    counts.set(w.dimension, (counts.get(w.dimension) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .map(([pattern, count]) => ({
      pattern,
      occurrences: count,
      lastSeen: new Date().toISOString(),
    }));
}

function generateGoals(
  weaknesses: WorldModelDimension[],
  failurePatterns: { pattern: string; occurrences: number }[],
  grade: OrchestratorGrade,
): ImprovementGoal[] {
  const goals: ImprovementGoal[] = [];

  // Create goals from lowest-scoring rubric dimensions
  const sorted = [...grade.rubricScores].sort((a, b) => a.orchestratorScore - b.orchestratorScore);
  for (const dim of sorted.slice(0, 3)) {
    if (dim.orchestratorScore < 3.0) {
      goals.push({
        dimension: dim.dimension,
        currentScore: dim.orchestratorScore,
        targetScore: Math.min(5.0, dim.orchestratorScore + 1.5),
        strategy: dim.feedback,
        progress: 0,
      });
    }
  }

  return goals;
}

// ─── Batch Outcome Aggregation ────────────────────────────────

interface OutcomeRow {
  batch_quality_score: number;
  final_status: string;
  turn_count: number;
  was_accepted: boolean | null;
  was_revised: boolean | null;
  revision_count: number | null;
  created_at: string;
}

async function computeBatchAggregates(agentRole: string): Promise<BatchOutcomeAggregates | null> {
  const rows = await systemQuery<OutcomeRow>(
    `SELECT batch_quality_score, final_status, turn_count,
            was_accepted, was_revised, revision_count, created_at
     FROM task_run_outcomes
     WHERE agent_role = $1
       AND batch_evaluated_at IS NOT NULL
       AND created_at > NOW() - INTERVAL '30 days'`,
    [agentRole],
  );

  if (rows.length === 0) return null;

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  let weightedScoreSum = 0;
  let weightSum = 0;
  let firstTimeAccepts = 0;
  let revisions = 0;
  let blockers = 0;
  let aborts = 0;
  let acceptedTurnSum = 0;
  let acceptedCount = 0;

  for (const r of rows) {
    // Weighted avg: 7d scores weighted 2x vs 8-30d
    const age = now - new Date(r.created_at).getTime();
    const weight = age < sevenDaysMs ? 2 : 1;
    weightedScoreSum += Number(r.batch_quality_score) * weight;
    weightSum += weight;

    if (r.was_accepted === true && (r.revision_count ?? 0) === 0) firstTimeAccepts++;
    if (r.was_revised === true || (r.revision_count ?? 0) > 0) revisions++;
    if (r.final_status === 'flagged_blocker') blockers++;
    if (r.final_status === 'aborted' || r.final_status === 'failed') aborts++;
    if (r.was_accepted === true) {
      acceptedTurnSum += r.turn_count;
      acceptedCount++;
    }
  }

  return {
    avgBatchQualityScore: weightSum > 0 ? weightedScoreSum / weightSum : 0,
    firstTimeAcceptRate: rows.length > 0 ? firstTimeAccepts / rows.length : 0,
    revisionRate: rows.length > 0 ? revisions / rows.length : 0,
    blockerRate: rows.length > 0 ? blockers / rows.length : 0,
    abortRate: rows.length > 0 ? aborts / rows.length : 0,
    avgEfficiency: acceptedCount > 0 ? acceptedTurnSum / acceptedCount : 0,
    totalEvaluated: rows.length,
  };
}
