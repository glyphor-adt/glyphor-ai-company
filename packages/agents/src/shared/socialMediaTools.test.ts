import { beforeEach, describe, expect, it, vi } from 'vitest';

const systemQueryMock = vi.fn();
const publishDeliverableExecuteMock = vi.fn();

vi.mock('@glyphor/shared/db', () => ({
  systemQuery: (...args: unknown[]) => systemQueryMock(...args),
}));

vi.mock('./deliverableTools.js', () => ({
  createDeliverableTools: () => [
    {
      name: 'publish_deliverable',
      description: 'mock publish deliverable',
      parameters: {},
      execute: publishDeliverableExecuteMock,
    },
  ],
}));

const { createSocialMediaTools } = await import('./socialMediaTools.js');

function createContext(agentRole: 'cmo' | 'cmo') {
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

describe('socialMediaTools publishing workflow', () => {
  beforeEach(() => {
    systemQueryMock.mockReset();
    publishDeliverableExecuteMock.mockReset();
    vi.restoreAllMocks();
    delete process.env.BUFFER_API_KEY;
  });

  it('schedules an approved draft and publishes a durable record', async () => {
    process.env.BUFFER_API_KEY = 'buffer-test-key';
    publishDeliverableExecuteMock.mockResolvedValue({
      success: true,
      data: { deliverable_id: 'deliverable-1', storage_url: 'https://buffer.example/post/1' },
    });

    systemQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM content_drafts')) {
        return [{
          id: 'draft-1',
          title: 'Launch post',
          content: 'Shipping the new asset pipeline today.',
          platform: 'linkedin',
          media_url: 'https://cdn.example/media.png',
          status: 'approved',
          approved_by: 'cmo',
          approved_at: '2026-03-08T00:00:00.000Z',
          decision_id: null,
          initiative_id: 'initiative-1',
          directive_id: null,
          assignment_id: null,
          metadata: { source: 'campaign' },
        }];
      }
      if (sql.includes('INSERT INTO scheduled_posts')) {
        return [{ id: 'post-1', created_at: '2026-03-08T01:00:00.000Z' }];
      }
      if (sql.includes('UPDATE scheduled_posts')) {
        return [];
      }
      if (sql.includes('UPDATE content_drafts')) {
        return [];
      }
      if (sql.includes('INSERT INTO social_publish_audit_log')) {
        return [];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'buffer-1', url: 'https://buffer.example/post/1' }), { status: 200 }),
    );

    const tool = createSocialMediaTools().find((entry) => entry.name === 'schedule_social_post');
    const result = await tool!.execute(
      { draft_id: 'draft-1', scheduled_at: '2026-03-09T09:00:00.000Z' },
      createContext('cmo'),
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      post_id: 'post-1',
      api_status: 'submitted',
      deliverable_id: 'deliverable-1',
      durable_reference: 'https://buffer.example/post/1',
    });
    expect(publishDeliverableExecuteMock).toHaveBeenCalledTimes(1);
  });

  it('records a durable failed publish when no API is configured', async () => {
    publishDeliverableExecuteMock.mockResolvedValue({
      success: true,
      data: { deliverable_id: 'deliverable-2', storage_url: 'scheduled-post://post-2' },
    });

    systemQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM content_drafts')) {
        return [{
          id: 'draft-2',
          title: 'Fallback post',
          content: 'Autonomy is live.',
          platform: 'linkedin',
          media_url: null,
          status: 'approved',
          approved_by: 'cmo',
          approved_at: '2026-03-08T00:00:00.000Z',
          decision_id: null,
          initiative_id: 'initiative-2',
          directive_id: null,
          assignment_id: null,
          metadata: {},
        }];
      }
      if (sql.includes('INSERT INTO scheduled_posts')) {
        return [{ id: 'post-2', created_at: '2026-03-08T01:00:00.000Z' }];
      }
      if (sql.includes('UPDATE scheduled_posts')) {
        return [];
      }
      if (sql.includes('UPDATE content_drafts')) {
        return [];
      }
      if (sql.includes('INSERT INTO social_publish_audit_log')) {
        return [];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const tool = createSocialMediaTools().find((entry) => entry.name === 'schedule_social_post');
    const result = await tool!.execute(
      { draft_id: 'draft-2', scheduled_at: '2026-03-09T09:00:00.000Z' },
      createContext('cmo'),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No social publishing API configured');
    expect(result.data).toMatchObject({
      post_id: 'post-2',
      deliverable_id: 'deliverable-2',
      durable_reference: 'scheduled-post://post-2',
    });
  });
});
