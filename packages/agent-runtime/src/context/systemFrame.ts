import type { ConversationTurn } from '../types.js';

export const SYSTEM_FRAME_PREFIX = '[SYSTEM FRAME]';
export const REASONING_STATE_PREFIX = '[REASONING STATE]';
export const SESSION_SUMMARY_PREFIX = '[SESSION SUMMARY]';

export interface SystemFrameInput {
  role: string;
  task: string;
  initialMessage: string;
  turnNumber: number;
  bundleKind?: 'planning' | 'execution' | 'verification';
  timestamp?: number;
}

function clip(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function isSyntheticContextTurn(turn: ConversationTurn): boolean {
  const content = turn.content ?? '';
  return (
    content.startsWith(SYSTEM_FRAME_PREFIX) ||
    content.startsWith(REASONING_STATE_PREFIX) ||
    content.startsWith(SESSION_SUMMARY_PREFIX)
  );
}

export function buildSystemFrameTurn(input: SystemFrameInput): ConversationTurn {
  const objective = clip(oneLine(input.initialMessage), 1200);
  const content = [
    `${SYSTEM_FRAME_PREFIX}`,
    'Persistent run anchors. Do not respond to this message directly.',
    '',
    `Role identity: ${input.role}`,
    `Current task: ${input.task}`,
    `Current turn: ${input.turnNumber}`,
    `Context bundle: ${input.bundleKind ?? 'execution'}`,
    `Task objective: ${objective}`,
    '',
    'Retention policy: never drop role identity, task objective, and high-signal evidence.',
    'Trim policy: drop stale tool chatter and low-signal reflections before core task context.',
  ].join('\n');

  return {
    role: 'user',
    content,
    timestamp: input.timestamp ?? Date.now(),
  };
}
