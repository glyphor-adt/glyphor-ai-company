/**
 * Voice System Prompt Builder
 *
 * Builds concise voice-optimized system prompts for each agent.
 * Voice prompts are shorter than text prompts — nobody wants to
 * listen to a 500-word monologue.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentVoiceConfig } from './types.js';

export interface VoicePromptContext {
  personalitySummary?: string;
  backstory?: string;
  communicationTraits?: string[];
  systemPrompt?: string;
}

let _companyCore: string | null = null;

/**
 * Load CORE.md once — a concise company-knowledge block for voice context.
 */
function loadCompanyCore(): string {
  if (_companyCore !== null) return _companyCore;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const corePath = resolve(here, '../../company-knowledge/CORE.md');
    _companyCore = readFileSync(corePath, 'utf-8');
  } catch {
    _companyCore = '';
  }
  return _companyCore;
}

export function buildVoiceSystemPrompt(
  config: AgentVoiceConfig,
  ctx: VoicePromptContext = {},
): string {
  const sections: string[] = [];

  // Identity
  sections.push(`You are ${config.displayName}, ${config.title} at Glyphor Inc.`);

  // Agent-specific system prompt (role expertise)
  if (ctx.systemPrompt) {
    sections.push(`## Your Role\n${ctx.systemPrompt}`);
  }

  // Personality & backstory
  if (ctx.personalitySummary || ctx.backstory) {
    const parts: string[] = [];
    if (ctx.personalitySummary) parts.push(ctx.personalitySummary);
    if (ctx.backstory) parts.push(ctx.backstory);
    sections.push(`## Personality\n${parts.join('\n')}`);
  }

  // Communication style
  if (ctx.communicationTraits && ctx.communicationTraits.length > 0) {
    sections.push(`## Communication Style\n${ctx.communicationTraits.map(t => `- ${t}`).join('\n')}`);
  }

  // Company knowledge
  const core = loadCompanyCore();
  if (core) {
    sections.push(`## Company Context\n${core}`);
  }

  // Voice guidelines
  sections.push(`## Voice Conversation Guidelines
- Keep responses SHORT. 2-3 sentences max unless asked for detail.
- Use natural speech patterns — contractions, conversational tone.
- When reporting data from tool calls, summarize the key numbers. Don't read raw JSON.
- If you need to call a tool, say "Let me check that" first, then call it. The user hears a brief pause while you fetch data.
- When in a Teams meeting with multiple people, wait to be addressed or raise your hand: "I have something relevant to add about that."
- If interrupted, stop immediately and listen.
- End with a clear handoff: "Anything else?" or go silent.

## What you know
- You have access to your full tool set (same as text chat).
- You can check real-time data, run queries, look up the knowledge graph.
- You remember the conversation context within this session.
- If asked something complex, suggest: "Let me write that up in a detailed chat message after this call."

## When in a Teams meeting
- You are one participant among others. Don't dominate.
- Speak when spoken to, or when you have critical information.
- If someone asks a question you can answer with a tool call, do it.
- Take notes — save key decisions to the knowledge graph after the meeting.
- If the meeting is wrapping up, offer: "Want me to send meeting notes to the team?"`);

  return sections.join('\n\n') + '\n';
}
