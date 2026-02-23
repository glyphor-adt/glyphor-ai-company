import { useEffect, useState, useCallback } from 'react';
import { SCHEDULER_URL } from '../lib/supabase';
import { Card, SectionHeader, Skeleton, timeAgo } from '../components/ui';

/* ── Types ─────────────────────────────────────── */

type AnalysisType = 'market_opportunity' | 'competitive_landscape' | 'product_strategy' | 'growth_diagnostic' | 'risk_assessment';
type AnalysisDepth = 'quick' | 'standard' | 'deep';
type AnalysisStatus = 'planning' | 'executing' | 'synthesizing' | 'completed' | 'failed';

interface AnalysisReport {
  summary: string;
  swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  recommendations: { title: string; priority: string; detail: string }[];
  threads: { id: string; label: string; perspective: string; status: string; result?: string }[];
}

interface AnalysisRecord {
  id: string;
  type: AnalysisType;
  query: string;
  depth: AnalysisDepth;
  status: AnalysisStatus;
  requested_by: string;
  threads: { id: string; label: string; perspective: string; status: string; result?: string }[];
  report: AnalysisReport | null;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

type SimulationStatus = 'planning' | 'executing' | 'cascading' | 'synthesizing' | 'completed' | 'failed' | 'accepted' | 'rejected';

interface ImpactDimension {
  area: string;
  perspective: string;
  impact: 'positive' | 'negative' | 'neutral';
  magnitude: number;
  confidence: number;
  reasoning: string;
  secondOrderEffects: string[];
}

interface SimulationReport {
  summary: string;
  overallScore: number;
  dimensions: ImpactDimension[];
  cascadeChain: { from: string; to: string; effect: string; delay: string }[];
  votes: { agent: string; vote: 'approve' | 'caution' | 'reject'; reasoning: string }[];
  recommendation: 'proceed' | 'proceed_with_caution' | 'reconsider';
}

interface SimulationRecord {
  id: string;
  action: string;
  perspective: string;
  status: SimulationStatus;
  requested_by: string;
  dimensions: ImpactDimension[];
  report: SimulationReport | null;
  created_at: string;
  completed_at: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  error: string | null;
}

/* ── Helpers ───────────────────────────────────── */

const ANALYSIS_TYPE_LABELS: Record<AnalysisType, string> = {
  market_opportunity: 'Market Opportunity',
  competitive_landscape: 'Competitive Landscape',
  product_strategy: 'Product Strategy',
  growth_diagnostic: 'Growth Diagnostic',
  risk_assessment: 'Risk Assessment',
};

const DEPTH_LABELS: Record<AnalysisDepth, string> = {
  quick: 'Quick (4 turns)',
  standard: 'Standard (8 turns)',
  deep: 'Deep (12 turns)',
};

const PERSPECTIVE_LABELS: Record<string, string> = {
  optimistic: 'Optimistic',
  neutral: 'Neutral',
  pessimistic: 'Pessimistic',
};

function statusColor(status: string) {
  if (status === 'completed' || status === 'accepted') return 'bg-tier-green';
  if (status === 'failed' || status === 'rejected') return 'bg-red-400';
  return 'bg-amber-400 animate-pulse';
}

function recommendationBadge(rec: string) {
  if (rec === 'proceed') return { text: 'Proceed', cls: 'border-tier-green/30 bg-tier-green/15 text-tier-green' };
  if (rec === 'proceed_with_caution') return { text: 'Proceed with Caution', cls: 'border-amber-500/30 bg-amber-500/15 text-amber-400' };
  return { text: 'Reconsider', cls: 'border-red-500/30 bg-red-500/15 text-red-400' };
}

function voteIcon(vote: string) {
  if (vote === 'approve') return '✓';
  if (vote === 'caution') return '⚠';
  return '✗';
}

function voteColor(vote: string) {
  if (vote === 'approve') return 'text-tier-green';
  if (vote === 'caution') return 'text-amber-400';
  return 'text-red-400';
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${SCHEDULER_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/* ── Page Component ────────────────────────────── */

type Tab = 'analyses' | 'simulations' | 'cot';

export default function Strategy() {
  const [tab, setTab] = useState<Tab>('analyses');

  const TAB_LABELS: Record<Tab, string> = {
    analyses: 'Strategic Analyses',
    simulations: 'T+1 Simulations',
    cot: 'Chain of Thought',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-txt-primary">Strategy Lab</h1>
        <p className="mt-1 text-sm text-txt-muted">
          McKinsey-grade strategic analyses, T+1 impact simulations, and chain-of-thought planning
        </p>
      </div>

      {/* Tab Toggle */}
      <div className="flex gap-1 rounded-lg bg-raised p-1 w-fit border border-border">
        {(['analyses', 'simulations', 'cot'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-[13px] font-medium transition-colors ${
              tab === t
                ? 'bg-cyan/15 text-cyan'
                : 'text-txt-muted hover:text-txt-secondary'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'analyses' && <AnalysesPanel />}
      {tab === 'simulations' && <SimulationsPanel />}
      {tab === 'cot' && <ChainOfThoughtPanel />}
    </div>
  );
}

/* ─── Analyses Panel ───────────────────────────── */

function AnalysesPanel() {
  const [analyses, setAnalyses] = useState<AnalysisRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  // Form
  const [analysisType, setAnalysisType] = useState<AnalysisType>('market_opportunity');
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<AnalysisDepth>('standard');

  const refresh = useCallback(async () => {
    try {
      const records = await api<AnalysisRecord[]>('/analysis');
      setAnalyses(records);
    } catch { setAnalyses([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll running analyses
  useEffect(() => {
    const running = analyses.some((a) => !['completed', 'failed'].includes(a.status));
    if (!running) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [analyses, refresh]);

  async function launch() {
    if (!query.trim()) return;
    setLaunching(true);
    try {
      await api('/analysis/run', {
        method: 'POST',
        body: JSON.stringify({ type: analysisType, query: query.trim(), depth, requestedBy: 'dashboard' }),
      });
      setQuery('');
      await refresh();
    } catch (err) {
      console.error('Failed to launch analysis:', err);
    }
    setLaunching(false);
  }

  return (
    <div className="space-y-6">
      {/* Launch Form */}
      <Card>
        <SectionHeader title="Launch New Analysis" />
        <div className="mt-3 grid grid-cols-[1fr_auto_auto_auto] gap-3 items-end">
          <div>
            <label className="text-[11px] font-medium text-txt-muted mb-1 block">Query</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. 'What's the TAM for AI-native project management tools?'"
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary placeholder:text-txt-faint focus:border-cyan focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && launch()}
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-txt-muted mb-1 block">Type</label>
            <select
              value={analysisType}
              onChange={(e) => setAnalysisType(e.target.value as AnalysisType)}
              className="rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none"
            >
              {Object.entries(ANALYSIS_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-txt-muted mb-1 block">Depth</label>
            <select
              value={depth}
              onChange={(e) => setDepth(e.target.value as AnalysisDepth)}
              className="rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none"
            >
              {Object.entries(DEPTH_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <button
            onClick={launch}
            disabled={launching || !query.trim()}
            className="rounded-lg bg-cyan px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {launching ? 'Launching…' : 'Run Analysis'}
          </button>
        </div>
      </Card>

      {/* Analysis List */}
      <div>
        <SectionHeader title="Past Analyses" />
        {loading ? (
          <div className="space-y-3 mt-3"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        ) : analyses.length === 0 ? (
          <p className="mt-4 text-center text-sm text-txt-faint">No analyses yet — launch one above</p>
        ) : (
          <div className="mt-3 space-y-3">
            {analyses.map((a) => (
              <Card key={a.id}>
                <button
                  onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className={`inline-block h-2 w-2 rounded-full ${statusColor(a.status)}`} />
                    <div>
                      <p className="text-sm font-medium text-txt-primary">{a.query}</p>
                      <p className="text-[11px] text-txt-muted">
                        {ANALYSIS_TYPE_LABELS[a.type]} · {a.depth} · {a.status}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] text-txt-faint">{timeAgo(a.created_at)}</span>
                </button>

                {expanded === a.id && a.report && (
                  <AnalysisDetail report={a.report} id={a.id} />
                )}
                {expanded === a.id && !a.report && a.status !== 'failed' && (
                  <div className="mt-4 space-y-2">
                    <p className="text-sm text-txt-muted">Analysis in progress…</p>
                    {a.threads.length > 0 && (
                      <div className="space-y-1">
                        {a.threads.map((t) => (
                          <div key={t.id} className="flex items-center gap-2 text-[11px] text-txt-faint">
                            <span className={`h-1.5 w-1.5 rounded-full ${statusColor(t.status)}`} />
                            <span>{t.label}</span>
                            <span className="text-txt-faint">({t.perspective})</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {expanded === a.id && a.error && (
                  <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-400">
                    {a.error}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AnalysisDetail({ report, id }: { report: AnalysisReport; id: string }) {
  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      {/* Summary */}
      <p className="text-sm text-txt-secondary leading-relaxed">{report.summary}</p>

      {/* SWOT Grid */}
      <div className="grid grid-cols-2 gap-3">
        <SwotCard title="Strengths" items={report.swot.strengths} color="tier-green" />
        <SwotCard title="Weaknesses" items={report.swot.weaknesses} color="red-400" />
        <SwotCard title="Opportunities" items={report.swot.opportunities} color="cyan" />
        <SwotCard title="Threats" items={report.swot.threats} color="amber-400" />
      </div>

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">Recommendations</p>
          <div className="space-y-2">
            {report.recommendations.map((rec, i) => (
              <div key={i} className="rounded-lg border border-border bg-raised px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                    rec.priority === 'high'
                      ? 'border-red-500/30 bg-red-500/15 text-red-400'
                      : rec.priority === 'medium'
                      ? 'border-amber-500/30 bg-amber-500/15 text-amber-400'
                      : 'border-blue-500/30 bg-blue-500/15 text-blue-400'
                  }`}>
                    {rec.priority}
                  </span>
                  <span className="text-sm font-medium text-txt-primary">{rec.title}</span>
                </div>
                <p className="mt-1 text-[12px] text-txt-muted leading-relaxed">{rec.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Export */}
      <div className="flex gap-2">
        <ExportButton label="Export MD" href={`${SCHEDULER_URL}/analysis/${id}/export?format=markdown`} />
        <ExportButton label="Export JSON" href={`${SCHEDULER_URL}/analysis/${id}/export?format=json`} />
      </div>
    </div>
  );
}

function SwotCard({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div className={`rounded-lg border border-${color}/20 bg-${color}/5 p-3`}>
      <p className={`text-[11px] font-semibold uppercase tracking-wider text-${color} mb-2`}>{title}</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-txt-faint">—</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="text-[12px] text-txt-secondary leading-relaxed">• {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── Simulations Panel ────────────────────────── */

function SimulationsPanel() {
  const [simulations, setSimulations] = useState<SimulationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  // Form
  const [action, setAction] = useState('');
  const [perspective, setPerspective] = useState<'optimistic' | 'neutral' | 'pessimistic'>('neutral');

  const refresh = useCallback(async () => {
    try {
      const records = await api<SimulationRecord[]>('/simulation');
      setSimulations(records);
    } catch { setSimulations([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll running simulations
  useEffect(() => {
    const running = simulations.some((s) => !['completed', 'failed', 'accepted', 'rejected'].includes(s.status));
    if (!running) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [simulations, refresh]);

  async function launch() {
    if (!action.trim()) return;
    setLaunching(true);
    try {
      await api('/simulation/run', {
        method: 'POST',
        body: JSON.stringify({ action: action.trim(), perspective, requestedBy: 'dashboard' }),
      });
      setAction('');
      await refresh();
    } catch (err) {
      console.error('Failed to launch simulation:', err);
    }
    setLaunching(false);
  }

  async function acceptSim(id: string) {
    await api(`/simulation/${id}/accept`, {
      method: 'POST',
      body: JSON.stringify({ acceptedBy: 'founder' }),
    });
    await refresh();
  }

  return (
    <div className="space-y-6">
      {/* Launch Form */}
      <Card>
        <SectionHeader title="Launch T+1 Simulation" />
        <p className="mt-1 mb-3 text-[12px] text-txt-muted">
          Describe a proposed action and the AI executive team will simulate its cascading impact across Revenue, Engineering, Product, Marketing, Customer Success, and Finance.
        </p>
        <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-end">
          <div>
            <label className="text-[11px] font-medium text-txt-muted mb-1 block">Proposed Action</label>
            <input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="e.g. 'Raise prices 20% across all tiers'"
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary placeholder:text-txt-faint focus:border-cyan focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && launch()}
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-txt-muted mb-1 block">Perspective</label>
            <select
              value={perspective}
              onChange={(e) => setPerspective(e.target.value as 'optimistic' | 'neutral' | 'pessimistic')}
              className="rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none"
            >
              {Object.entries(PERSPECTIVE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <button
            onClick={launch}
            disabled={launching || !action.trim()}
            className="rounded-lg bg-cyan px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {launching ? 'Launching…' : 'Run Simulation'}
          </button>
        </div>
      </Card>

      {/* Simulation List */}
      <div>
        <SectionHeader title="Past Simulations" />
        {loading ? (
          <div className="space-y-3 mt-3"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        ) : simulations.length === 0 ? (
          <p className="mt-4 text-center text-sm text-txt-faint">No simulations yet — launch one above</p>
        ) : (
          <div className="mt-3 space-y-3">
            {simulations.map((s) => (
              <Card key={s.id}>
                <button
                  onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className={`inline-block h-2 w-2 rounded-full ${statusColor(s.status)}`} />
                    <div>
                      <p className="text-sm font-medium text-txt-primary">{s.action}</p>
                      <p className="text-[11px] text-txt-muted">
                        {PERSPECTIVE_LABELS[s.perspective] ?? s.perspective} · {s.status}
                        {s.report && ` · Score: ${s.report.overallScore > 0 ? '+' : ''}${s.report.overallScore}`}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] text-txt-faint">{timeAgo(s.created_at)}</span>
                </button>

                {expanded === s.id && s.report && (
                  <SimulationDetail report={s.report} record={s} onAccept={() => acceptSim(s.id)} />
                )}
                {expanded === s.id && !s.report && s.status !== 'failed' && (
                  <div className="mt-4">
                    <p className="text-sm text-txt-muted">Simulation in progress… ({s.status})</p>
                  </div>
                )}
                {expanded === s.id && s.error && (
                  <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-400">
                    {s.error}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SimulationDetail({ report, record, onAccept }: { report: SimulationReport; record: SimulationRecord; onAccept: () => void }) {
  const rec = recommendationBadge(report.recommendation);

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      {/* Summary + Score + Recommendation */}
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-txt-secondary leading-relaxed flex-1">{report.summary}</p>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className={`text-2xl font-bold font-mono ${report.overallScore >= 3 ? 'text-tier-green' : report.overallScore >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
            {report.overallScore > 0 ? '+' : ''}{report.overallScore}
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${rec.cls}`}>
            {rec.text}
          </span>
        </div>
      </div>

      {/* Impact Matrix */}
      {report.dimensions.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">Impact by Department</p>
          <div className="grid grid-cols-2 gap-2">
            {report.dimensions.map((dim, i) => (
              <div key={i} className="rounded-lg border border-border bg-raised px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-txt-secondary">{dim.area}</span>
                  <span className={`font-mono text-sm font-semibold ${
                    dim.magnitude >= 3 ? 'text-tier-green' : dim.magnitude >= 0 ? 'text-amber-400' : 'text-red-400'
                  }`}>
                    {dim.magnitude > 0 ? '+' : ''}{dim.magnitude}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-txt-muted leading-relaxed">{dim.reasoning}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[10px] text-txt-faint">Confidence: {Math.round(dim.confidence * 100)}%</span>
                  <span className={`text-[10px] ${
                    dim.impact === 'positive' ? 'text-tier-green' : dim.impact === 'negative' ? 'text-red-400' : 'text-txt-faint'
                  }`}>
                    {dim.impact}
                  </span>
                </div>
                {dim.secondOrderEffects.length > 0 && (
                  <div className="mt-1.5">
                    <p className="text-[10px] text-txt-faint">2nd-order effects:</p>
                    {dim.secondOrderEffects.map((e, j) => (
                      <p key={j} className="text-[10px] text-txt-muted ml-2">· {e}</p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cascade Chain */}
      {report.cascadeChain.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">Cascade Chain</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {report.cascadeChain.map((link, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-lg border border-border bg-raised px-2.5 py-1.5 text-[11px]">
                <span className="font-medium text-cyan">{link.from}</span>
                <span className="text-txt-faint">→</span>
                <span className="font-medium text-txt-secondary">{link.to}</span>
                <span className="text-[10px] text-txt-faint">({link.delay})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Executive Votes */}
      {report.votes.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">Executive Votes</p>
          <div className="space-y-2">
            {report.votes.map((v, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-lg border border-border bg-raised px-3 py-2.5">
                <span className={`text-base mt-0.5 ${voteColor(v.vote)}`}>{voteIcon(v.vote)}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-txt-secondary">{v.agent}</span>
                    <span className={`text-[10px] font-medium ${voteColor(v.vote)}`}>
                      {v.vote}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-txt-muted leading-relaxed">{v.reasoning}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {record.status === 'completed' && (
          <button
            onClick={onAccept}
            className="rounded-lg bg-tier-green/15 border border-tier-green/30 px-4 py-1.5 text-sm font-medium text-tier-green transition-opacity hover:opacity-90"
          >
            Accept Recommendation
          </button>
        )}
        <ExportButton label="Export MD" href={`${SCHEDULER_URL}/simulation/${record.id}/export?format=markdown`} />
        <ExportButton label="Export JSON" href={`${SCHEDULER_URL}/simulation/${record.id}/export?format=json`} />
      </div>
    </div>
  );
}

/* ─── Chain of Thought Planning Panel ──────────── */

type CotPhase = 'decomposition' | 'solution_space' | 'options' | 'validation';

interface CotProblem {
  title: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
}

interface CotRootCause {
  cause: string;
  linkedProblem: string;
  evidence: string;
}

interface CotSolution {
  title: string;
  description: string;
  feasibility: number;
  timeframe: string;
  resources: string;
}

interface CotOption {
  title: string;
  pros: string[];
  cons: string[];
  feasibilityScore: number;
  reasoning: string;
}

interface CotValidation {
  assumption: string;
  status: 'valid' | 'questionable' | 'invalid';
  evidence: string;
}

interface CotReport {
  summary: string;
  problems: CotProblem[];
  rootCauses: CotRootCause[];
  solutions: CotSolution[];
  options: CotOption[];
  validations: CotValidation[];
}

interface CotRecord {
  id: string;
  query: string;
  status: 'planning' | 'decomposing' | 'mapping' | 'analyzing' | 'validating' | 'completed' | 'failed';
  requested_by: string;
  report: CotReport | null;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

const COT_PHASE_LABELS: Record<CotPhase, string> = {
  decomposition: 'Problem Decomposition',
  solution_space: 'Solution Space Mapping',
  options: 'Strategic Options Analysis',
  validation: 'Logical Validation',
};

function ChainOfThoughtPanel() {
  const [records, setRecords] = useState<CotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await api<CotRecord[]>('/cot');
      setRecords(data);
    } catch { setRecords([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const running = records.some((r) => !['completed', 'failed'].includes(r.status));
    if (!running) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [records, refresh]);

  async function launch() {
    if (!query.trim()) return;
    setLaunching(true);
    try {
      await api('/cot/run', {
        method: 'POST',
        body: JSON.stringify({ query: query.trim(), requestedBy: 'dashboard' }),
      });
      setQuery('');
      await refresh();
    } catch (err) {
      console.error('Failed to launch CoT analysis:', err);
    }
    setLaunching(false);
  }

  return (
    <div className="space-y-6">
      {/* Launch Form */}
      <Card>
        <SectionHeader title="Chain of Thought Planning" />
        <p className="mt-1 mb-3 text-[12px] text-txt-muted">
          Decompose complex strategic problems into structured reasoning chains. The AI executive team will identify core problems, map root causes, evaluate strategic options, and validate logical consistency.
        </p>
        <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label className="text-[11px] font-medium text-txt-muted mb-1 block">Strategic Question</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. 'Should we pivot from B2C to B2B enterprise sales?'"
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary placeholder:text-txt-faint focus:border-cyan focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && launch()}
            />
          </div>
          <button
            onClick={launch}
            disabled={launching || !query.trim()}
            className="rounded-lg bg-cyan px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {launching ? 'Launching…' : 'Analyze'}
          </button>
        </div>
      </Card>

      {/* Past CoT Analyses */}
      <div>
        <SectionHeader title="Past Analyses" />
        {loading ? (
          <div className="space-y-3 mt-3"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        ) : records.length === 0 ? (
          <p className="mt-4 text-center text-sm text-txt-faint">No chain-of-thought analyses yet — launch one above</p>
        ) : (
          <div className="mt-3 space-y-3">
            {records.map((r) => (
              <Card key={r.id}>
                <button
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className={`inline-block h-2 w-2 rounded-full ${statusColor(r.status)}`} />
                    <div>
                      <p className="text-sm font-medium text-txt-primary">{r.query}</p>
                      <p className="text-[11px] text-txt-muted">
                        Chain of Thought · {r.status}
                        {r.report && ` · ${r.report.problems.length} problems · ${r.report.options.length} options`}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] text-txt-faint">{timeAgo(r.created_at)}</span>
                </button>

                {expanded === r.id && r.report && (
                  <CotDetail report={r.report} id={r.id} />
                )}
                {expanded === r.id && !r.report && r.status !== 'failed' && (
                  <div className="mt-4">
                    <p className="text-sm text-txt-muted">Analysis in progress… ({r.status})</p>
                  </div>
                )}
                {expanded === r.id && r.error && (
                  <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-400">
                    {r.error}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CotDetail({ report, id }: { report: CotReport; id: string }) {
  const [phase, setPhase] = useState<CotPhase>('decomposition');

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      {/* Summary */}
      <p className="text-sm text-txt-secondary leading-relaxed">{report.summary}</p>

      {/* Phase Tabs */}
      <div className="flex gap-1 rounded-lg bg-base p-1 border border-border">
        {(['decomposition', 'solution_space', 'options', 'validation'] as CotPhase[]).map((p) => (
          <button
            key={p}
            onClick={() => setPhase(p)}
            className={`flex-1 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${
              phase === p
                ? 'bg-cyan/15 text-cyan'
                : 'text-txt-muted hover:text-txt-secondary'
            }`}
          >
            {COT_PHASE_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Phase Content */}
      {phase === 'decomposition' && (
        <div className="space-y-4">
          {/* Core Problems */}
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">Core Problems</p>
            <div className="space-y-2">
              {report.problems.map((p, i) => (
                <div key={i} className="rounded-lg border border-border bg-raised px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                      p.severity === 'high'
                        ? 'border-red-500/30 bg-red-500/15 text-red-400'
                        : p.severity === 'medium'
                        ? 'border-amber-500/30 bg-amber-500/15 text-amber-400'
                        : 'border-blue-500/30 bg-blue-500/15 text-blue-400'
                    }`}>
                      {p.severity}
                    </span>
                    <span className="text-sm font-medium text-txt-primary">{p.title}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-txt-muted leading-relaxed">{p.description}</p>
                </div>
              ))}
              {report.problems.length === 0 && (
                <p className="text-sm text-txt-faint">No problems identified</p>
              )}
            </div>
          </div>

          {/* Root Causes */}
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">Root Causes</p>
            <div className="space-y-2">
              {report.rootCauses.map((rc, i) => (
                <div key={i} className="rounded-lg border border-border bg-raised px-3 py-2.5">
                  <p className="text-sm font-medium text-txt-primary">{rc.cause}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[10px] text-txt-faint">Links to:</span>
                    <span className="text-[10px] font-medium text-cyan">{rc.linkedProblem}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-txt-muted leading-relaxed">{rc.evidence}</p>
                </div>
              ))}
              {report.rootCauses.length === 0 && (
                <p className="text-sm text-txt-faint">No root causes identified</p>
              )}
            </div>
          </div>
        </div>
      )}

      {phase === 'solution_space' && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">Mapped Solutions</p>
          <div className="space-y-2">
            {report.solutions.map((s, i) => (
              <div key={i} className="rounded-lg border border-border bg-raised px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-txt-primary">{s.title}</span>
                  <span className="font-mono text-sm font-semibold text-cyan">
                    {Math.round(s.feasibility * 100)}%
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-txt-muted leading-relaxed">{s.description}</p>
                <div className="mt-2 flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-txt-faint">Timeframe:</span>
                    <span className="text-[10px] font-medium text-txt-secondary">{s.timeframe}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-txt-faint">Resources:</span>
                    <span className="text-[10px] font-medium text-txt-secondary">{s.resources}</span>
                  </div>
                </div>
                {/* Feasibility bar */}
                <div className="mt-2 h-1.5 w-full rounded-full bg-base overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan to-azure transition-all"
                    style={{ width: `${Math.round(s.feasibility * 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {report.solutions.length === 0 && (
              <p className="text-sm text-txt-faint">No solutions mapped</p>
            )}
          </div>
        </div>
      )}

      {phase === 'options' && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">Strategic Options</p>
          <div className="space-y-3">
            {report.options.map((opt, i) => (
              <div key={i} className="rounded-lg border border-border bg-raised px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-txt-primary">{opt.title}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-txt-faint">Feasibility</span>
                    <span className={`font-mono text-sm font-semibold ${
                      opt.feasibilityScore >= 7 ? 'text-tier-green' : opt.feasibilityScore >= 4 ? 'text-amber-400' : 'text-red-400'
                    }`}>
                      {opt.feasibilityScore}/10
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Pros */}
                  <div className="rounded-lg border border-tier-green/20 bg-tier-green/5 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-tier-green mb-1.5">Pros</p>
                    {opt.pros.length > 0 ? (
                      <ul className="space-y-1">
                        {opt.pros.map((p, j) => (
                          <li key={j} className="text-[11px] text-txt-secondary leading-relaxed">+ {p}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-txt-faint">—</p>
                    )}
                  </div>
                  {/* Cons */}
                  <div className="rounded-lg border border-red-400/20 bg-red-400/5 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400 mb-1.5">Cons</p>
                    {opt.cons.length > 0 ? (
                      <ul className="space-y-1">
                        {opt.cons.map((c, j) => (
                          <li key={j} className="text-[11px] text-txt-secondary leading-relaxed">- {c}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-txt-faint">—</p>
                    )}
                  </div>
                </div>

                <p className="mt-2 text-[11px] text-txt-muted leading-relaxed">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-txt-faint">Reasoning: </span>
                  {opt.reasoning}
                </p>
              </div>
            ))}
            {report.options.length === 0 && (
              <p className="text-sm text-txt-faint">No options analyzed</p>
            )}
          </div>
        </div>
      )}

      {phase === 'validation' && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">Logical Validation</p>
          <div className="space-y-2">
            {report.validations.map((v, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-border bg-raised px-3 py-2.5">
                <span className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${
                  v.status === 'valid' ? 'bg-tier-green' : v.status === 'questionable' ? 'bg-amber-400' : 'bg-red-400'
                }`} />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-txt-primary">{v.assumption}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                      v.status === 'valid'
                        ? 'border-tier-green/30 bg-tier-green/15 text-tier-green'
                        : v.status === 'questionable'
                        ? 'border-amber-500/30 bg-amber-500/15 text-amber-400'
                        : 'border-red-500/30 bg-red-500/15 text-red-400'
                    }`}>
                      {v.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-txt-muted leading-relaxed">{v.evidence}</p>
                </div>
              </div>
            ))}
            {report.validations.length === 0 && (
              <p className="text-sm text-txt-faint">No validations performed</p>
            )}
          </div>
        </div>
      )}

      {/* Export */}
      <div className="flex gap-2">
        <ExportButton label="Export MD" href={`${SCHEDULER_URL}/cot/${id}/export?format=markdown`} />
        <ExportButton label="Export JSON" href={`${SCHEDULER_URL}/cot/${id}/export?format=json`} />
      </div>
    </div>
  );
}

/* ─── Shared Components ─────────────────────────── */

function ExportButton({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-lg border border-border bg-raised px-3 py-1.5 text-[11px] font-medium text-txt-muted transition-colors hover:text-txt-secondary hover:border-cyan/30"
    >
      {label}
    </a>
  );
}
