/**
 * Directive Approval — Webhook Handler
 *
 * Handles approve/reject decisions from founder Teams/Slack card buttons.
 * Tokens are time-limited (48h), single-use, and tied to specific directives.
 *
 * GET shows a confirmation page (safe from Slack/Teams link unfurling).
 * POST from the confirmation page actually processes the decision.
 *
 * Routes:
 *   GET  /directives/approve/:token  → confirmation page
 *   GET  /directives/reject/:token   → confirmation page
 *   POST /directives/approve/:token  → process approval
 *   POST /directives/reject/:token   → process rejection
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { systemQuery } from '@glyphor/shared/db';

function renderDirectiveDecisionPage(
  status: 'approved' | 'rejected' | 'expired' | 'already_resolved',
  directiveTitle?: string,
): string {
  const titles: Record<string, string> = {
    approved: '✓ Directive Approved',
    rejected: '✕ Directive Rejected',
    expired: 'Link Expired',
    already_resolved: 'Already Resolved',
  };
  const bodies: Record<string, string> = {
    approved: `The directive has been approved and is now active.${directiveTitle ? `<br><br><strong>${directiveTitle}</strong>` : ''}`,
    rejected: `The directive has been rejected.${directiveTitle ? `<br><br><strong>${directiveTitle}</strong>` : ''}`,
    expired: 'This approval link has expired or has already been used.',
    already_resolved: 'This directive has already been approved or rejected.',
  };

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Glyphor — ${titles[status]}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1A1D2E;color:#fff}
.card{background:#252836;border-radius:12px;padding:40px;max-width:480px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.3)}
h1{font-size:1.5rem;margin-bottom:12px}p{color:#999;line-height:1.6}strong{color:#fff}</style></head>
<body><div class="card"><h1>${titles[status]}</h1><p>${bodies[status]}</p></div></body></html>`;
}

/**
 * Renders a confirmation page that POSTs back to the same URL on button click.
 * This prevents Slack/Teams link unfurling from auto-triggering the decision.
 */
function renderConfirmationPage(
  decision: 'approve' | 'reject',
  token: string,
  directiveTitle: string,
): string {
  const action = decision === 'approve' ? 'Approve' : 'Reject';
  const color = decision === 'approve' ? '#4CAF50' : '#f44336';
  const actionUrl = `/directives/${decision}/${token}`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Glyphor — Confirm ${action}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1A1D2E;color:#fff}
.card{background:#252836;border-radius:12px;padding:40px;max-width:480px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.3)}
h1{font-size:1.5rem;margin-bottom:12px}p{color:#999;line-height:1.6}strong{color:#fff}
button{margin-top:20px;padding:12px 32px;font-size:1rem;font-weight:600;border:none;border-radius:8px;cursor:pointer;color:#fff;background:${color}}
button:hover{opacity:.9}</style></head>
<body><div class="card">
<h1>${action} Directive?</h1>
<p><strong>${directiveTitle}</strong></p>
<form method="POST" action="${actionUrl}">
<button type="submit">${action === 'Approve' ? '✓' : '✕'} Confirm ${action}</button>
</form>
</div></body></html>`;
}

export async function handleDirectiveApproval(
  url: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const approveMatch = url.match(/^\/directives\/approve\/([a-f0-9]+)$/);
  const rejectMatch = url.match(/^\/directives\/reject\/([a-f0-9]+)$/);

  if (!approveMatch && !rejectMatch) return false;

  const token = (approveMatch ?? rejectMatch)![1];
  const decision: 'approve' | 'reject' = approveMatch ? 'approve' : 'reject';
  const method = req.method?.toUpperCase();

  // Lookup and validate token
  const [tokenRow] = await systemQuery<{
    id: string;
    directive_id: string;
    decision: string;
    expires_at: string;
    used_at: string | null;
  }>(
    `SELECT * FROM directive_approval_tokens WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [token],
  );

  if (!tokenRow) {
    res.writeHead(410, { 'Content-Type': 'text/html' });
    res.end(renderDirectiveDecisionPage('expired'));
    return true;
  }

  // Fetch the directive for title display
  const [directive] = await systemQuery<{ id: string; title: string; status: string }>(
    `SELECT id, title, status FROM founder_directives WHERE id = $1`,
    [tokenRow.directive_id],
  );

  if (!directive) {
    res.writeHead(410, { 'Content-Type': 'text/html' });
    res.end(renderDirectiveDecisionPage('expired'));
    return true;
  }

  if (directive.status !== 'proposed') {
    res.writeHead(409, { 'Content-Type': 'text/html' });
    res.end(renderDirectiveDecisionPage('already_resolved', directive.title));
    return true;
  }

  // GET: Show confirmation page (safe from link unfurling)
  if (method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderConfirmationPage(decision, token, directive.title));
    return true;
  }

  // POST: Process the decision
  // Mark token used immediately (prevent double-click)
  await systemQuery(
    `UPDATE directive_approval_tokens SET used_at = NOW() WHERE id = $1`,
    [tokenRow.id],
  );

  // Also invalidate the sibling token (if user approved, burn the reject token too)
  await systemQuery(
    `UPDATE directive_approval_tokens SET used_at = NOW() WHERE directive_id = $1 AND id != $2 AND used_at IS NULL`,
    [tokenRow.directive_id, tokenRow.id],
  );

  const newStatus = decision === 'approve' ? 'active' : 'rejected';

  await systemQuery(
    `UPDATE founder_directives SET status = $1, updated_at = NOW() WHERE id = $2`,
    [newStatus, directive.id],
  );

  await systemQuery(
    `INSERT INTO activity_log (agent_role, action, summary)
     VALUES ('system', $1, $2)`,
    [
      decision === 'approve' ? 'directive_approved' : 'directive_rejected',
      `Directive "${directive.title}" ${newStatus} via approval link`,
    ],
  );

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(renderDirectiveDecisionPage(decision === 'approve' ? 'approved' : 'rejected', directive.title));
  return true;
}
