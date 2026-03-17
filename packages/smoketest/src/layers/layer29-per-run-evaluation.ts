/**
 * Layer 29 — Per-Run Agent Evaluation
 *
 * Statically verifies that every agent task completion is immediately
 * evaluated for quality using deterministic run-time signals, and that the
 * batch evaluator builds on this baseline with delayed acceptance/revision
 * signals rather than starting from a fixed default.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { LayerResult, SmokeTestConfig, TestResult } from '../types.js';
import { runTest } from '../utils/test.js';

function findMonorepoRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  let dir = dirname(__filename);
  while (dir !== dirname(dir)) {
    if (existsSync(resolve(dir, 'turbo.json'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

const REPO_ROOT = findMonorepoRoot();

function readRepoFile(...segments: string[]): string {
  const filePath = resolve(REPO_ROOT, ...segments);
  if (!existsSync(filePath)) {
    throw new Error(`Expected file not found: ${segments.join('/')}`);
  }
  return readFileSync(filePath, 'utf8');
}

function assertIncludes(content: string, needle: string, label: string): void {
  if (!content.includes(needle)) {
    throw new Error(`Missing expected ${label}: ${needle}`);
  }
}

export async function run(_config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  tests.push(
    await runTest('T29.1', 'Per-Run Quality Score Migration', async () => {
      const migration = readRepoFile('db', 'migrations', '20260317140000_per_run_quality_score.sql');

      assertIncludes(migration, 'per_run_quality_score', 'per-run score column');
      assertIncludes(migration, 'per_run_evaluation_notes', 'per-run evaluation notes column');
      assertIncludes(migration, 'ADD COLUMN IF NOT EXISTS per_run_quality_score', 'per-run score migration statement');
      assertIncludes(migration, 'ADD COLUMN IF NOT EXISTS per_run_evaluation_notes', 'per-run notes migration statement');

      return 'Per-run quality score columns are present in the migration';
    }),
  );

  tests.push(
    await runTest('T29.2', 'Immediate Quality Scoring in Harvester', async () => {
      const harvester = readRepoFile('packages', 'agent-runtime', 'src', 'taskOutcomeHarvester.ts');

      assertIncludes(harvester, 'export function computePerRunQualityScore', 'per-run score function export');
      assertIncludes(harvester, 'per_run_quality_score', 'per-run score persisted in INSERT');
      assertIncludes(harvester, 'per_run_evaluation_notes', 'per-run notes persisted in INSERT');
      assertIncludes(harvester, 'computePerRunQualityScore(', 'per-run score computed in harvestTaskOutcome');

      return 'Harvester computes and persists a quality score for every completed task';
    }),
  );

  tests.push(
    await runTest('T29.3', 'Harvester Score Uses Deterministic Signals Only', async () => {
      const harvester = readRepoFile('packages', 'agent-runtime', 'src', 'taskOutcomeHarvester.ts');

      // The per-run scorer must use only immediately available signals
      assertIncludes(harvester, 'final_status:', 'per-run scorer uses final_status');
      assertIncludes(harvester, 'tool_failure_count:', 'per-run scorer uses tool_failure_count');
      assertIncludes(harvester, 'turn_count:', 'per-run scorer uses turn_count');
      assertIncludes(harvester, 'had_partial_save:', 'per-run scorer uses had_partial_save');
      assertIncludes(harvester, 'cost_usd:', 'per-run scorer uses cost_usd');

      return 'Per-run quality scorer is limited to deterministic run-time signals';
    }),
  );

  tests.push(
    await runTest('T29.4', 'Batch Evaluator Uses Per-Run Score as Baseline', async () => {
      const batchEvaluator = readRepoFile('packages', 'scheduler', 'src', 'batchOutcomeEvaluator.ts');

      assertIncludes(batchEvaluator, 'per_run_quality_score', 'batch evaluator reads per-run score column');
      assertIncludes(batchEvaluator, 'per_run_quality_score != null', 'batch evaluator branches on per-run score presence');
      assertIncludes(batchEvaluator, 'baseline=', 'batch evaluator labels per-run baseline in notes');
      assertIncludes(batchEvaluator, 'per-run)', 'batch evaluator identifies per-run source in notes');

      return 'Batch evaluator uses per-run quality score as the starting baseline when available';
    }),
  );

  tests.push(
    await runTest('T29.5', 'Per-Run Score Exported from Agent-Runtime', async () => {
      const index = readRepoFile('packages', 'agent-runtime', 'src', 'index.ts');

      assertIncludes(index, 'computePerRunQualityScore', 'computePerRunQualityScore is exported');

      return 'computePerRunQualityScore is exported from the agent-runtime package index';
    }),
  );

  return { layer: 29, name: 'Per-Run Agent Evaluation', tests };
}
