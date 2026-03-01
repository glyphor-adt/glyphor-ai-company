/**
 * Change Request Handler — Processes dashboard change requests
 *
 * Scans for new 'submitted' change requests from founders, creates
 * GitHub issues assigned to Copilot coding agent, and tracks PR progress.
 *
 * Called by the heartbeat every cycle to keep requests flowing.
 */

import { systemQuery } from '@glyphor/shared/db';
import { createIssueForCopilot, findPRForIssue } from '@glyphor/integrations';

interface ChangeRequest {
  id: string;
  submitted_by: string;
  title: string;
  description: string;
  request_type: string;
  priority: string;
  status: string;
  affected_area: string | null;
  assigned_to: string | null;
  approved_by: string | null;
  approved_at: string | null;
  github_issue_number: number | null;
  github_issue_url: string | null;
  github_branch: string | null;
  github_pr_url: string | null;
  commit_sha: string | null;
  agent_notes: string | null;
  started_at: string | null;
  completed_at: string | null;
}

/**
 * Build a well-structured GitHub issue body for Copilot to implement.
 * Includes repo context so Copilot knows where to look.
 */
function buildIssueBody(req: ChangeRequest): string {
  const typeLabel = {
    feature: 'Feature Request',
    fix: 'Bug Fix',
    improvement: 'Improvement',
    refactor: 'Refactor',
  }[req.request_type] ?? 'Change Request';

  const areaHint = req.affected_area
    ? `\n\n**Affected Area:** \`${req.affected_area}\`\n` +
      `> The dashboard code lives in \`packages/dashboard/src/\`. ` +
      `Pages are in \`packages/dashboard/src/pages/\`, components in \`packages/dashboard/src/components/\`, ` +
      `hooks in \`packages/dashboard/src/lib/hooks.ts\`, types in \`packages/dashboard/src/lib/types.ts\`. ` +
      `The app uses React + TypeScript + Tailwind CSS + Supabase.\n`
    : '';

  return `## ${typeLabel}

**Submitted by:** ${req.submitted_by}
**Priority:** ${req.priority}
${areaHint}
### Description

${req.description}

### Implementation Notes

- This is a dashboard change request from a Glyphor founder
- The dashboard is a React + TypeScript + Vite app in \`packages/dashboard/\`
- Styling uses **Tailwind CSS** with custom design tokens (see \`tailwind.config.js\`)
- Data layer uses **Supabase** (\`packages/dashboard/src/lib/supabase.ts\`)
- Follow existing patterns in nearby files for consistency
- If a new Supabase table is needed, add a migration in \`supabase/migrations/\`

---
*Auto-generated from dashboard change request #${req.id.slice(0, 8)}*`;
}

/**
 * Process new change requests: create GitHub issues assigned to Copilot.
 * Called by the heartbeat manager on each cycle.
 */
export async function processNewChangeRequests(): Promise<number> {
  // Fetch submitted requests that haven't been sent to GitHub yet
  const requests = await systemQuery(
    'SELECT * FROM dashboard_change_requests WHERE status=$1 AND github_issue_number IS NULL ORDER BY created_at ASC LIMIT $2',
    ['submitted', 5]
  ); // Process max 5 per cycle to avoid rate limits

  if (!requests?.length) return 0;

  let processed = 0;

  for (const req of requests as ChangeRequest[]) {
    try {
      // Claim the row first to prevent duplicate processing on next heartbeat
      const claimed = await systemQuery(
        'UPDATE dashboard_change_requests SET status=$1, updated_at=$2 WHERE id=$3 AND status=$4 RETURNING id',
        ['triaged', new Date().toISOString(), req.id, 'submitted']
      );

      if (!claimed?.length) {
        // Another cycle already claimed this row — skip
        continue;
      }

      // Create GitHub issue assigned to Copilot
      const issueTitle = `[${req.request_type}] ${req.title}`;
      const issueBody = buildIssueBody(req);
      const labels = [
        `type:${req.request_type}`,
        `priority:${req.priority}`,
        'dashboard',
        ...(req.affected_area ? [`area:${req.affected_area}`] : []),
      ];

      const issue = await createIssueForCopilot('company', issueTitle, issueBody, labels);

      // Update the change request with issue info
      await systemQuery(
        'UPDATE dashboard_change_requests SET assigned_to=$1, github_issue_number=$2, github_issue_url=$3, agent_notes=$4, updated_at=$5 WHERE id=$6',
        [
          'copilot',
          issue.number,
          issue.url,
          `GitHub issue #${issue.number} created and assigned to Copilot coding agent. Waiting for Copilot to create a PR.`,
          new Date().toISOString(),
          req.id,
        ]
      );

      console.log(`[ChangeRequests] Created issue #${issue.number} for request "${req.title}" → assigned to Copilot`);
      processed++;
    } catch (err) {
      console.error(`[ChangeRequests] Failed to process request "${req.title}":`, (err as Error).message);

      // Revert to submitted so it retries next cycle
      await systemQuery(
        'UPDATE dashboard_change_requests SET status=$1, agent_notes=$2, updated_at=$3 WHERE id=$4',
        [
          'submitted',
          `Failed to create GitHub issue: ${(err as Error).message}. Will retry next cycle.`,
          new Date().toISOString(),
          req.id,
        ]
      );
    }
  }

  return processed;
}

/**
 * Check on in-progress change requests: look for Copilot's PRs.
 * Called by the heartbeat to update status as Copilot works.
 */
export async function syncChangeRequestProgress(): Promise<number> {
  // Fetch requests that are triaged or in_progress (waiting for Copilot)
  const requests = await systemQuery(
    'SELECT * FROM dashboard_change_requests WHERE status = ANY($1) AND github_issue_number IS NOT NULL ORDER BY updated_at ASC LIMIT $2',
    [['triaged', 'in_progress'], 10]
  );

  if (!requests?.length) return 0;

  let updated = 0;

  for (const req of requests as ChangeRequest[]) {
    if (!req.github_issue_number) continue;

    try {
      const pr = await findPRForIssue('company', req.github_issue_number);

      if (pr && !req.github_pr_url) {
        // Copilot created a PR — update status
        const newStatus = pr.draft ? 'in_progress' : 'review';
        await systemQuery(
          'UPDATE dashboard_change_requests SET status=$1, github_branch=$2, github_pr_url=$3, commit_sha=$4, started_at=$5, agent_notes=$6, updated_at=$7 WHERE id=$8',
          [
            newStatus,
            pr.branch,
            pr.url,
            pr.sha,
            req.started_at ?? new Date().toISOString(),
            pr.draft
              ? `Copilot is working — draft PR #${pr.number} created on branch \`${pr.branch}\`.`
              : `Copilot completed implementation — PR #${pr.number} is ready for review.`,
            new Date().toISOString(),
            req.id,
          ]
        );

        console.log(`[ChangeRequests] PR #${pr.number} found for request "${req.title}" → ${newStatus}`);
        updated++;
      } else if (pr && req.github_pr_url) {
        // PR already known — check if status changed (draft → ready, or merged)
        if (pr.state === 'closed') {
          // PR was merged or closed
          await systemQuery(
            'UPDATE dashboard_change_requests SET status=$1, commit_sha=$2, completed_at=$3, agent_notes=$4, updated_at=$5 WHERE id=$6',
            [
              'deployed',
              pr.sha,
              new Date().toISOString(),
              `PR #${pr.number} has been merged. Changes deployed.`,
              new Date().toISOString(),
              req.id,
            ]
          );

          console.log(`[ChangeRequests] PR #${pr.number} merged for "${req.title}" → deployed`);
          updated++;
        } else if (!pr.draft && req.status === 'in_progress') {
          // Draft → ready for review
          await systemQuery(
            'UPDATE dashboard_change_requests SET status=$1, commit_sha=$2, agent_notes=$3, updated_at=$4 WHERE id=$5',
            [
              'review',
              pr.sha,
              `Copilot completed implementation — PR #${pr.number} is ready for review.`,
              new Date().toISOString(),
              req.id,
            ]
          );

          updated++;
        }
      }
    } catch (err) {
      console.warn(`[ChangeRequests] Failed to sync progress for "${req.title}":`, (err as Error).message);
    }
  }

  return updated;
}
