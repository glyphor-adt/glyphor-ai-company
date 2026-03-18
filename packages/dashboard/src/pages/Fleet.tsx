import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiCall } from '../lib/firebase';
import EvalSummaryBar from '../components/eval/EvalSummaryBar';
import WorldStateFreshnessPanel from '../components/eval/WorldStateFreshnessPanel';
import EvalFleetGrid from '../components/eval/EvalFleetGrid';
import type { FleetAgent } from '../components/eval/EvalFleetGrid';
import CostLatencyPanel from '../components/eval/CostLatencyPanel';
import AgentDetailDrawer from '../components/eval/AgentDetailDrawer';

export default function Fleet() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<FleetAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<FleetAgent | null>(null);

  const filter = searchParams.get('filter');

  const fetchAgents = useCallback(async () => {
    try {
      const rows = await apiCall<FleetAgent[]>('/api/eval/fleet');
      setAgents(rows ?? []);
    } catch {
      setAgents([]);
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
    <div className="min-h-screen text-white">
      {/* Summary bar — always visible */}
      <div className="sticky top-0 z-30 p-4 pb-0">
        <EvalSummaryBar agents={agents} activeFilter={filter} onFilterChange={handleFilterChange} />
      </div>

      {/* Main content */}
      <div className="p-6 space-y-6">
        {/* World state freshness */}
        <WorldStateFreshnessPanel />

        {/* Fleet grid */}
        <section>
          <h2 className="text-sm font-semibold text-white/40 uppercase tracking-widest mb-4">
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
