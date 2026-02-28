/**
 * Change Request Handler — Processes dashboard change requests
 *
 * Scans for new 'submitted' change requests from founders, creates
 * GitHub issues assigned to Copilot coding agent, and tracks PR progress.
 *
 * Called by the heartbeat every cycle to keep requests flowing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
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
export async function processNewChangeRequests(supabase: SupabaseClient): Promise<number> {
  // Fetch submitted requests that haven't been sent to GitHub yet
  const { data: requests } = await supabase
    .from('dashboard_change_requests')
    .select('*')
    .eq('status', 'submitted')
    .order('created_at', { ascending: true })
    .limit(5); // Process max 5 per cycle to avoid rate limits

  if (!requests?.length) return 0;

  let processed = 0;

  for (const req of requests as ChangeRequest[]) {
    try {
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
      await supabase
        .from('dashboard_change_requests')
        .update({
          status: 'triaged',
          assigned_to: 'copilot',
          github_issue_number: issue.number,
          github_issue_url: issue.url,
          agent_notes: `GitHub issue #${issue.number} created and assigned to Copilot coding agent. Waiting for Copilot to create a PR.`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', req.id);

      console.log(`[ChangeRequests] Created issue #${issue.number} for request "${req.title}" → assigned to Copilot`);
      processed++;
    } catch (err) {
      console.error(`[ChangeRequests] Failed to process request "${req.title}":`, (err as Error).message);

      // Update with error note but don't block
      await supabase
        .from('dashboard_change_requests')
        .update({
          agent_notes: `Failed to create GitHub issue: ${(err as Error).message}. Will retry next cycle.`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', req.id);
    }
  }

  return processed;
}

/**
 * Check on in-progress change requests: look for Copilot's PRs.
 * Called by the heartbeat to update status as Copilot works.
 */
export async function syncChangeRequestProgress(supabase: SupabaseClient): Promise<number> {
  // Fetch requests that are triaged or in_progress (waiting for Copilot)
  const { data: requests } = await supabase
    .from('dashboard_change_requests')
    .select('*')
    .in('status', ['triaged', 'in_progress'])
    .not('github_issue_number', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(10);

  if (!requests?.length) return 0;

  let updated = 0;

  for (const req of requests as ChangeRequest[]) {
    if (!req.github_issue_number) continue;

    try {
      const pr = await findPRForIssue('company', req.github_issue_number);

      if (pr && !req.github_pr_url) {
        // Copilot created a PR — update status
        const newStatus = pr.draft ? 'in_progress' : 'review';
        await supabase
          .from('dashboard_change_requests')
          .update({
            status: newStatus,
            github_branch: pr.branch,
            github_pr_url: pr.url,
            commit_sha: pr.sha,
            started_at: req.started_at ?? new Date().toISOString(),
            agent_notes: pr.draft
              ? `Copilot is working — draft PR #${pr.number} created on branch \`${pr.branch}\`.`
              : `Copilot completed implementation — PR #${pr.number} is ready for review.`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', req.id);

        console.log(`[ChangeRequests] PR #${pr.number} found for request "${req.title}" → ${newStatus}`);
        updated++;
      } else if (pr && req.github_pr_url) {
        // PR already known — check if status changed (draft → ready, or merged)
        if (pr.state === 'closed') {
          // PR was merged or closed
          await supabase
            .from('dashboard_change_requests')
            .update({
              status: 'deployed',
              commit_sha: pr.sha,
              completed_at: new Date().toISOString(),
              agent_notes: `PR #${pr.number} has been merged. Changes deployed.`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', req.id);

          console.log(`[ChangeRequests] PR #${pr.number} merged for "${req.title}" → deployed`);
          updated++;
        } else if (!pr.draft && req.status === 'in_progress') {
          // Draft → ready for review
          await supabase
            .from('dashboard_change_requests')
            .update({
              status: 'review',
              commit_sha: pr.sha,
              agent_notes: `Copilot completed implementation — PR #${pr.number} is ready for review.`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', req.id);

          updated++;
        }
      }
    } catch (err) {
      console.warn(`[ChangeRequests] Failed to sync progress for "${req.title}":`, (err as Error).message);
    }
  }

  return updated;
}
