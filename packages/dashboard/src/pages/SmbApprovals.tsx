import { useAuth } from '../lib/auth';
import { formatRelativeTime, respondToApproval, useSmbSummary } from '../lib/smb';
import { Card, GradientButton, SectionHeader } from '../components/ui';

export default function SmbApprovals() {
  const { user, refreshProfile } = useAuth();
  const { data, loading, refresh } = useSmbSummary();

  async function handleAction(id: string, action: 'approve' | 'redirect' | 'decline') {
    if (!user?.email) return;
    await respondToApproval(id, action, user.email);
    await Promise.all([refresh(), refreshProfile()]);
  }

  if (!loading && data.pending_approvals.length === 0) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Approvals" subtitle="There is nothing waiting for your decision right now." />
        <Card>
          <p className="text-sm text-txt-secondary">When the team needs your input, it will show up here.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Approvals" subtitle="Quick decisions that help work keep moving." />
      <div className="space-y-4">
        {data.pending_approvals.map((approval) => (
          <Card key={approval.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-txt-primary">{approval.title}</p>
                <p className="mt-2 text-sm leading-6 text-txt-secondary">{approval.summary}</p>
                <p className="mt-3 text-xs text-txt-faint">Requested {formatRelativeTime(approval.created_at)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <GradientButton variant="approve" onClick={() => handleAction(approval.id, 'approve')}>
                  Approve
                </GradientButton>
                <GradientButton variant="warning" onClick={() => handleAction(approval.id, 'redirect')}>
                  Redirect
                </GradientButton>
                <GradientButton variant="reject" onClick={() => handleAction(approval.id, 'decline')}>
                  Decline
                </GradientButton>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}