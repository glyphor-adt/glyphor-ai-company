/**
 * Reasoning Extraction — XML block parsing
 *
 * Ported from Fuse V7 runtime/reasoning.ts.
 */

import type { ReasoningEnvelope } from './types.js';

const REASONING_BLOCK_RE = /<reasoning>([\s\S]*?)<\/reasoning>/i;

const FIELD_RE: Record<keyof Omit<ReasoningEnvelope, 'raw'>, RegExp> = {
  approach:     /<approach>([\s\S]*?)<\/approach>/i,
  tradeoffs:    /<tradeoffs>([\s\S]*?)<\/tradeoffs>/i,
  risks:        /<risks>([\s\S]*?)<\/risks>/i,
  alternatives: /<alternatives>([\s\S]*?)<\/alternatives>/i,
};

export function extractReasoning(text: string): ReasoningEnvelope | undefined {
  const match = text.match(REASONING_BLOCK_RE);
  if (!match) return undefined;

  const raw = match[1].trim();
  const envelope: ReasoningEnvelope = { raw };

  for (const [field, re] of Object.entries(FIELD_RE) as [keyof typeof FIELD_RE, RegExp][]) {
    const subMatch = raw.match(re);
    if (subMatch) {
      envelope[field] = subMatch[1].trim();
    }
  }

  return envelope;
}

export function stripReasoning(text: string): string {
  return text.replace(REASONING_BLOCK_RE, '').trim();
}

export const REASONING_PROMPT_SUFFIX = `

---

## Reasoning Protocol

Before producing your final output, wrap your internal reasoning in a <reasoning> block.
This reasoning is captured by the platform for quality review and decision auditing.
It is NOT shown to founders unless they drill into agent detail views.

Structure:
<reasoning>
  <approach>How you approached this task and why</approach>
  <tradeoffs>Key tradeoffs you considered</tradeoffs>
  <risks>Risks you identified with your chosen approach</risks>
  <alternatives>Alternatives you rejected and why</alternatives>
</reasoning>

After the reasoning block, produce your actual output as instructed by your role.
`;
