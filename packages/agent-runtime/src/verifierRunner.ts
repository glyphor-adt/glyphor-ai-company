/**
 * Verifier Runner — Dual-Track Cross-Model Verification.
 *
 * Uses a DIFFERENT model from the primary agent to independently
 * verify critical outputs. If the primary used Gemini, the verifier
 * uses Claude (or vice versa), preventing correlated hallucination.
 *
 * Decision matrix:
 *   APPROVE — both agree, high confidence
 *   WARN    — minor disagreement, log and proceed
 *   BLOCK   — major disagreement, halt execution
 *   ESCALATE — conflicting evidence, needs human/orchestrator review
 */

import type { ModelClient } from './modelClient.js';
import type { ConversationTurn } from './types.js';
import { getVerifierFor } from '@glyphor/shared/models';

// ─── Types ──────────────────────────────────────────────────────

export type VerificationVerdict = 'APPROVE' | 'WARN' | 'BLOCK' | 'ESCALATE';

export interface VerificationReport {
  verdict: VerificationVerdict;
  confidence: number;
  primaryModel: string;
  verifierModel: string;
  reasoning: string;
  discrepancies: string[];
}

// ─── Cross-model mapping ────────────────────────────────────────

/**
 * Maps a primary model to a different-provider verifier model.
 * Delegates to the centralized model registry in @glyphor/shared.
 */
function getVerifierModel(primaryModel: string): string {
  return getVerifierFor(primaryModel);
}

// ─── Verifier Runner ────────────────────────────────────────────

const VERIFIER_SYSTEM_PROMPT = `You are a verification agent. Your ONLY job is to independently assess the correctness and safety of an AI agent's output.

You will receive:
1. The original task/instruction
2. The agent's output to verify

Respond with a JSON object (no markdown fences):
{
  "agreement": "full" | "partial" | "disagree",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation>",
  "discrepancies": ["<list of specific issues, empty if none>"],
  "factual_errors": <number of factual errors found>,
  "safety_concerns": <true/false>
}

Be rigorous but fair. Flag factual errors, logical inconsistencies, safety issues, and hallucinated data. Do NOT flag stylistic preferences.`;

export class VerifierRunner {
  constructor(private modelClient: ModelClient) {}

  /**
   * Verify an agent's output using a cross-model check.
   */
  async verify(params: {
    primaryModel: string;
    task: string;
    agentOutput: string;
    context?: string;
  }): Promise<VerificationReport> {
    const verifierModel = getVerifierModel(params.primaryModel);

    const contents: ConversationTurn[] = [
      {
        role: 'user',
        content: [
          `## Task Given to Agent`,
          params.task,
          params.context ? `\n## Additional Context\n${params.context}` : '',
          `\n## Agent Output to Verify`,
          params.agentOutput,
        ].filter(Boolean).join('\n'),
        timestamp: Date.now(),
      },
    ];

    try {
      const response = await this.modelClient.generate({
        model: verifierModel,
        systemInstruction: VERIFIER_SYSTEM_PROMPT,
        contents,
        temperature: 0.1,
        maxTokens: 1024,
      });

      const parsed = parseVerifierResponse(response.text ?? '');

      return {
        verdict: determineVerdict(parsed),
        confidence: parsed.confidence,
        primaryModel: params.primaryModel,
        verifierModel,
        reasoning: parsed.reasoning,
        discrepancies: parsed.discrepancies,
      };
    } catch (err) {
      // If verification fails, default to WARN (don't block on infra issues)
      return {
        verdict: 'WARN',
        confidence: 0,
        primaryModel: params.primaryModel,
        verifierModel,
        reasoning: `Verification failed: ${(err as Error).message}`,
        discrepancies: ['Verification model call failed'],
      };
    }
  }

  /**
   * Verify a high-stakes tool call before execution using a second-model review.
   */
  async verifyToolCall(params: {
    primaryModel: string;
    agentRole: string;
    toolName: string;
    toolParams: Record<string, unknown>;
    context?: string;
  }): Promise<VerificationReport> {
    const toolTask = [
      `Agent role: ${params.agentRole}`,
      `Proposed high-stakes tool call: ${params.toolName}`,
      `Tool parameters: ${JSON.stringify(params.toolParams, null, 2)}`,
      'Decide whether this action should be allowed to proceed.',
    ].join('\n');

    return this.verify({
      primaryModel: params.primaryModel,
      task: toolTask,
      agentOutput: `Proposed tool invocation:\n${params.toolName}(${JSON.stringify(params.toolParams)})`,
      context: params.context,
    });
  }
}

// ─── Response parsing ───────────────────────────────────────────

interface ParsedVerifierResponse {
  agreement: 'full' | 'partial' | 'disagree';
  confidence: number;
  reasoning: string;
  discrepancies: string[];
  factualErrors: number;
  safetyConcerns: boolean;
}

function parseVerifierResponse(raw: string): ParsedVerifierResponse {
  try {
    // Strip markdown fences if model wraps them despite instructions
    const cleaned = raw.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      agreement: parsed.agreement ?? 'partial',
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      reasoning: String(parsed.reasoning ?? 'No reasoning provided'),
      discrepancies: Array.isArray(parsed.discrepancies) ? parsed.discrepancies.map(String) : [],
      factualErrors: Number(parsed.factual_errors) || 0,
      safetyConcerns: Boolean(parsed.safety_concerns),
    };
  } catch {
    return {
      agreement: 'partial',
      confidence: 0.3,
      reasoning: raw.slice(0, 500),
      discrepancies: ['Failed to parse verifier response'],
      factualErrors: 0,
      safetyConcerns: false,
    };
  }
}

function determineVerdict(parsed: ParsedVerifierResponse): VerificationVerdict {
  // Safety concerns always escalate
  if (parsed.safetyConcerns) return 'ESCALATE';

  // Full agreement with high confidence → APPROVE
  if (parsed.agreement === 'full' && parsed.confidence >= 0.7) return 'APPROVE';

  // Outright disagreement or many factual errors → BLOCK
  if (parsed.agreement === 'disagree') return 'BLOCK';
  if (parsed.factualErrors >= 3) return 'BLOCK';

  // Partial agreement with moderate confidence → WARN
  if (parsed.agreement === 'partial' && parsed.confidence >= 0.5) return 'WARN';

  // Low confidence partial → ESCALATE
  if (parsed.confidence < 0.5) return 'ESCALATE';

  return 'WARN';
}
