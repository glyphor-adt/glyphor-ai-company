import { useState } from 'react';
import { useDecisions, useAgents } from '../lib/hooks';
import { CODENAME_MAP } from '../lib/types';
import {
  Card,
  SectionHeader,
  AgentAvatar,
  ImpactBadge,
  Skeleton,
  timeAgo,
} from '../components/ui';

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

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
    return agent ? (CODENAME_MAP[agent.role] ?? agent.codename) : agentId;
  };

  const handleDecide = (id: string, status: 'approved' | 'rejected') => {
    updateDecision(id, status, 'kristina');
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl text-slate-50">Approvals</h1>
        <p className="mt-1 text-sm text-slate-500">
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
                ? 'bg-violet/15 text-violet'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            <span className="ml-1.5 text-[10px] text-slate-600">{counts[f]}</span>
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
          <p className="py-12 text-center text-sm text-slate-600">
            {filter === 'pending' ? 'No decisions pending — inbox zero 🎉' : 'No decisions match this filter'}
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
                <AgentAvatar role={d.agent_id} size={36} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-[14px] font-semibold text-slate-100">{d.title}</h3>
                    <ImpactBadge impact={d.impact} />
                  </div>

                  <p className="mt-1 text-[12px] text-slate-500 leading-relaxed">
                    {d.description}
                  </p>

                  <div className="mt-2.5 flex items-center gap-3 text-[11px] text-slate-600">
                    <span>From: <span className="text-slate-400">{agentName(d.agent_id)}</span></span>
                    <span>·</span>
                    <span>{timeAgo(d.created_at)}</span>
                    {d.decided_by && (
                      <>
                        <span>·</span>
                        <span>
                          {d.status === 'approved' ? '✓' : '✗'} by{' '}
                          <span className="text-slate-400">{d.decided_by}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {d.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDecide(d.id, 'approved')}
                      className="rounded-lg bg-tier-green/10 px-3 py-1.5 text-[12px] font-medium text-tier-green border border-tier-green/20 hover:bg-tier-green/20 transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleDecide(d.id, 'rejected')}
                      className="rounded-lg bg-tier-red/10 px-3 py-1.5 text-[12px] font-medium text-tier-red border border-tier-red/20 hover:bg-tier-red/20 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                )}

                {d.status !== 'pending' && (
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                      d.status === 'approved'
                        ? 'bg-tier-green/10 text-tier-green'
                        : 'bg-tier-red/10 text-tier-red'
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
