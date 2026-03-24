import { describe, expect, it } from 'vitest';

import { classifySubtask, routeSubtask } from '../subtaskRouter.js';
import type { ConversationTurn } from '../types.js';
import { DEFAULT_AGENT_MODEL } from '@glyphor/shared/models';

function turn(role: ConversationTurn['role'], content: string): ConversationTurn {
  return { role, content, timestamp: Date.now() };
}

describe('subtaskRouter', () => {
  it('classifies simple short work as trivial', () => {
    const classification = classifySubtask({
      role: 'ops',
      task: 'work_loop',
      history: [turn('user', 'Check for new work and report back.')],
      toolNames: ['list_messages'],
      trustScore: 0.8,
      currentModel: DEFAULT_AGENT_MODEL,
    });

    expect(classification.complexity).toBe('trivial');
    expect(classification.requiresReasoning).toBe(false);
  });

  it('routes code-edit subtasks to a stronger model', async () => {
    const decision = await routeSubtask({
      role: 'platform-engineer',
      task: 'on_demand',
      history: [
        turn('user', 'Fix the TypeScript build failure, update the migration, and patch the affected file.'),
        turn('tool_result', 'tsc failed in packages/agent-runtime/src/baseAgentRunner.ts'),
      ],
      toolNames: ['view', 'apply_patch', 'powershell'],
      trustScore: 0.9,
      currentModel: DEFAULT_AGENT_MODEL,
    });

    expect(['complex', 'frontier']).toContain(decision.classification.complexity);
    expect(decision.routing.model).not.toBe(DEFAULT_AGENT_MODEL);
    expect(decision.reason).toContain('subtask');
  });

  it('marks research-heavy work as requiring factual grounding', () => {
    const classification = classifySubtask({
      role: 'vp-research',
      task: 'market_sizing',
      history: [turn('user', 'Research market sources, cite them, and summarize the outlook.')],
      toolNames: ['web_search', 'fetch_report'],
      trustScore: 0.7,
      currentModel: DEFAULT_AGENT_MODEL,
    });

    expect(classification.requiresFactualGrounding).toBe(true);
    expect(['standard', 'complex', 'frontier']).toContain(classification.complexity);
  });
});
