import type { Pool } from 'pg';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  handler: (pool: Pool, params: Record<string, unknown>) => Promise<unknown>;
}

// ─── list_pending_content ────────────────────────────────────────────────────

const listPendingContent: ToolDefinition = {
  name: 'list_pending_content',
  description:
    'List customer_content rows that are still in pending or processing status. ' +
    'Optionally filter by Slack team (customer_tenant_id) or content kind.',
  inputSchema: {
    type: 'object',
    properties: {
      customer_tenant_id: {
        type: 'string',
        description: 'UUID of the customer_tenant row to filter by (optional).',
      },
      kind: {
        type: 'string',
        description: 'Content kind filter.',
        enum: ['file', 'thread_summary', 'document', 'snippet', 'faq', 'note'],
      },
      limit: {
        type: 'string',
        description: 'Maximum number of rows to return (default 50).',
      },
    },
  },
  async handler(pool, params) {
    const conditions: string[] = ["status IN ('pending','processing')"];
    const values: unknown[] = [];

    if (params.customer_tenant_id) {
      values.push(params.customer_tenant_id);
      conditions.push(`customer_tenant_id = $${values.length}`);
    }
    if (params.kind) {
      values.push(params.kind);
      conditions.push(`kind = $${values.length}`);
    }

    const limit = Math.min(parseInt(String(params.limit ?? '50'), 10), 200);
    values.push(limit);

    const { rows } = await pool.query(
      `SELECT id, tenant_id, customer_tenant_id, kind, title,
              LEFT(body, 200) AS body_preview,
              slack_channel_id, slack_message_ts, submitted_by,
              status, created_at
       FROM customer_content
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${values.length}`,
      values,
    );

    return { count: rows.length, items: rows };
  },
};

// ─── get_routing_stats ───────────────────────────────────────────────────────

const getRoutingStats: ToolDefinition = {
  name: 'get_routing_stats',
  description:
    'Return aggregate routing statistics from slack_approvals: counts by destination and status ' +
    'for the past N days.',
  inputSchema: {
    type: 'object',
    properties: {
      days: {
        type: 'string',
        description: 'Lookback window in days (default 7).',
      },
    },
  },
  async handler(pool, params) {
    const days = parseInt(String(params.days ?? '7'), 10);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const [byDest, byStatus, totals] = await Promise.all([
      pool.query(
        `SELECT destination, COUNT(*)::int AS count
         FROM slack_approvals
         WHERE created_at >= $1
         GROUP BY destination ORDER BY count DESC`,
        [since],
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM slack_approvals
         WHERE created_at >= $1
         GROUP BY status ORDER BY count DESC`,
        [since],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total_content,
                COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
                COUNT(*) FILTER (WHERE status = 'processed')::int AS processed
         FROM customer_content
         WHERE created_at >= $1`,
        [since],
      ),
    ]);

    return {
      period_days: days,
      content: totals.rows[0],
      approvals_by_destination: byDest.rows,
      approvals_by_status: byStatus.rows,
    };
  },
};

// ─── list_approvals ──────────────────────────────────────────────────────────

const listApprovals: ToolDefinition = {
  name: 'list_approvals',
  description:
    'List slack_approvals rows. Defaults to pending approvals. ' +
    'Optionally filter by status, destination, or customer_tenant_id.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter by approval status.',
        enum: ['pending', 'approved', 'rejected', 'expired'],
      },
      destination: {
        type: 'string',
        description: 'Filter by routing destination (e.g. "support", "billing").',
      },
      customer_tenant_id: {
        type: 'string',
        description: 'UUID of the customer_tenant row to scope the query.',
      },
      limit: {
        type: 'string',
        description: 'Maximum rows to return (default 50).',
      },
    },
  },
  async handler(pool, params) {
    const conditions: string[] = [];
    const values: unknown[] = [];

    const status = (params.status as string | undefined) ?? 'pending';
    values.push(status);
    conditions.push(`a.status = $${values.length}`);

    if (params.destination) {
      values.push(params.destination);
      conditions.push(`a.destination = $${values.length}`);
    }
    if (params.customer_tenant_id) {
      values.push(params.customer_tenant_id);
      conditions.push(`a.customer_tenant_id = $${values.length}`);
    }

    const limit = Math.min(parseInt(String(params.limit ?? '50'), 10), 200);
    values.push(limit);

    const { rows } = await pool.query(
      `SELECT a.id, a.tenant_id, a.customer_tenant_id, a.content_id,
              a.kind, a.destination, a.payload, a.status,
              a.slack_channel_id, a.slack_message_ts,
              a.decision_by, a.decision_at, a.decision_reason,
              a.expires_at, a.created_at
       FROM slack_approvals a
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.created_at DESC
       LIMIT $${values.length}`,
      values,
    );

    return { count: rows.length, approvals: rows };
  },
};

// ─── approve_item ────────────────────────────────────────────────────────────

const approveItem: ToolDefinition = {
  name: 'approve_item',
  description:
    'Approve a pending slack_approval by its UUID. Updates status to "approved" and ' +
    'marks the linked customer_content as processed.',
  inputSchema: {
    type: 'object',
    properties: {
      approval_id: {
        type: 'string',
        description: 'UUID of the slack_approvals row to approve.',
      },
      approved_by: {
        type: 'string',
        description: 'Identifier of the agent or human making the decision.',
      },
      reason: {
        type: 'string',
        description: 'Optional reason / notes for the approval.',
      },
    },
    required: ['approval_id', 'approved_by'],
  },
  async handler(pool, params) {
    const approvalId = params.approval_id as string;
    const approvedBy = params.approved_by as string;
    const reason = (params.reason as string | undefined) ?? null;

    const { rows } = await pool.query(
      `UPDATE slack_approvals
       SET status = 'approved', decision_by = $1, decision_at = NOW(),
           decision_reason = $2, updated_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING id, status, destination, payload`,
      [approvedBy, reason, approvalId],
    );

    if (rows.length === 0) {
      throw Object.assign(
        new Error(`Approval ${approvalId} not found or already decided`),
        { code: -32602 },
      );
    }

    const approval = rows[0] as Record<string, unknown>;

    // Mark linked content as processed
    await pool.query(
      `UPDATE customer_content
       SET status = 'processed', processed_at = NOW(), updated_at = NOW()
       WHERE id = (
         SELECT content_id FROM slack_approvals WHERE id = $1
       ) AND status IN ('pending','processing')`,
      [approvalId],
    );

    return { approved: true, approval };
  },
};

// ─── reject_item ─────────────────────────────────────────────────────────────

const rejectItem: ToolDefinition = {
  name: 'reject_item',
  description:
    'Reject a pending slack_approval by its UUID. Updates status to "rejected" and ' +
    'marks the linked customer_content as failed.',
  inputSchema: {
    type: 'object',
    properties: {
      approval_id: {
        type: 'string',
        description: 'UUID of the slack_approvals row to reject.',
      },
      rejected_by: {
        type: 'string',
        description: 'Identifier of the agent or human making the decision.',
      },
      reason: {
        type: 'string',
        description: 'Required reason for rejection.',
      },
    },
    required: ['approval_id', 'rejected_by', 'reason'],
  },
  async handler(pool, params) {
    const approvalId = params.approval_id as string;
    const rejectedBy = params.rejected_by as string;
    const reason = params.reason as string;

    const { rows } = await pool.query(
      `UPDATE slack_approvals
       SET status = 'rejected', decision_by = $1, decision_at = NOW(),
           decision_reason = $2, updated_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING id, status, destination, payload`,
      [rejectedBy, reason, approvalId],
    );

    if (rows.length === 0) {
      throw Object.assign(
        new Error(`Approval ${approvalId} not found or already decided`),
        { code: -32602 },
      );
    }

    const approval = rows[0] as Record<string, unknown>;

    await pool.query(
      `UPDATE customer_content
       SET status = 'failed', processed_at = NOW(), updated_at = NOW()
       WHERE id = (
         SELECT content_id FROM slack_approvals WHERE id = $1
       ) AND status IN ('pending','processing')`,
      [approvalId],
    );

    return { rejected: true, approval };
  },
};

// ─── route_content ───────────────────────────────────────────────────────────

const routeContent: ToolDefinition = {
  name: 'route_content',
  description:
    'Manually route a customer_content item by setting its status to processing and ' +
    'recording the destination in the metadata field. ' +
    'Use when automated routing needs to be overridden.',
  inputSchema: {
    type: 'object',
    properties: {
      content_id: {
        type: 'string',
        description: 'UUID of the customer_content row to route.',
      },
      destination: {
        type: 'string',
        description: 'Destination team (e.g. "support", "billing", "engineering", "sales").',
      },
      routed_by: {
        type: 'string',
        description: 'Agent role or user making the routing decision.',
      },
    },
    required: ['content_id', 'destination', 'routed_by'],
  },
  async handler(pool, params) {
    const contentId = params.content_id as string;
    const destination = params.destination as string;
    const routedBy = params.routed_by as string;

    const { rows } = await pool.query(
      `UPDATE customer_content
       SET status = 'processing',
           metadata = metadata || jsonb_build_object(
             'destination', $1::text,
             'routed_by', $2::text,
             'routed_at', NOW()::text
           ),
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, status, metadata`,
      [destination, routedBy, contentId],
    );

    if (rows.length === 0) {
      throw Object.assign(new Error(`Content ${contentId} not found`), { code: -32602 });
    }

    return { routed: true, content: rows[0] };
  },
};

// ─── Export ───────────────────────────────────────────────────────────────────

export const tools: ToolDefinition[] = [
  listPendingContent,
  getRoutingStats,
  listApprovals,
  approveItem,
  rejectItem,
  routeContent,
];
