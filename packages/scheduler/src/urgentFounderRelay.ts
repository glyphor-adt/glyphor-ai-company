/**
 * When Sarah (or any peer) sends an urgent agent message that explicitly asks for
 * Kristina/Andrew/founders to receive the answer, agents often complete with plain
 * text and no <notify> block — so AgentNotifier delivers nothing.
 *
 * This module synthesizes a <notify> payload after a successful urgent_message_response
 * so the existing AgentNotifier path (#briefings + DM fallback) runs.
 *
 * Set URGENT_FOUNDER_RELAY=false to disable.
 */

import { parseNotifications } from './agentNotifier.js';
import type { AgentNotifier } from './agentNotifier.js';

const RELAY_DISABLED = process.env.URGENT_FOUNDER_RELAY === 'false';

/** Strip model artifacts so DMs stay readable. */
export function stripOutputForFounderRelay(output: string): string {
  let s = output.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '').trim();
  s = s.replace(/<\/?thinking>/gi, '').trim();
  if (s.length > 6000) s = `${s.slice(0, 5997)}…`;
  return s;
}

function combinedRequestText(
  inputMessage: string | null | undefined,
  payload: Record<string, unknown>,
): string {
  const parts: string[] = [];
  if (inputMessage?.trim()) parts.push(inputMessage);
  if (typeof payload.context === 'string') parts.push(payload.context);
  try {
    const ctx = payload.context as Record<string, unknown> | undefined;
    if (ctx && typeof ctx === 'object') {
      const m = ctx.message;
      if (typeof m === 'string') parts.push(m);
    }
  } catch { /* ignore */ }
  const ed = payload.event_data as Record<string, unknown> | undefined;
  if (ed && typeof ed.message === 'string') parts.push(ed.message);
  return parts.join('\n');
}

/** Who should receive the relay based on request wording. */
export function resolveFounderRelayTarget(text: string): 'kristina' | 'andrew' | 'both' | null {
  const t = text.toLowerCase();
  const hasK = /\bkristina\b/.test(t);
  const hasA = /\bandrew\b/.test(t);
  if (hasK && hasA) return 'both';
  if (hasK) return 'kristina';
  if (hasA) return 'andrew';
  if (/\bfounders?\b/.test(t)) return 'both';
  return null;
}

function escapeNotifyTitle(title: string): string {
  return title.replace(/"/g, "'").replace(/[\r\n]+/g, ' ').slice(0, 120);
}

function escapeNotifyBody(body: string): string {
  return body.replace(/<\/?notify\b/gi, '< notify');
}

/**
 * If this run already included deliverable <notify> blocks, do not duplicate.
 */
export function needsFounderRelay(
  task: string,
  output: string | null | undefined,
  inputMessage: string | null | undefined,
  payload: Record<string, unknown>,
): { target: 'kristina' | 'andrew' | 'both'; body: string } | null {
  if (RELAY_DISABLED) return null;
  if (task !== 'urgent_message_response') return null;
  if (!output?.trim()) return null;

  if (parseNotifications(output).length > 0) return null;

  const combined = combinedRequestText(inputMessage, payload);
  const target = resolveFounderRelayTarget(combined);
  if (!target) return null;

  const body = stripOutputForFounderRelay(output);
  if (!body) return null;

  return { target, body };
}

/**
 * Append synthetic <notify> and run through AgentNotifier (fire-and-forget).
 */
export async function relayUrgentFounderReplyIfNeeded(params: {
  task: string;
  agentRole: string;
  inputMessage: string | null | undefined;
  output: string | null | undefined;
  payload: Record<string, unknown>;
  agentNotifier: AgentNotifier | null;
}): Promise<number> {
  const { task, agentRole, inputMessage, output, payload, agentNotifier } = params;
  if (!agentNotifier) return 0;

  const need = needsFounderRelay(task, output, inputMessage, payload);
  if (!need) return 0;

  const roleLabel = agentRole.replace(/-/g, ' ');
  const title = escapeNotifyTitle(`Urgent update — ${roleLabel}`);
  const xml = `<notify type="fyi" to="${need.target}" title="${title}">
${escapeNotifyBody(need.body)}
</notify>`;

  const n = await agentNotifier.processAgentOutput(agentRole, `${output}\n\n${xml}`);
  if (n > 0) {
    console.log(`[urgentFounderRelay] ${agentRole} → founder relay (${need.target}), notifications=${n}`);
  }
  return n;
}
