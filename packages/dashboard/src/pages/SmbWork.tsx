import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { formatRelativeTime, submitSmbDirective, useSmbSummary } from '../lib/smb';
import { Badge, ButtonOutlineSecondary, Card, GradientButton, SectionHeader } from '../components/ui';

export default function SmbWork() {
  const { user } = useAuth();
  const { data, loading, refresh } = useSmbSummary();
  const [directive, setDirective] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
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

  return (
    <div className="space-y-6">
      <SectionHeader title="Work" subtitle="Every directive in one place, ordered by the newest activity first." />

      <Card>
        <p className="text-sm font-semibold text-txt-primary">New directive</p>
        <p className="mt-1 text-sm text-txt-secondary">Describe what you want done and your team will take it from there.</p>
        <textarea
          value={directive}
          onChange={(event) => setDirective(event.target.value)}
          rows={4}
          placeholder="Example: Draft a short update for customers about the new onboarding flow and share it back for review."
          className="mt-4 w-full rounded-xl border border-border bg-base px-3 py-3 text-sm text-txt-primary placeholder:text-txt-faint focus:border-border-hover focus:outline-none"
        />
        <div className="mt-3 flex justify-end">
          <GradientButton onClick={handleSubmit} disabled={submitting || !directive.trim()} size="md">
            {submitting ? 'Sending...' : 'Create directive'}
          </GradientButton>
        </div>
      </Card>

      <div className="space-y-4">
        {data.directives.map((directiveItem) => {
          const isExpanded = expandedId === directiveItem.id;
          return (
            <Card key={directiveItem.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold text-txt-primary">{directiveItem.title}</p>
                    <Badge color={directiveItem.needs_input ? 'amber' : directiveItem.status === 'completed' ? 'green' : 'cyan'}>
                      {directiveItem.needs_input ? 'Needs input' : directiveItem.status === 'completed' ? 'Done' : 'In progress'}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-txt-secondary">{directiveItem.description}</p>
                  <p className="mt-3 text-xs text-txt-faint">{directiveItem.progress_label} · Updated {formatRelativeTime(directiveItem.updated_at)}</p>
                </div>
                <ButtonOutlineSecondary onClick={() => setExpandedId(isExpanded ? null : directiveItem.id)}>
                  {isExpanded ? 'Hide full output' : 'Show full output'}
                </ButtonOutlineSecondary>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
                <div className="rounded-2xl border border-border bg-base/50 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-txt-faint">Preview</p>
                  <p className="mt-2 text-sm leading-6 text-txt-secondary">{directiveItem.output_preview}</p>
                  {directiveItem.needs_input && (
                    <div className="mt-4 rounded-xl border border-amber/40 bg-amber/10 px-3 py-3 text-sm text-txt-primary">
                      <p className="font-medium">Needs input</p>
                      <p className="mt-1 text-sm text-txt-secondary">{directiveItem.needs_input}</p>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-border bg-base/50 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-txt-faint">Full output</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-txt-secondary">
                    {isExpanded ? directiveItem.output_full || 'Full output will appear here as work comes in.' : 'Open full output to read the complete response.'}
                  </p>
                </div>
              </div>

              {directiveItem.assignments.length > 0 && (
                <div className="mt-4 space-y-3">
                  {directiveItem.assignments.map((assignment) => (
                    <div key={assignment.id} className="rounded-xl border border-border bg-base/40 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-txt-primary">{assignment.task_description}</p>
                        <span className="text-xs text-txt-faint">{formatRelativeTime(assignment.completed_at || assignment.created_at)}</span>
                      </div>
                      <p className="mt-2 text-sm text-txt-secondary">{assignment.preview}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
        {!loading && data.directives.length === 0 && <p className="text-sm text-txt-muted">No directives yet.</p>}
      </div>
    </div>
  );
}