import { useState } from 'react';
import type { FleetAgent } from './EvalFleetGrid';
import { ScoreRadial, scoreColor } from './EvalFleetGrid';
import PerformanceTab from './PerformanceTab';
import PromptEvolutionTab from './PromptEvolutionTab';
import FindingsTab from './FindingsTab';
import WorldStateTab from './WorldStateTab';
import HandoffsTab from './HandoffsTab';

/* ── Types ─────────────────────────────────────────────────── */

interface AgentDetailDrawerProps {
  agent: FleetAgent | null;
  open: boolean;
  onClose: () => void;
}

const TABS = ['Performance', 'Prompt Evolution', 'Findings', 'World State', 'Handoffs'] as const;

/* ── Component ─────────────────────────────────────────────── */

export default function AgentDetailDrawer({ agent, open, onClose }: AgentDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState(0);

  // Reset tab when agent changes
  const prevAgentId = agent?.id;
  const [lastId, setLastId] = useState<string | null>(null);
  if (prevAgentId && prevAgentId !== lastId) {
    setLastId(prevAgentId);
    setActiveTab(0);
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="theme-overlay-backdrop-strong fixed inset-0 z-40"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed right-0 top-0 h-full w-[480px] max-w-full bg-surface border-l border-border
                     shadow-2xl transform transition-transform duration-300 z-50
                     ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {agent && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-txt-primary truncate">{agent.name}</h2>
                <p className="text-xs text-txt-muted">
                  {agent.department ?? 'Unassigned'} · v{agent.prompt_version ?? '?'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <ScoreRadial score={agent.performance_score} color={scoreColor(agent.performance_score)} />
                <button
                  onClick={onClose}
                  className="text-txt-faint hover:text-txt-secondary transition-colors"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-border px-6">
              {TABS.map((tab, i) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(i)}
                  className={`px-3 py-2.5 text-xs font-medium transition-colors relative
                    ${activeTab === i
                      ? 'text-[#00E0FF]'
                      : 'text-txt-muted hover:text-txt-secondary'
                    }`}
                >
                  {tab}
                  {activeTab === i && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#00E0FF] rounded-full" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="overflow-y-auto h-[calc(100vh-140px)] p-6">
              {activeTab === 0 && <PerformanceTab agentId={agent.role} />}
              {activeTab === 1 && <PromptEvolutionTab agentId={agent.role} />}
              {activeTab === 2 && <FindingsTab agentId={agent.role} />}
              {activeTab === 3 && <WorldStateTab agentId={agent.role} />}
              {activeTab === 4 && <HandoffsTab agentId={agent.role} />}
            </div>
          </>
        )}
      </div>
    </>
  );
}
