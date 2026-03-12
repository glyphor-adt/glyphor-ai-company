import { useState, useCallback } from 'react';
import { MdCheck, MdClose, MdExpandMore, MdExpandLess } from 'react-icons/md';
import { useDecisions, useAgents } from '../lib/hooks';
import { DISPLAY_NAME_MAP, TIER_TO_IMPACT } from '../lib/types';
import {
  Card,
  SectionHeader,
  AgentAvatar,
  ImpactBadge,
  Skeleton,
  timeAgo,
} from '../components/ui';

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

/** Parse a summary that may be raw JSON from the old EventRouter format */
function parseSummary(raw: string): string {
  if (!raw.startsWith('{')) return raw;
  try {
    const obj = JSON.parse(raw);
    let msg = (obj.message ?? obj.summary ?? raw) as string;
    // Strip "Founder: " prefix and boilerplate sign-off
    msg = msg.replace(/^Founder:\s*/i, '').replace(/\n\n?Respond directly to the founder\..*$/s, '').trim();
    return msg;
  } catch {
    return raw;
  }
}

/** Format slug-style titles like "cmo: content_creation" into readable text */
function formatTitle(raw: string): string {
  // If it already looks nice (no underscores, not all-lowercase slugs), return as-is
  if (!raw.includes('_') && !raw.match(/^[a-z-]+:\s/)) return raw;
  return raw
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Render a summary with labelled sections and collapsible overflow */
function SummaryText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  // Split into paragraphs on double-newlines; bold known labels
  const paragraphs = text.split(/\n\n+/).filter(Boolean);
  const isLong = paragraphs.length > 1 || text.length > 200;

  return (
    <div className="mt-1 text-[12px] text-txt-muted leading-relaxed">
      <div className={!expanded && isLong ? 'line-clamp-2' : undefined}>
        {paragraphs.map((p, i) => {
          const labelMatch = p.match(/^(Justification|Use case|Reason|Impact|Details|Context):\s*/i);
          return (
            <p key={i} className={i > 0 ? 'mt-1.5' : undefined}>
              {labelMatch ? (
                <>
                  <span className="font-semibold text-txt-secondary">{labelMatch[1]}:</span>{' '}
                  {p.slice(labelMatch[0].length)}
                </>
              ) : (
                p
              )}
            </p>
          );
        })}
      </div>
      {isLong && (
        <button
          onClick={toggle}
          className="mt-1 flex items-center gap-0.5 text-[11px] text-cyan hover:text-cyan/80 transition-colors"
        >
          {expanded ? (
            <>Show less <MdExpandLess className="h-3.5 w-3.5" /></>
          ) : (
            <>Show more <MdExpandMore className="h-3.5 w-3.5" /></>
          )}
        </button>
      )}
    </div>
  );
}

export default function Approvals() {
  const { data: decisions, loading, updateDecision } = useDecisions();
  const { data: agents } = useAgents();
  const [filter, setFilter] = useState<Filter>('pending');

  const filtered =
    filter === 'all' ? decisions : decisions.filter((d) => d.status === filter);

  const counts = {
    all: decisions.length,
    pending: decisions.filter((d) => d.status === 'pending').length,
    approved: decisions.filter((d) => d.status === 'approved').length,
    rejected: decisions.filter((d) => d.status === 'rejected').length,
  };

  const agentName = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId || a.role === agentId);
    return agent ? (DISPLAY_NAME_MAP[agent.role] ?? agent.role) : agentId;
  };

  const handleDecide = (id: string, status: 'approved' | 'rejected') => {
    updateDecision(id, status, 'kristina');
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-txt-primary">Approvals</h1>
        <p className="mt-1 text-sm text-txt-muted">
          {counts.pending} pending · {counts.approved} approved · {counts.rejected} rejected
        </p>
      </div>

      {/* ── Filter Tabs ──────────────────── */}
      <div className="flex gap-1 rounded-lg bg-raised p-1 w-fit">
        {(['pending', 'approved', 'rejected', 'all'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-colors ${
              filter === f
                ? 'bg-cyan/15 text-cyan'
                : 'text-txt-muted hover:text-txt-secondary'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            <span className="ml-1.5 text-[10px] text-txt-faint">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* ── Decision List ────────────────── */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <p className="py-12 text-center text-sm text-txt-faint">
            {filter === 'pending' ? 'No decisions pending — inbox zero' : 'No decisions match this filter'}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((d, i) => (
            <Card
              key={d.id}
              className="animate-fade-up"
              // stagger animation
            >
              <div className="flex items-start gap-4" style={{ animationDelay: `${i * 50}ms` }}>
                <AgentAvatar role={d.proposed_by} size={36} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-[14px] font-semibold text-txt-primary">{formatTitle(d.title)}</h3>
                    <ImpactBadge impact={TIER_TO_IMPACT[d.tier] ?? d.tier} />
                  </div>

                  <SummaryText text={parseSummary(d.summary)} />

                  <div className="mt-2.5 flex items-center gap-3 text-[11px] text-txt-faint">
                    <span>From: <span className="text-txt-muted">{agentName(d.proposed_by)}</span></span>
                    <span>·</span>
                    <span>{timeAgo(d.created_at)}</span>
                    {d.resolved_by && (
                      <>
                        <span>·</span>
                        <span>
                          {d.status === 'approved' ? <MdCheck className="inline h-3.5 w-3.5" /> : <MdClose className="inline h-3.5 w-3.5" />} by{' '}
                          <span className="text-txt-muted">{d.resolved_by}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {d.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDecide(d.id, 'approved')}
                      className="rounded-lg bg-cyan/10 px-3 py-1.5 text-[12px] font-medium text-cyan border border-cyan/20 hover:bg-cyan/20 transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleDecide(d.id, 'rejected')}
                      className="rounded-lg bg-accent/10 px-3 py-1.5 text-[12px] font-medium text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                )}

                {d.status !== 'pending' && (
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                      d.status === 'approved'
                        ? 'bg-cyan/10 text-cyan'
                        : 'bg-accent/10 text-accent'
                    }`}
                  >
                    {d.status}
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
