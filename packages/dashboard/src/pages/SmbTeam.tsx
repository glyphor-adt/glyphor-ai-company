import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { useSmbSettings, useSmbSummary, submitSmbDirective, formatRelativeTime } from '../lib/smb';
import { AgentAvatar, Badge, Card, GradientButton, SectionHeader } from '../components/ui';

export default function SmbTeam() {
  const { user } = useAuth();
  const { data, loading, refresh } = useSmbSummary();
  const { data: settings, update, saving } = useSmbSettings();
  const [directive, setDirective] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmitDirective() {
    if (!directive.trim() || !user?.email) return;
    setSubmitting(true);
    try {
      await submitSmbDirective(directive, user.email);
      setDirective('');
      await refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function activateDepartment(department: string) {
    const current = settings?.team.active_departments ?? [];
    await update({ team: { active_departments: [...new Set([...current, department])] } });
    await refresh();
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title={`Hi ${data.greeting_name}`}
        subtitle="Here is what your team is working on right now."
      />

      <div className="grid gap-4 md:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <p className="text-xs uppercase tracking-[0.18em] text-txt-faint">This week</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div>
              <p className="text-4xl font-semibold text-txt-primary">{loading ? '...' : data.tasks_completed_this_week}</p>
              <p className="mt-1 text-sm text-txt-secondary">tasks completed this week</p>
            </div>
            <Badge color="cyan" size="lg">Live</Badge>
          </div>
        </Card>

        <Card>
          <p className="text-xs uppercase tracking-[0.18em] text-txt-faint">Need something new?</p>
          <p className="mt-2 text-sm text-txt-secondary">Share a directive in plain English and your team will pick it up.</p>
          <textarea
            value={directive}
            onChange={(event) => setDirective(event.target.value)}
            rows={4}
            placeholder="Example: Follow up on this week's open leads and prepare a short summary I can send out today."
            className="mt-4 w-full rounded-xl border border-border bg-base px-3 py-3 text-sm text-txt-primary placeholder:text-txt-faint focus:border-border-hover focus:outline-none"
          />
          <div className="mt-3 flex justify-end">
            <GradientButton onClick={handleSubmitDirective} disabled={submitting || !directive.trim()} size="md">
              {submitting ? 'Sending...' : 'Send directive'}
            </GradientButton>
          </div>
        </Card>
      </div>

      <Card>
        <SectionHeader title="Your team" subtitle="The people currently helping on active work." />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.active_agents.map((agent) => (
            <div key={agent.role} className="rounded-2xl border border-border bg-base/60 p-4">
              <div className="flex items-start gap-3">
                <AgentAvatar role={agent.role} avatarUrl={agent.avatar_url} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-txt-primary">{agent.display_name}</p>
                  <p className="text-xs text-txt-muted">{agent.title || agent.department || 'Team member'}</p>
                </div>
                <Badge color="green">{agent.status}</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-txt-secondary">{agent.summary}</p>
              <p className="mt-3 text-xs text-txt-faint">Last active {formatRelativeTime(agent.last_run_at)}</p>
            </div>
          ))}
          {!loading && data.active_agents.length === 0 && (
            <p className="text-sm text-txt-muted">No active team members are showing yet.</p>
          )}
        </div>
      </Card>

      {data.dormant_departments.length > 0 && (
        <Card>
          <SectionHeader title="Ready to activate" subtitle="Bring more departments into the simple view when you need them." />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.dormant_departments.map((department) => (
              <div key={department.department} className="rounded-2xl border border-dashed border-border p-4">
                <p className="text-sm font-semibold text-txt-primary">{department.department}</p>
                <p className="mt-1 text-sm text-txt-secondary">{department.count} team members ready to help.</p>
                <p className="mt-2 text-xs text-txt-faint">{department.sample_roles.join(', ')}</p>
                <button
                  onClick={() => activateDepartment(department.department)}
                  disabled={saving}
                  className="mt-4 rounded-lg border border-border px-3 py-2 text-sm font-medium text-txt-primary transition-colors hover:border-border-hover hover:bg-base"
                >
                  Activate department
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <Card>
          <SectionHeader title="Recent activity" subtitle="A plain-English view of the latest work from your team." />
          <div className="space-y-3">
            {data.recent_activity.map((item, index) => (
              <div key={`${item.agent_role}-${index}`} className="rounded-xl border border-border bg-base/50 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm text-txt-primary">{item.summary}</p>
                  <span className="whitespace-nowrap text-xs text-txt-faint">{formatRelativeTime(item.created_at)}</span>
                </div>
              </div>
            ))}
            {!loading && data.recent_activity.length === 0 && <p className="text-sm text-txt-muted">No recent activity yet.</p>}
          </div>
        </Card>

        {data.pending_approvals.length > 0 && (
          <Card>
            <SectionHeader title="Needs your input" subtitle="A few items are waiting for a quick decision." />
            <div className="space-y-3">
              {data.pending_approvals.slice(0, 3).map((approval) => (
                <div key={approval.id} className="rounded-xl border border-border bg-base/50 px-4 py-3">
                  <p className="text-sm font-semibold text-txt-primary">{approval.title}</p>
                  <p className="mt-1 text-sm text-txt-secondary">{approval.summary}</p>
                  <p className="mt-2 text-xs text-txt-faint">{formatRelativeTime(approval.created_at)}</p>
                </div>
              ))}
              <a href="/app/smb/approvals" className="inline-block text-sm font-medium text-cyan hover:underline">
                Review approvals
              </a>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}