/**
 * Platform Intel — Approval Webhook Handler
 *
 * Handles approve/reject decisions from founder Teams cards.
 * Tokens are time-limited (48h), single-use, and tied to specific actions.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { systemQuery } from '@glyphor/shared/db';

interface PlatformIntelAction {
  id: string;
  action_type: string;
  tier: string;
  target_agent_id: string | null;
  description: string;
  payload: Record<string, unknown>;
  status: string;
  teams_message_id: string | null;
  teams_conversation_id: string | null;
}

function renderDecisionPage(
  status: 'approved' | 'rejected' | 'expired' | 'already_resolved' | 'failed',
  description?: string,
): string {
  const titles: Record<string, string> = {
    approved: '✓ Action Approved',
    rejected: '✕ Action Rejected',
    expired: 'Token Expired',
    already_resolved: 'Already Resolved',
    failed: 'Execution Failed',
  };
  const bodies: Record<string, string> = {
    approved: `The action has been approved and executed.${description ? `<br><br><em>${description}</em>` : ''}`,
    rejected: `The action has been rejected.${description ? `<br><br><em>${description}</em>` : ''}`,
    expired: 'This approval link has expired or has already been used.',
    already_resolved: 'This action has already been resolved by another decision.',
    failed: 'The action was approved but failed during execution. Check the dashboard for details.',
  };

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Nexus — ${titles[status]}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1A1D2E;color:#fff}
.card{background:#252836;border-radius:12px;padding:40px;max-width:480px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.3)}
h1{font-size:1.5rem;margin-bottom:12px}p{color:#999;line-height:1.6}</style></head>
<body><div class="card"><h1>${titles[status]}</h1><p>${bodies[status]}</p></div></body></html>`;
}

function renderConfirmationPage(
  decision: 'approve' | 'reject',
  tokenPath: string,
): string {
  const isApprove = decision === 'approve';
  const title = isApprove ? 'Confirm Approval' : 'Confirm Rejection';
  const buttonLabel = isApprove ? 'Approve Action' : 'Reject Action';
  const buttonClass = isApprove ? 'approve' : 'reject';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Nexus — ${title}</title>
<style>
body{font-family:-apple-system,system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1A1D2E;color:#fff}
.card{background:#252836;border-radius:12px;padding:36px;max-width:520px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.3)}
h1{font-size:1.5rem;margin-bottom:12px}
p{color:#b7b7b7;line-height:1.6;margin-bottom:24px}
.btn{display:inline-block;padding:12px 20px;border-radius:8px;color:#fff;text-decoration:none;font-weight:600}
.approve{background:#0f9d58}
.reject{background:#c5221f}
</style></head>
<body><div class="card"><h1>${title}</h1><p>Confirm your decision to continue. This extra step prevents automated link scanners from consuming one-time tokens.</p><a class="btn ${buttonClass}" href="${tokenPath}?confirm=1">${buttonLabel}</a></div></body></html>`;
}

async function executeApprovedAction(action: PlatformIntelAction): Promise<void> {
  const payload = action.payload;

  switch (action.action_type) {
    case 'update_gtm_threshold':
      await systemQuery(
        `UPDATE gtm_readiness_thresholds SET value = $1, updated_at = NOW() WHERE key = $2`,
        [payload.value, payload.key],
      );
      break;

    case 'pause_gtm_agent':
      if (!action.target_agent_id) throw new Error('Missing target_agent_id');
      await systemQuery(
        `UPDATE company_agents SET status = 'paused', updated_at = NOW() WHERE role = $1`,
        [action.target_agent_id],
      );
      break;

    case 'update_agent_dependencies':
      if (!action.target_agent_id) throw new Error('Missing target_agent_id');
      await systemQuery(
        `UPDATE company_agents SET dependencies = $1, updated_at = NOW() WHERE role = $2`,
        [JSON.stringify(payload.new_dependencies), action.target_agent_id],
      );
      break;

    case 'modify_tool_access': {
      const targetRole = action.target_agent_id;
      if (!targetRole) throw new Error('Missing target_agent_id');
      const toolsToAdd = Array.isArray(payload.tools_to_add) ? payload.tools_to_add : [];
      const toolsToRemove = Array.isArray(payload.tools_to_remove) ? payload.tools_to_remove : [];
      for (const tool of toolsToAdd) {
        await systemQuery(
          `INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, last_synced_at)
           VALUES ($1, $2, 'platform-intel', NOW()) ON CONFLICT DO NOTHING`,
          [targetRole, tool],
        );
      }
      for (const tool of toolsToRemove) {
        await systemQuery(
          `DELETE FROM agent_tool_grants WHERE agent_role = $1 AND tool_name = $2`,
          [targetRole, tool],
        );
      }
      break;
    }

    case 'grant_tool_access': {
      const targetRole = action.target_agent_id;
      if (!targetRole) throw new Error('Missing target_agent_id');
      const toolName = payload.tool_name as string;
      if (!toolName) throw new Error('Missing tool_name in payload');
      await systemQuery(
        `INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, reason, last_synced_at)
         VALUES ($1, $2, 'platform-intel', $3, NOW())
         ON CONFLICT (agent_role, tool_name) DO UPDATE
           SET is_active = true, granted_by = 'platform-intel', reason = EXCLUDED.reason, last_synced_at = NOW(), updated_at = NOW()`,
        [targetRole, toolName, payload.reason ?? 'Approved via Nexus approval card'],
      );
      break;
    }

    case 'apply_fix_proposal': {
      // Mark the fix proposal as approved and queue Nexus to execute the fix.
      const proposalId = payload.proposal_id as string;
      if (proposalId) {
        await systemQuery(
          `UPDATE tool_fix_proposals SET status = 'approved', reviewed_by = 'founder', reviewed_at = NOW() WHERE id = $1`,
          [proposalId],
        );

        const [proposal] = await systemQuery<{ tool_name: string; affected_agents: string[] }>(
          `SELECT tool_name, affected_agents FROM tool_fix_proposals WHERE id = $1`,
          [proposalId],
        );

        if (proposal) {
          await systemQuery(
            `INSERT INTO agent_wake_queue (agent_role, task, reason, context, status)
             VALUES ($1, $2, $3, $4::jsonb, 'pending')`,
            [
              'platform-intel',
              'apply_fix_proposal',
              `Approved fix proposal ${proposalId} for ${proposal.tool_name}; execute and mark applied`,
              JSON.stringify({
                task: 'apply_fix_proposal',
                proposal_id: proposalId,
                tool_name: proposal.tool_name,
                affected_agents: proposal.affected_agents,
                message: `Execute approved tool fix proposal ${proposalId} for ${proposal.tool_name}. After implementation, call mark_tool_fix_applied with execution_notes including files/branch/commit.`,
              }),
            ],
          );
        }
      }
      break;
    }

    default:
      // Log the unknown action type rather than crashing
      console.error(`[PlatformIntelApproval] Unknown action type: ${action.action_type}`);
      await systemQuery(
        `INSERT INTO activity_log (agent_role, action, summary, details)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
          'system',
          'approval_execution_skipped',
          `Unknown approval action type: ${action.action_type}`,
          JSON.stringify({ action_id: action.id, action_type: action.action_type, payload }),
        ],
      );
      break;
  }
}

export async function handlePlatformIntelApproval(
  url: string,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const [pathPart, queryPart = ''] = url.split('?');
  const query = new URLSearchParams(queryPart);
  const confirmed = query.get('confirm') === '1';

  // Match GET /platform-intel/approve/:token or /platform-intel/reject/:token
  const approveMatch = pathPart.match(/^\/platform-intel\/approve\/([a-f0-9]+)$/);
  const rejectMatch = pathPart.match(/^\/platform-intel\/reject\/([a-f0-9]+)$/);

  if (!approveMatch && !rejectMatch) return false;

  const token = (approveMatch ?? rejectMatch)![1];
  const decision: 'approve' | 'reject' = approveMatch ? 'approve' : 'reject';

  // First hit renders a confirmation page and does not consume token.
  if (!confirmed) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderConfirmationPage(decision, pathPart));
    return true;
  }

  const [tokenRow] = await systemQuery<{
    id: string;
    action_id: string;
    decision: string;
    expires_at: string;
    used_at: string | null;
  }>(
    `SELECT * FROM approval_tokens WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [token],
  );

  if (!tokenRow) {
    res.writeHead(410, { 'Content-Type': 'text/html' });
    res.end(renderDecisionPage('expired'));
    return true;
  }

  // Mark token used immediately (prevent double-click)
  await systemQuery(
    `UPDATE approval_tokens SET used_at = NOW() WHERE id = $1`,
    [tokenRow.id],
  );

  const [action] = await systemQuery<PlatformIntelAction>(
    `SELECT * FROM platform_intel_actions WHERE id = $1`,
    [tokenRow.action_id],
  );

  if (!action || action.status !== 'pending') {
    res.writeHead(409, { 'Content-Type': 'text/html' });
    res.end(renderDecisionPage('already_resolved'));
    return true;
  }

  if (decision === 'approve') {
    try {
      await executeApprovedAction(action);
      await systemQuery(
        `UPDATE platform_intel_actions SET status = 'approved', approval_response_at = NOW() WHERE id = $1`,
        [action.id],
      );
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(renderDecisionPage('approved', action.description));
    } catch (err) {
      await systemQuery(
        `UPDATE platform_intel_actions SET status = 'failed', failure_reason = $2 WHERE id = $1`,
        [action.id, String(err)],
      );
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(renderDecisionPage('failed'));
    }
  } else {
    await systemQuery(
      `UPDATE platform_intel_actions SET status = 'rejected', approval_response_at = NOW() WHERE id = $1`,
      [action.id],
    );
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderDecisionPage('rejected', action.description));
  }

  return true;
}
