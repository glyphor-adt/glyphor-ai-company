import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiCall, formatGlyphorAuthDenialHint, isGlyphorApiError } from '../lib/firebase';
import EvalSummaryBar from '../components/eval/EvalSummaryBar';
import WorldStateFreshnessPanel from '../components/eval/WorldStateFreshnessPanel';
import EvalFleetGrid from '../components/eval/EvalFleetGrid';
import type { FleetAgent } from '../components/eval/EvalFleetGrid';
import CostLatencyPanel from '../components/eval/CostLatencyPanel';
import AgentDetailDrawer from '../components/eval/AgentDetailDrawer';
import GtmReadinessPanel from '../components/eval/GtmReadinessPanel';

export default function Fleet() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<FleetAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<FleetAgent | null>(null);
  const [evalAccessError, setEvalAccessError] = useState<string | null>(null);

  const filter = searchParams.get('filter');

  const fetchAgents = useCallback(async () => {
    try {
      const rows = await apiCall<FleetAgent[]>('/api/eval/fleet');
      setAgents(rows ?? []);
      setEvalAccessError(null);
    } catch (e) {
      setAgents([]);
      if (isGlyphorApiError(e) && (e.status === 403 || e.status === 401)) {
        const hint = formatGlyphorAuthDenialHint(e.authReason);
        setEvalAccessError(hint ?? e.message);
      } else {
        setEvalAccessError(null);
      }
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 60_000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  function handleFilterChange(newFilter: string | null) {
    if (newFilter) {
      setSearchParams({ filter: newFilter });
    } else {
      setSearchParams({});
    }
  }

  return (
    <div className="min-h-screen text-txt-primary">
      {/* Summary bar — always visible */}
      <div className="sticky top-0 z-30 p-4 pb-0 space-y-3">
        {evalAccessError && (
          <div
            role="alert"
            className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 shadow-sm"
          >
            <p className="font-semibold text-amber-50">Fleet / eval API access denied</p>
            <p className="mt-1 text-amber-100/90 leading-relaxed">{evalAccessError}</p>
          </div>
        )}
        <EvalSummaryBar agents={agents} activeFilter={filter} onFilterChange={handleFilterChange} />
      </div>

      {/* Main content */}
      <div className="p-6 space-y-6">
        {/* GTM Readiness — Marketing Department pass/fail gate */}
        <GtmReadinessPanel />

        {/* World state freshness */}
        <WorldStateFreshnessPanel />

        {/* Fleet grid */}
        <section>
          <h2 className="text-sm font-semibold text-txt-muted uppercase tracking-widest mb-4">
            Agent Fleet
          </h2>
          <EvalFleetGrid onAgentClick={setSelectedAgent} filter={filter} />
        </section>

        {/* Cost / latency — conditional */}
        <CostLatencyPanel />
      </div>

      {/* Agent detail drawer */}
      <AgentDetailDrawer
        agent={selectedAgent}
        open={!!selectedAgent}
        onClose={() => setSelectedAgent(null)}
      />
    </div>
  );
}
