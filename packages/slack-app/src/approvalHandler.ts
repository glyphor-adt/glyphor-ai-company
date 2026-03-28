/**
 * Approval workflow — persists and processes slack_approvals rows.
 *
 * Lifecycle:
 *   createApproval()       — inserts row with status='pending'
 *   handleApprovalAction() — processes approve/reject (button clicks)
 *   expireStaleApprovals() — marks overdue rows as 'expired'
 *
 * Slack button action_ids must follow the convention:
 *   approve_<approval_id>
 *   reject_<approval_id>
 */

import { systemQuery } from '@glyphor/shared/db';
import type { DbCustomerTenant } from './types.js';
import { postMessage, updateMessage, getCustomerTenantById } from './slackClient.js';
import type { RoutingDecision } from './router.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApprovalCreateOptions {
  customerTenant: DbCustomerTenant;
  contentId: string;
  decision: RoutingDecision;
  originalText: string;
  slackChannelId: string;
  slackMessageTs: string;
  submittedBy: string | null;
}

export interface DbSlackApproval {
  id: string;
  tenant_id: string;
  customer_tenant_id: string | null;
  content_id: string | null;
  kind: 'message' | 'file' | 'request' | 'escalation';
  destination: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  slack_channel_id: string | null;
  slack_message_ts: string | null;
  decision_by: string | null;
  decision_at: string | null;
  decision_reason: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createApproval(opts: ApprovalCreateOptions): Promise<string> {
  const { customerTenant, contentId, decision, originalText, slackChannelId, slackMessageTs, submittedBy } = opts;

  const payload = {
    text: originalText.slice(0, 2000),
    destination: decision.destination,
    intent_label: decision.intentLabel,
    submitted_by: submittedBy,
  };

  const kind = decision.intentLabel === 'escalation' ? 'escalation' : 'message';

  const rows = await systemQuery<{ id: string }>(
    `INSERT INTO slack_approvals
       (tenant_id, customer_tenant_id, content_id, kind, destination, payload,
        status, slack_channel_id, slack_message_ts)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
     RETURNING id`,
    [
      customerTenant.tenant_id,
      customerTenant.id,
      contentId,
      kind,
      decision.destination,
      JSON.stringify(payload),
      slackChannelId,
      slackMessageTs,
    ],
  );

  const approvalId = rows[0]?.id;
  if (!approvalId) throw new Error('Failed to create approval row');

  // Post an interactive message in the same thread asking for approval
  await postMessage(customerTenant.bot_token, {
    channel: slackChannelId,
    thread_ts: slackMessageTs,
    text: `⚠️ This message has been flagged for review (${decision.intentLabel}).`,
    blocks: buildApprovalBlocks(approvalId, originalText, decision),
  });

  return approvalId;
}

// ─── Process action ──────────────────────────────────────────────────────────

export async function handleApprovalAction(
  actionId: string,
  decisionBy: string,
  reason?: string,
): Promise<{ ok: boolean; approvalId?: string; status?: string }> {
  // action_id format: approve_<uuid> or reject_<uuid>
  const match = /^(approve|reject)_([0-9a-f-]{36})$/i.exec(actionId);
  if (!match) return { ok: false };

  const verb = match[1] as string;
  const approvalId = match[2] as string;
  const newStatus = verb === 'approve' ? 'approved' : 'rejected';

  const rows = await systemQuery<DbSlackApproval>(
    `UPDATE slack_approvals
     SET status = $1, decision_by = $2, decision_at = NOW(),
         decision_reason = $3, updated_at = NOW()
     WHERE id = $4 AND status = 'pending'
     RETURNING *`,
    [newStatus, decisionBy, reason ?? null, approvalId],
  );

  if (rows.length === 0) return { ok: false };

  const approval = rows[0];

  // Update the linked content_id status to reflect the decision
  if (approval.content_id) {
    await systemQuery(
      `UPDATE customer_content
       SET status = $1, processed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [newStatus === 'approved' ? 'processed' : 'failed', approval.content_id],
    );
  }

  // ── Post-decision side effects ───────────────────────────────────────

  // Load tenant for posting follow-up messages
  const ct = approval.customer_tenant_id
    ? await getCustomerTenantById(approval.customer_tenant_id)
    : null;

  if (newStatus === 'approved') {
    // Dispatch to agent_wake_queue so the originating agent can continue
    const agentRole = (approval.payload?.agent_role as string) ?? 'cmo';
    await systemQuery(
      `INSERT INTO agent_wake_queue (agent_role, task, reason, context)
       VALUES ($1, 'approval_granted', $2, $3)`,
      [
        agentRole,
        `Approval ${approvalId} granted by ${decisionBy}`,
        JSON.stringify({
          approval_id: approvalId,
          content_id: approval.content_id,
          destination: approval.destination,
          payload: approval.payload,
        }),
      ],
    );

    // Post confirmation to the Slack thread
    if (ct && approval.slack_channel_id && approval.slack_message_ts) {
      await postMessage(ct.bot_token, {
        channel: approval.slack_channel_id,
        thread_ts: approval.slack_message_ts,
        text: `Approved. Executing now.`,
      });
    }
  } else {
    // Rejected — write negative world model evidence
    const agentRole = (approval.payload?.agent_role as string) ?? 'cmo';
    const intentLabel = (approval.payload?.intent_label as string) ?? 'unknown';
    await systemQuery(
      `INSERT INTO agent_world_model_evidence
         (agent_role, evidence_type, skill, description, weight)
       VALUES ($1, 'negative', $2, $3, 1.0)`,
      [
        agentRole,
        intentLabel,
        `Approval ${approvalId} rejected by ${decisionBy}. Reason: ${reason ?? 'none given'}. Destination: ${approval.destination}`,
      ],
    );

    // Post rejection to the Slack thread
    if (ct && approval.slack_channel_id && approval.slack_message_ts) {
      await postMessage(ct.bot_token, {
        channel: approval.slack_channel_id,
        thread_ts: approval.slack_message_ts,
        text: `Rejected.${reason ? ` Reason: ${reason}` : ''} I'll adjust next time.`,
      });
    }
  }

  return { ok: true, approvalId, status: newStatus };
}

// ─── Expire stale ────────────────────────────────────────────────────────────

export async function expireStaleApprovals(): Promise<number> {
  const rows = await systemQuery<{ count: string }>(
    `WITH expired AS (
       UPDATE slack_approvals
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'pending' AND expires_at < NOW()
       RETURNING id
     )
     SELECT COUNT(*)::text AS count FROM expired`,
    [],
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApprovalBlocks(
  approvalId: string,
  originalText: string,
  decision: RoutingDecision,
): unknown[] {
  const preview = originalText.length > 300 ? originalText.slice(0, 297) + '…' : originalText;
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Approval Required — ${decision.intentLabel}*\n>${preview}\n\nRouted to: *${decision.destination}*`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Approve', emoji: true },
          style: 'primary',
          action_id: `approve_${approvalId}`,
          value: approvalId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Reject', emoji: true },
          style: 'danger',
          action_id: `reject_${approvalId}`,
          value: approvalId,
        },
      ],
    },
  ];
}
