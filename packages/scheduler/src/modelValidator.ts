/**
 * modelValidator.ts
 * ---------------------------------------------------------------------------
 * Runs on server startup.
 * Hard-errors if disabled models are still in active use.
 * Emits warnings for suspicious but non-fatal configuration drift.
 * ---------------------------------------------------------------------------
 */

import { ALL_ACTIVE_MODELS, isDisabled, MODEL_CONFIG } from '@glyphor/shared';
import { systemQuery } from '@glyphor/shared/db';

export interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

type ActiveAgentRow = { name: string | null; role: string; model: string };
type RecentRunRow = { model_used: string; count: number | string };

export async function validateModelConfig(): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1) Disabled models must not be assigned to active agents.
  const agentsOnExplicitModels = await systemQuery<ActiveAgentRow>(
    `SELECT name, role, model
       FROM company_agents
      WHERE status = 'active'
        AND model IS NOT NULL
        AND model <> 'model-router'`,
  );

  for (const agent of agentsOnExplicitModels) {
    if (isDisabled(agent.model)) {
      errors.push(
        `DISABLED MODEL IN USE: agent "${agent.name ?? agent.role}" (${agent.role}) uses disabled model "${agent.model}".`,
      );
    }
  }

  // 2) Fallback targets must not be disabled.
  for (const [model, fallback] of Object.entries(MODEL_CONFIG.fallbacks as Record<string, string>)) {
    if (isDisabled(fallback)) {
      errors.push(
        `INVALID FALLBACK: "${model}" falls back to disabled model "${fallback}".`,
      );
    }
  }

  // 3) Disabled models should not appear in recent execution.
  const recentRuns = await systemQuery<RecentRunRow>(
    `SELECT model_used, COUNT(*) AS count
       FROM agent_runs
      WHERE created_at > NOW() - INTERVAL '24 hours'
        AND model_used IS NOT NULL
   GROUP BY model_used`,
  );

  for (const row of recentRuns) {
    if (isDisabled(row.model_used)) {
      const count = typeof row.count === 'string' ? parseInt(row.count, 10) : row.count;
      errors.push(
        `DISABLED MODEL STILL EXECUTING: "${row.model_used}" ran ${Number.isFinite(count) ? count : row.count} time(s) in the last 24h.`,
      );
    }
  }

  // 4) Preview models should have fallback coverage.
  for (const model of ALL_ACTIVE_MODELS) {
    const hasFallback = Boolean((MODEL_CONFIG.fallbacks as Record<string, string>)[model]);
    if (model.includes('preview') && !hasFallback) {
      warnings.push(
        `PREVIEW MODEL WITHOUT FALLBACK: "${model}" has no fallback configured.`,
      );
    }
  }

  // 5) Warn on stale config review metadata.
  const lastReview = new Date(MODEL_CONFIG.meta.lastReviewedAt);
  const daysSinceReview = (Date.now() - lastReview.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceReview > 35) {
    warnings.push(
      `MODEL CONFIG STALE: last review was ${Math.floor(daysSinceReview)} days ago.`,
    );
  }

  for (const message of errors) {
    console.error(`[ModelValidator] ${message}`);
  }
  for (const message of warnings) {
    console.warn(`[ModelValidator] ${message}`);
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log('[ModelValidator] All model config checks passed.');
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}