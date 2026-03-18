import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../../lib/firebase';

/* ── Types ─────────────────────────────────────────────────── */

interface PromptVersion {
  version: number;
  deployed_at: string;
  source: string;
  change_summary: string | null;
  performance_score_at_deploy: number | null;
}

interface ShadowGroup {
  challenger_prompt_version: number;
  baseline_prompt_version: number;
  run_count: number;
  avg_challenger: number | null;
  avg_baseline: number | null;
  delta: number | null;
  first_run: string;
  last_run: string;
}

interface PromptEvolutionTabProps {
  agentId: string;
}

/* ── Component ─────────────────────────────────────────────── */

export default function PromptEvolutionTab({ agentId }: PromptEvolutionTabProps) {
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [shadows, setShadows] = useState<ShadowGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [trendData, shadowData] = await Promise.all([
        apiCall<{ promptVersions: PromptVersion[] }>(
          `/api/eval/agent/${encodeURIComponent(agentId)}/trend?days=365`,
        ),
        apiCall<ShadowGroup[]>(`/api/eval/agent/${encodeURIComponent(agentId)}/shadow`),
      ]);
      setVersions(trendData.promptVersions ?? []);
      setShadows(shadowData ?? []);
    } catch {
      setVersions([]);
      setShadows([]);
    }
    setLoading(false);
  }, [agentId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function discardShadow(shadowId: string) {
    try {
      await apiCall(`/api/eval/shadow/${shadowId}/discard`, { method: 'PATCH' });
      refresh();
    } catch { /* ignore */ }
  }

  if (loading) {
    return <div className="h-[200px] animate-pulse rounded-lg bg-white/5" />;
  }

  function sourceBadge(source: string) {
    const colors: Record<string, string> = {
      manual: 'bg-white/10 text-white/60',
      reflection: 'bg-[#00E0FF]/15 text-[#00E0FF]',
      shadow_promoted: 'bg-[#6E77DF]/15 text-[#6E77DF]',
    };
    return (
      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${colors[source] ?? colors.manual}`}>
        {source.replace('_', ' ')}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active shadow tests */}
      {shadows.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-3">
            Shadow Evaluations
          </h4>
          {shadows.map(s => (
            <div key={`${s.challenger_prompt_version}-${s.baseline_prompt_version}`}
                 className="rounded-lg border border-white/5 bg-white/5 p-3 mb-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-white/80">
                    v{s.challenger_prompt_version} <span className="text-white/30">vs</span> v{s.baseline_prompt_version}
                  </span>
                  <span className="ml-2 text-xs text-white/40">{s.run_count} runs</span>
                </div>
                {s.delta !== null && (
                  <span className={`text-sm font-semibold ${s.delta >= 0 ? 'text-[#00E0FF]' : 'text-red-400'}`}>
                    {s.delta >= 0 ? '+' : ''}{(s.delta * 100).toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-white/30">
                  {new Date(s.first_run).toLocaleDateString()} – {new Date(s.last_run).toLocaleDateString()}
                </span>
                <button
                  onClick={() => discardShadow(`${s.challenger_prompt_version}`)}
                  className="text-[10px] text-red-400/70 hover:text-red-400 transition-colors"
                >
                  Discard challenger
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Version timeline */}
      <div>
        <h4 className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-3">
          Prompt Version History
        </h4>
        {versions.length === 0 ? (
          <p className="text-xs text-white/30">No prompt versions recorded.</p>
        ) : (
          <div className="relative border-l border-white/10 ml-3 space-y-4">
            {versions.map((v, i) => (
              <div key={v.version} className="relative pl-6">
                {/* Timeline dot */}
                <div className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-[#131620]"
                     style={{ backgroundColor: v.source === 'reflection' ? '#00E0FF' : v.source === 'shadow_promoted' ? '#6E77DF' : '#475569' }} />

                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white/80">v{v.version}</span>
                      {sourceBadge(v.source)}
                    </div>
                    {v.change_summary && (
                      <p className="text-xs text-white/50 mt-1 leading-relaxed">{v.change_summary}</p>
                    )}
                    <p className="text-[10px] text-white/30 mt-1">
                      {v.deployed_at ? new Date(v.deployed_at).toLocaleDateString('en', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      }) : 'not deployed'}
                    </p>
                  </div>
                  {v.performance_score_at_deploy !== null && (
                    <span className="text-xs text-white/40 ml-2 shrink-0">
                      score: {(v.performance_score_at_deploy * 100).toFixed(0)}%
                    </span>
                  )}
                </div>

                {/* Diff hint — show what changed from previous version */}
                {i > 0 && v.change_summary && versions[i - 1]?.change_summary && (
                  <div className="mt-1 rounded bg-white/5 px-2 py-1 text-[10px] text-white/30">
                    Δ from v{versions[i - 1].version}: {v.change_summary}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
