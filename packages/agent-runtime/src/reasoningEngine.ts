/**
 * Reasoning Engine — Multi-pass verification, cross-model consensus,
 * and value gate for agent outputs.
 *
 * Wraps the existing model call loop in baseAgentRunner.ts with
 * structured verification passes that catch errors, check consistency,
 * and optionally seek cross-model agreement.
 */

import { systemQuery } from '@glyphor/shared/db';
import type { ModelClient } from './modelClient.js';
import type { RedisCache } from './redisCache.js';
import { CACHE_KEYS, CACHE_TTL } from './redisCache.js';

// ─── Types ──────────────────────────────────────────────────────

export type PassType =
  | 'self_critique'
  | 'consistency_check'
  | 'factual_verification'
  | 'goal_alignment'
  | 'cross_model'
  | 'value_analysis';

export interface ReasoningConfig {
  enabled: boolean;
  passTypes: PassType[];
  minConfidence: number;
  maxReasoningBudget: number;
  crossModelEnabled: boolean;
  valueGateEnabled: boolean;
  verificationModels: string[];
}

export interface ReasoningPassResult {
  passType: PassType;
  passNumber: number;
  model: string;
  confidence: number;
  issues: string[];
  suggestions: string[];
  reasoning: string;
  durationMs: number;
  costUsd: number;
}

export interface ReasoningResult {
  verified: boolean;
  overallConfidence: number;
  passes: ReasoningPassResult[];
  revised: boolean;
  revisedOutput?: string;
  totalCostUsd: number;
}

export interface ValueScore {
  score: number;
  reasoning: string;
  recommendation: 'proceed' | 'simplify' | 'abort';
  alternatives?: ValueAlternative[];
  costUsd: number;
}

export interface ValueAlternative {
  approach: string;
  estimatedSavings: string;
}

// ─── Verification model pricing (uses centralized registry) ────────────────

import { estimateModelCost } from '@glyphor/shared/models';

const MAX_REVISIONS = 2;

function estimateVerificationCost(model: string, inputTokens: number, outputTokens: number): number {
  return estimateModelCost(model, inputTokens, outputTokens);
}

// ─── ReasoningEngine ────────────────────────────────────────────

export class ReasoningEngine {
  constructor(
    private modelClient: ModelClient,
    private config: ReasoningConfig,
    private cache?: RedisCache,
  ) {}

  /**
   * Value gate — evaluates whether a task is worth executing at full cost.
   * Returns a score + recommendation (proceed / simplify / abort).
   */
  async evaluateValue(
    agentRole: string,
    task: string,
    contextSummary: string,
  ): Promise<ValueScore> {
    const model = this.getVerificationModel(0);
    const startMs = Date.now();

    const prompt = `You are a value assessment engine for an AI company's agent system.
Evaluate whether the following task justifies a full model execution (which costs money).

Agent: ${agentRole}
Task: ${task}
Context summary: ${contextSummary}

Score the value from 0.0 to 1.0 where:
- 0.0-0.3: Low value, likely redundant or trivial
- 0.3-0.6: Moderate value, could be simplified  
- 0.6-1.0: High value, should proceed with full execution

Respond ONLY with valid JSON (no markdown):
{
  "score": <number 0-1>,
  "reasoning": "<brief explanation>",
  "recommendation": "<proceed|simplify|abort>",
  "alternatives": [{"approach": "<string>", "estimatedSavings": "<string>"}]
}`;

    try {
      const response = await this.modelClient.generate({
        model,
        systemInstruction: 'You are a JSON-only value assessment engine. Always respond with valid JSON.',
        contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
        temperature: 0.1,
        thinkingEnabled: true,
        callTimeoutMs: 15_000,
      });

      const inputTokens = response.usageMetadata.inputTokens;
      const outputTokens = response.usageMetadata.outputTokens;
      const costUsd = estimateVerificationCost(model, inputTokens, outputTokens);

      const parsed = this.extractJson<{
        score: number;
        reasoning: string;
        recommendation: string;
        alternatives?: ValueAlternative[];
      }>(response.text ?? '');

      if (!parsed) {
        return { score: 0.7, reasoning: 'Failed to parse value assessment', recommendation: 'proceed', costUsd };
      }

      const rec = parsed.recommendation as 'proceed' | 'simplify' | 'abort';
      return {
        score: Math.max(0, Math.min(1, parsed.score)),
        reasoning: parsed.reasoning,
        recommendation: ['proceed', 'simplify', 'abort'].includes(rec) ? rec : 'proceed',
        alternatives: parsed.alternatives,
        costUsd,
      };
    } catch (err) {
      console.warn(`[ReasoningEngine] Value gate failed for ${agentRole}:`, (err as Error).message);
      return { score: 0.7, reasoning: 'Value gate error — defaulting to proceed', recommendation: 'proceed', costUsd: 0 };
    }
  }

  /**
   * Verify an agent's output through the configured pass pipeline.
   * Called after the agentic loop completes.
   */
  async verify(
    agentRole: string,
    task: string,
    output: string,
    context: string,
  ): Promise<ReasoningResult> {
    const passes: ReasoningPassResult[] = [];
    let budgetSpent = 0;
    let revised = false;
    let revisedOutput: string | undefined;
    let currentOutput = output;

    for (let i = 0; i < this.config.passTypes.length; i++) {
      const passType = this.config.passTypes[i];

      // Budget guard
      if (budgetSpent >= this.config.maxReasoningBudget) {
        console.log(`[ReasoningEngine] Budget exhausted ($${budgetSpent.toFixed(4)} >= $${this.config.maxReasoningBudget}), stopping passes`);
        break;
      }

      // Cross-model consensus is handled separately
      if (passType === 'cross_model' && this.config.crossModelEnabled) {
        const consensus = await this.runCrossModelConsensus(agentRole, task, currentOutput, context);
        passes.push(...consensus.passes);
        budgetSpent += consensus.passes.reduce((s, p) => s + p.costUsd, 0);
        continue;
      }

      const result = await this.runPass(passType, i + 1, agentRole, task, currentOutput, context);
      passes.push(result);
      budgetSpent += result.costUsd;

      // If confidence is too low and we have budget, try revision
      if (result.confidence < this.config.minConfidence && result.suggestions.length > 0) {
        const revisionResult = await this.reviseOutput(
          agentRole, task, currentOutput, result.suggestions, context,
        );
        if (revisionResult) {
          revised = true;
          revisedOutput = revisionResult.output;
          currentOutput = revisionResult.output;
          budgetSpent += revisionResult.costUsd;
        }
      }
    }

    // Calculate overall confidence (geometric mean of pass confidences)
    const overallConfidence = passes.length > 0
      ? Math.pow(
          passes.reduce((prod, p) => prod * p.confidence, 1),
          1 / passes.length,
        )
      : 1.0;

    return {
      verified: overallConfidence >= this.config.minConfidence,
      overallConfidence,
      passes,
      revised,
      revisedOutput,
      totalCostUsd: budgetSpent,
    };
  }

  /**
   * Run a single verification pass.
   */
  private async runPass(
    passType: PassType,
    passNumber: number,
    agentRole: string,
    task: string,
    output: string,
    context: string,
  ): Promise<ReasoningPassResult> {
    const model = this.getVerificationModel(passNumber);
    const startMs = Date.now();

    const promptMap: Record<PassType, string> = {
      self_critique: `Critically evaluate this output for logical errors, unsupported claims, and gaps.`,
      consistency_check: `Check this output for internal contradictions, inconsistencies with the provided context, and conflicting statements.`,
      factual_verification: `Verify the factual accuracy of claims in this output. Flag any statements that appear incorrect or unverifiable.`,
      goal_alignment: `Assess how well this output aligns with the stated task goals and the agent's role.`,
      cross_model: `Provide an independent assessment of this output's quality and accuracy.`,
      value_analysis: `Evaluate the practical value and actionability of this output.`,
    };

    const prompt = `You are a verification engine performing a "${passType}" pass.

Agent: ${agentRole}
Task: ${task}
Context: ${context.slice(0, 2000)}

Output to verify:
${output.slice(0, 4000)}

${promptMap[passType]}

Respond ONLY with valid JSON (no markdown):
{
  "confidence": <number 0-1>,
  "issues": ["<issue1>", "<issue2>"],
  "suggestions": ["<suggestion1>"],
  "reasoning": "<brief chain-of-thought>"
}`;

    try {
      const response = await this.modelClient.generate({
        model,
        systemInstruction: 'You are a JSON-only verification engine. Always respond with valid JSON.',
        contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
        temperature: 0.1,
        thinkingEnabled: true,
        callTimeoutMs: 20_000,
      });

      const durationMs = Date.now() - startMs;
      const costUsd = estimateVerificationCost(model, response.usageMetadata.inputTokens, response.usageMetadata.outputTokens);

      const parsed = this.extractJson<{
        confidence: number;
        issues: string[];
        suggestions: string[];
        reasoning: string;
      }>(response.text ?? '');

      if (!parsed) {
        return {
          passType, passNumber, model,
          confidence: 0.5,
          issues: ['Failed to parse verification response'],
          suggestions: [],
          reasoning: 'Parse failure',
          durationMs, costUsd,
        };
      }

      return {
        passType, passNumber, model,
        confidence: Math.max(0, Math.min(1, parsed.confidence)),
        issues: parsed.issues ?? [],
        suggestions: parsed.suggestions ?? [],
        reasoning: parsed.reasoning ?? '',
        durationMs, costUsd,
      };
    } catch (err) {
      return {
        passType, passNumber, model,
        confidence: 0.5,
        issues: [`Pass error: ${(err as Error).message}`],
        suggestions: [],
        reasoning: 'Error during verification',
        durationMs: Date.now() - startMs,
        costUsd: 0,
      };
    }
  }

  /**
   * Cross-model consensus — runs the same verification on multiple models
   * and synthesizes the results.
   */
  private async runCrossModelConsensus(
    agentRole: string,
    task: string,
    output: string,
    context: string,
  ): Promise<{ passes: ReasoningPassResult[] }> {
    const models = this.config.verificationModels.slice(0, 3); // max 3 models
    const passes = await Promise.all(
      models.map((model, idx) =>
        this.runPassWithModel('cross_model', idx + 100, model, agentRole, task, output, context),
      ),
    );
    return { passes };
  }

  /** Run a pass with a specific model (for cross-model consensus). */
  private async runPassWithModel(
    passType: PassType,
    passNumber: number,
    model: string,
    agentRole: string,
    task: string,
    output: string,
    context: string,
  ): Promise<ReasoningPassResult> {
    // Reuse runPass logic but force a specific model
    const saved = this.config.verificationModels;
    this.config.verificationModels = [model];
    const result = await this.runPass(passType, passNumber, agentRole, task, output, context);
    this.config.verificationModels = saved;
    result.model = model;
    return result;
  }

  /**
   * Attempt to revise the output based on verification suggestions.
   */
  private async reviseOutput(
    agentRole: string,
    task: string,
    output: string,
    suggestions: string[],
    context: string,
  ): Promise<{ output: string; costUsd: number } | null> {
    const model = this.getVerificationModel(0);

    const prompt = `You are a revision engine. Improve the following output based on these suggestions.

Agent: ${agentRole}
Task: ${task}
Context: ${context.slice(0, 1500)}

Original output:
${output.slice(0, 3000)}

Suggestions for improvement:
${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Provide the revised output directly (no JSON wrapping, no explanation).`;

    try {
      const response = await this.modelClient.generate({
        model,
        systemInstruction: 'You are a precise output revision engine. Return only the improved output.',
        contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
        temperature: 0.2,
        thinkingEnabled: true,
        callTimeoutMs: 20_000,
      });

      const costUsd = estimateVerificationCost(model, response.usageMetadata.inputTokens, response.usageMetadata.outputTokens);
      return { output: response.text ?? output, costUsd };
    } catch {
      return null;
    }
  }

  /** Select verification model by round-robin through configured models. */
  private getVerificationModel(passIndex: number): string {
    const models = this.config.verificationModels;
    if (models.length === 0) return 'gemini-3-flash-preview';
    return models[passIndex % models.length];
  }

  /** Extract JSON from a model response, handling markdown fences. */
  private extractJson<T>(text: string): T | null {
    if (!text) return null;
    // Strip markdown fences
    let clean = text.trim();
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    try {
      return JSON.parse(clean) as T;
    } catch {
      // Try to find JSON in the text
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]) as T;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  /**
   * Load reasoning config for an agent from DB (with Redis caching).
   */
  static async loadConfig(
    agentRole: string,
    cache?: RedisCache,
  ): Promise<ReasoningConfig | null> {
    const cacheKey = CACHE_KEYS.reasoningConfig(agentRole);

    if (cache) {
      const cached = await cache.get<ReasoningConfig>(cacheKey);
      if (cached) return cached;
    }

    const [data] = await systemQuery<{
      enabled: boolean;
      pass_types: unknown;
      min_confidence: number;
      max_reasoning_budget: number;
      cross_model_enabled: boolean;
      value_gate_enabled: boolean;
      verification_models: string[];
    }>(
      'SELECT * FROM agent_reasoning_config WHERE agent_role = $1 LIMIT 1',
      [agentRole],
    );

    if (!data) return null;

    const config: ReasoningConfig = {
      enabled: data.enabled,
      passTypes: data.pass_types as PassType[],
      minConfidence: data.min_confidence,
      maxReasoningBudget: data.max_reasoning_budget,
      crossModelEnabled: data.cross_model_enabled,
      valueGateEnabled: data.value_gate_enabled,
      verificationModels: data.verification_models,
    };

    if (cache) {
      await cache.set(cacheKey, config, CACHE_TTL.reasoningConfig);
    }

    return config;
  }
}
