import { useState, useCallback, useEffect, useMemo, Fragment } from 'react';
import { MdCheck, MdClose, MdExpandMore, MdExpandLess } from 'react-icons/md';
import { useSearchParams } from 'react-router-dom';
import { useDecisions, useAgents } from '../lib/hooks';
import { DISPLAY_NAME_MAP, TIER_TO_IMPACT } from '../lib/types';
import { useAuth } from '../lib/auth';
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
  let title = raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  // Fix common acronyms that get title-cased wrong
  title = title.replace(/\bGcp\b/g, 'GCP').replace(/\bCto\b/g, 'CTO').replace(/\bCmo\b/g, 'CMO')
    .replace(/\bCfo\b/g, 'CFO').replace(/\bClo\b/g, 'CLO').replace(/\bApi\b/g, 'API')
    .replace(/\bCos\b/g, 'CoS').replace(/\bHr\b/g, 'HR').replace(/\bSeo\b/g, 'SEO')
    .replace(/\bUi\b/g, 'UI').replace(/\bUx\b/g, 'UX').replace(/\bM365\b/gi, 'M365');
  return title;
}

/** Known labels that start a line or section in summaries */
const KNOWN_LABELS = /^(Justification|Use case|Reason|Impact|Details|Context|Doctrine alignment|Owner|Priority|Success criteria|Dependencies|Planned directives|Cascade preview|To restore):\s*/i;

/** Metadata key-value pairs commonly found inline (Agent: X Department: Y ...) */
const METADATA_KEYS = /\b(Agent|Department|Model|TTL|Budget|Schedule|Expires|Scope|Tool|Target|Status):\s*/gi;

/** Parse summary text into structured sections for display */
function parseSections(text: string): { description: string; metadata: [string, string][]; details: string[] } {
  const lines = text.split(/\n+/).filter(Boolean);
  const description: string[] = [];
  const metadata: [string, string][] = [];
  const details: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if this line is a metadata-dense line (multiple Key: Value pairs)
    const metaMatches = [...trimmed.matchAll(METADATA_KEYS)];
    if (metaMatches.length >= 2) {
      // Parse out each key-value pair
      for (let j = 0; j < metaMatches.length; j++) {
        const key = metaMatches[j][1];
        const start = metaMatches[j].index! + metaMatches[j][0].length;
        const end = j + 1 < metaMatches.length ? metaMatches[j + 1].index! : trimmed.length;
        const value = trimmed.slice(start, end).replace(/\s+$/, '').replace(/,\s*$/, '');
        if (value) metadata.push([key, value]);
      }
      continue;
    }

    // Check if it's a labelled section (Justification: ..., Cascade preview: ...)
    if (KNOWN_LABELS.test(trimmed)) {
      details.push(trimmed);
      continue;
    }

    // Otherwise it's a description paragraph
    if (details.length === 0 && metadata.length === 0) {
      description.push(trimmed);
    } else {
      details.push(trimmed);
    }
  }

  return { description: description.join(' '), metadata, details };
}

/** Render a summary with structured sections and collapsible overflow */
function SummaryText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const { description, metadata, details } = useMemo(() => parseSections(text), [text]);
  const hasOverflow = details.length > 0 || metadata.length > 0;

  return (
    <div className="mt-1.5 text-[12px] text-txt-muted leading-relaxed">
      {/* Primary description — always visible */}
      {description && (
        <p className={!expanded && !hasOverflow ? undefined : undefined}>
          {description}
        </p>
      )}

      {/* Metadata grid — always visible when present */}
      {metadata.length > 0 && (
        <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-raised/50 px-2.5 py-2 text-[11px]">
          {metadata.map(([key, value], i) => (
            <Fragment key={i}>
              <span className="font-medium text-txt-faint whitespace-nowrap">{key}</span>
              <span className="text-txt-muted">{value}</span>
            </Fragment>
          ))}
        </div>
      )}

      {/* Labelled detail sections — collapsible */}
      {details.length > 0 && (
        <div className={!expanded ? 'mt-1.5 line-clamp-2' : 'mt-1.5'}>
          {details.map((d, i) => {
            const labelMatch = d.match(KNOWN_LABELS);
            // Cascade preview gets a distinct visual treatment
            const isCascade = /^cascade preview/i.test(d);
            return (
              <p
                key={i}
                className={`${i > 0 ? 'mt-1.5' : ''} ${isCascade ? 'rounded-md bg-raised/50 px-2.5 py-2 text-[11px] text-txt-faint italic' : ''}`}
              >
                {labelMatch ? (
                  <>
                    <span className="font-semibold text-txt-secondary">{labelMatch[1]}:</span>{' '}
                    {d.slice(labelMatch[0].length)}
                  </>
                ) : (
                  d
                )}
              </p>
            );
          })}
        </div>
      )}

      {hasOverflow && (
        <button
          onClick={toggle}
          className="mt-1.5 flex items-center gap-0.5 text-[11px] text-cyan hover:text-cyan/80 transition-colors"
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
  const { user } = useAuth();
  const { data: decisions, loading, updateDecision } = useDecisions();
  const { data: agents } = useAgents();
  const [filter, setFilter] = useState<Filter>('pending');
  const [searchParams, setSearchParams] = useSearchParams();

  const resolvedBy = useMemo(() => {
    const email = user?.email?.toLowerCase() ?? '';
    if (email.includes('andrew')) return 'andrew';
    if (email.includes('kristina') || email.includes('devops')) return 'kristina';
    return 'founder';
  }, [user?.email]);

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
    updateDecision(id, status, resolvedBy);
  };

  useEffect(() => {
    const decisionId = searchParams.get('decision');
    const action = searchParams.get('decisionAction');
    if (!decisionId || !action || loading) return;

    const target = decisions.find((decision) => decision.id === decisionId && decision.status === 'pending');
    if (!target) {
      searchParams.delete('decisionAction');
      setSearchParams(searchParams, { replace: true });
      return;
    }

    if (action === 'approve' || action === 'reject') {
      const nextStatus = action === 'approve' ? 'approved' : 'rejected';
      updateDecision(decisionId, nextStatus, resolvedBy)
        .finally(() => {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete('decisionAction');
          setSearchParams(nextParams, { replace: true });
        });
    }
  }, [decisions, loading, resolvedBy, searchParams, setSearchParams, updateDecision]);

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
            >
              <div className="flex items-start gap-4" style={{ animationDelay: `${i * 50}ms` }}>
                <AgentAvatar role={d.proposed_by} size={36} />

                <div className="min-w-0 flex-1">
                  {/* Header row: title + badge */}
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className="text-[14px] font-semibold text-txt-primary leading-snug">{formatTitle(d.title)}</h3>
                    <ImpactBadge impact={TIER_TO_IMPACT[d.tier] ?? d.tier} />
                  </div>

                  {/* Subtitle: who proposed + when */}
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-txt-faint">
                    <span>From <span className="text-txt-muted font-medium">{agentName(d.proposed_by)}</span></span>
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

                  {/* Summary content */}
                  <SummaryText text={parseSummary(d.summary)} />
                </div>

                {d.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDecide(d.id, 'approved')}
                      className="relative inline-flex items-center justify-center p-0.5 overflow-hidden text-[12px] font-medium text-txt-primary rounded-lg group bg-gradient-to-br from-green-400 to-blue-600 group-hover:from-green-400 group-hover:to-blue-600 hover:text-white dark:text-white focus:ring-4 focus:outline-none focus:ring-green-200 dark:focus:ring-green-800"
                    >
                      <span className="relative px-3 py-1.5 transition-all ease-in duration-75 bg-surface rounded-md group-hover:bg-transparent group-hover:dark:bg-transparent leading-5">
                        Approve
                      </span>
                    </button>
                    <button
                      onClick={() => handleDecide(d.id, 'rejected')}
                      className="relative inline-flex items-center justify-center p-0.5 overflow-hidden text-[12px] font-medium text-txt-primary rounded-lg group bg-gradient-to-br from-red-500 to-rose-600 group-hover:from-red-500 group-hover:to-rose-600 hover:text-white dark:text-white focus:ring-4 focus:outline-none focus:ring-red-200 dark:focus:ring-red-800"
                    >
                      <span className="relative px-3 py-1.5 transition-all ease-in duration-75 bg-surface rounded-md group-hover:bg-transparent group-hover:dark:bg-transparent leading-5">
                        Reject
                      </span>
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
