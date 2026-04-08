/**
 * Build a concrete task string for Mia (vp-design) when the worker/scheduler
 * would otherwise invoke her with an empty or generic message.
 */

import { systemQuery } from '@glyphor/shared/db';
import type { ConversationTurn } from '@glyphor/agent-runtime';

export interface ResolveVpDesignWorkerMessageInput {
  message?: string;
  payload?: Record<string, unknown>;
  assignmentId?: string;
  directiveId?: string;
  conversationHistory?: ConversationTurn[];
}

const ASSIGNMENT_PREFIX = '__assignment_id__:';
const DIRECTIVE_PREFIX = '__directive_id__:';

function trimStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function carrierIdsFromHistory(history?: ConversationTurn[]): { assignmentId?: string; directiveId?: string } {
  if (!Array.isArray(history)) return {};
  let assignmentId: string | undefined;
  let directiveId: string | undefined;
  for (const turn of history) {
    const c = typeof turn.content === 'string' ? turn.content : '';
    if (!assignmentId && c.startsWith(ASSIGNMENT_PREFIX)) {
      assignmentId = c.slice(ASSIGNMENT_PREFIX.length).trim() || undefined;
    }
    if (!directiveId && c.startsWith(DIRECTIVE_PREFIX)) {
      directiveId = c.slice(DIRECTIVE_PREFIX.length).trim() || undefined;
    }
  }
  return { assignmentId, directiveId };
}

/**
 * Returns undefined if nothing could be resolved (caller keeps original message).
 */
export async function resolveVpDesignWorkerMessage(
  input: ResolveVpDesignWorkerMessageInput,
): Promise<string | undefined> {
  const fromCarriers = carrierIdsFromHistory(input.conversationHistory);
  const assignmentId =
    trimStr(input.assignmentId) ??
    fromCarriers.assignmentId ??
    trimStr(input.payload?.assignmentId ?? input.payload?.assignment_id);
  const directiveId =
    trimStr(input.directiveId) ??
    fromCarriers.directiveId ??
    trimStr(input.payload?.directiveId ?? input.payload?.directive_id);

  const p = input.payload ?? {};
  const parts: string[] = [];

  const add = (label: string, val: unknown) => {
    const s = trimStr(val);
    if (s) parts.push(`${label}:\n${s}`);
  };

  add('Email subject', p.email_subject ?? p.subject);
  add('Email body', p.email_body ?? p.body ?? p.email_text);
  add('Brief', p.brief ?? p.assignment_brief ?? p.task_text);
  add('Title', p.title ?? p.assignment_title ?? p.directive_title);
  add('Wake reason', p.wake_reason);

  if (typeof p.context === 'string' && p.context.trim()) {
    parts.push(`Context:\n${p.context.trim()}`);
  }

  if (assignmentId) {
    try {
      const rows = await systemQuery<{
        task_description: string;
        expected_output: string | null;
        task_type: string;
      }>(
        `SELECT task_description, expected_output, task_type
           FROM work_assignments
          WHERE id = $1
          LIMIT 1`,
        [assignmentId],
      );
      const wa = rows[0];
      if (wa) {
        parts.push(`Work assignment ${assignmentId}:\n${wa.task_description}`);
        if (wa.expected_output?.trim()) {
          parts.push(`Expected output:\n${wa.expected_output.trim()}`);
        }
        if (wa.task_type?.trim()) {
          parts.push(`Task type: ${wa.task_type.trim()}`);
        }
      }
    } catch {
      parts.push(`Work assignment id: ${assignmentId} (details unavailable from DB).`);
    }
  }

  if (directiveId) {
    try {
      const rows = await systemQuery<{ title: string; description: string }>(
        `SELECT title, description
           FROM founder_directives
          WHERE id = $1
          LIMIT 1`,
        [directiveId],
      );
      const d = rows[0];
      if (d) {
        parts.push(`Founder directive: ${d.title}`);
        if (d.description?.trim()) parts.push(d.description.trim());
      }
    } catch {
      parts.push(`Founder directive id: ${directiveId} (details unavailable from DB).`);
    }
  }

  if (parts.length === 0) return undefined;

  const header =
    'Web / landing page build or repo fix — follow the advanced-web-creation pipeline: normalize_design_brief where appropriate, then plan_website_build / invoke_web_build or iterate/fix in the existing repo (GitHub / Vercel) as needed.';

  return `${header}\n\n${parts.join('\n\n')}`;
}
