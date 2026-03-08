import { beforeEach, describe, expect, it, vi } from 'vitest';

const systemQueryMock = vi.fn();

vi.mock('@glyphor/shared/db', () => ({
  systemQuery: (...args: unknown[]) => systemQueryMock(...args),
}));

const { createContentTools } = await import('./contentTools.js');

function createContext(agentRole: 'content-creator' | 'cmo') {
  return {
    agentId: 'test-agent',
    agentRole,
    turnNumber: 1,
    abortSignal: new AbortController().signal,
    memoryBus: {
      read: vi.fn(),
      write: vi.fn(),
      appendActivity: vi.fn(),
      createDecision: vi.fn(),
      getDecisions: vi.fn(),
      getRecentActivity: vi.fn(),
      getProductMetrics: vi.fn(),
      getFinancials: vi.fn(),
    },
    emitEvent: vi.fn(),
  } as const;
}

describe('contentTools social review workflow', () => {
  beforeEach(() => {
    systemQueryMock.mockReset();
  });

  it('submits a draft for review and approves it', async () => {
    systemQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE content_drafts") && sql.includes("status = 'pending_approval'")) {
        return [{ id: 'draft-1', title: 'Launch post', status: 'pending_approval', type: 'social_post', platform: 'linkedin' }];
      }
      if (sql.includes('INSERT INTO social_publish_audit_log')) {
        return [];
      }
      if (sql.includes("UPDATE content_drafts") && sql.includes("status = 'approved'")) {
        return [{ id: 'draft-1', title: 'Launch post', status: 'approved', type: 'social_post', platform: 'linkedin' }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const tools = createContentTools();
    const submitTool = tools.find((tool) => tool.name === 'submit_content_for_review');
    const approveTool = tools.find((tool) => tool.name === 'approve_content_draft');

    expect(submitTool).toBeDefined();
    expect(approveTool).toBeDefined();

    const submitResult = await submitTool!.execute(
      { draft_id: 'draft-1', review_notes: 'Ready for Maya review.' },
      createContext('content-creator'),
    );
    const approveResult = await approveTool!.execute(
      { draft_id: 'draft-1', approval_notes: 'Approved for LinkedIn schedule.' },
      createContext('cmo'),
    );

    expect(submitResult.success).toBe(true);
    expect(submitResult.data).toMatchObject({ draft_id: 'draft-1', status: 'pending_approval' });
    expect(approveResult.success).toBe(true);
    expect(approveResult.data).toMatchObject({ draft_id: 'draft-1', status: 'approved', approved_by: 'cmo' });
  });
});
