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
import type { SharedMemoryLoader } from './sharedMemoryLoader.js';

export class WorldModelUpdater {
  constructor(
    private sharedMemory: SharedMemoryLoader,
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
