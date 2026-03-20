import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { MdCheck, MdWarning, MdClose, MdAutoAwesome, MdPalette, MdTrendingUp, MdFlag, MdArrowForward, MdChevronRight, MdSearch, MdPerson, MdExpandMore } from 'react-icons/md';
import Markdown from 'react-markdown';
import { SCHEDULER_URL } from '../lib/firebase';
import { Card, GradientButton, SectionHeader, Skeleton, timeAgo } from '../components/ui';
import { normalizeText } from '../lib/normalizeText';

/* ── Types ─────────────────────────────────────── */



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

interface CascadePredictionRecord {
  id: string;
  simulation_id: string;
  prediction_type: 'metric_change' | 'risk_event' | 'team_impact';
  predicted_value: Record<string, unknown>;
  actual_value: Record<string, unknown> | null;
  accuracy_score: number | null;
  outcome_observed_at: string | null;
  created_at: string;
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
  predictions?: CascadePredictionRecord[];
}

/* ── Helpers ───────────────────────────────────── */



const PERSPECTIVE_LABELS: Record<string, string> = {
  optimistic: 'Optimistic',
  neutral: 'Neutral',
  pessimistic: 'Pessimistic',
};

function statusColor(status: string) {
  if (status === 'completed' || status === 'accepted') return 'bg-tier-green';
  if (status === 'failed' || status === 'rejected') return 'bg-prism-critical';
  return 'bg-prism-elevated animate-pulse';
}

function recommendationBadge(rec: string) {
  if (rec === 'proceed') return { text: 'Proceed', cls: 'text-white bg-gradient-to-r from-green-400 via-green-500 to-green-600' };
  if (rec === 'proceed_with_caution') return { text: 'Proceed with Caution', cls: 'text-white bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600' };
  return { text: 'Reconsider', cls: 'text-white bg-gradient-to-r from-red-400 via-red-500 to-red-600' };
}

function voteIcon(vote: string): ReactNode {
  if (vote === 'approve') return <MdCheck className="inline h-4 w-4" />;
  if (vote === 'caution') return <MdWarning className="inline h-4 w-4" />;
  return <MdClose className="inline h-4 w-4" />;
}

function voteColor(vote: string) {
  if (vote === 'approve') return 'text-tier-green';
  if (vote === 'caution') return 'text-prism-elevated';
  return 'text-prism-critical';
}

function predictionTypeLabel(type: CascadePredictionRecord['prediction_type']) {
  if (type === 'metric_change') return 'Outcome';
  if (type === 'risk_event') return 'Risk';
  return 'Team Impact';
}

function predictionHeadline(prediction: CascadePredictionRecord) {
  const area = typeof prediction.predicted_value.area === 'string'
    ? prediction.predicted_value.area
    : null;
  if (prediction.prediction_type === 'metric_change') {
    const recommendation = String(prediction.predicted_value.recommendation ?? 'proceed_with_caution')
      .replace(/_/g, ' ');
    const score = prediction.predicted_value.overallScore;
    return `Recommendation: ${recommendation}${typeof score === 'number' ? ` (${score > 0 ? '+' : ''}${score})` : ''}`;
  }
  if (prediction.prediction_type === 'risk_event') {
    return area ? `Risk signal in ${area}` : 'Predicted risk event';
  }
  return area ? `${area} impact forecast` : 'Predicted team impact';
}

function predictionNarrative(prediction: CascadePredictionRecord) {
  if (prediction.prediction_type === 'metric_change') {
    return String(prediction.predicted_value.summary ?? 'Predicted cascade recommendation recorded for later calibration.');
  }
  const impact = typeof prediction.predicted_value.impact === 'string'
    ? prediction.predicted_value.impact
    : null;
  const magnitude = typeof prediction.predicted_value.magnitude === 'number'
    ? prediction.predicted_value.magnitude
    : null;
  const reasoning = typeof prediction.predicted_value.reasoning === 'string'
    ? prediction.predicted_value.reasoning
    : null;
  const prefix = impact
    ? `${impact}${typeof magnitude === 'number' ? ` (${magnitude > 0 ? '+' : ''}${magnitude})` : ''}`
    : null;
  return [prefix, reasoning].filter(Boolean).join(' — ') || 'Prediction recorded for weekly calibration.';
}

function observedOutcomeLabel(prediction: CascadePredictionRecord) {
  const outcome = prediction.actual_value && typeof prediction.actual_value.decisionOutcome === 'string'
    ? prediction.actual_value.decisionOutcome.replace(/_/g, ' ')
    : null;
  if (!outcome) return 'Pending observation';
  return `Observed: ${outcome}`;
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

type Tab = 'strategy-lab-v2' | 'deep-dives' | 'simulations' | 'cot';

export default function Strategy() {
  const [tab, setTab] = useState<Tab>('strategy-lab-v2');

  const TAB_LABELS: Record<Tab, string> = {
    'strategy-lab-v2': 'Strategic Analyses',
    'deep-dives': 'Deep Dives',
    simulations: 'Cascade Analysis',
    cot: 'Chain of Thought',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-txt-primary">Strategy Lab</h1>
        <p className="mt-1 text-sm text-txt-muted">
          Multi-agent strategic analyses, strategic deep dives, Cascade Analysis forecasts, and chain-of-thought planning
        </p>
      </div>

      {/* Tab Toggle */}
      <div className="flex gap-1 rounded-lg bg-raised p-1 w-fit border border-border">
        {(['strategy-lab-v2', 'deep-dives', 'simulations', 'cot'] as Tab[]).map((t) => (
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

      {tab === 'strategy-lab-v2' && <StrategyLabV2Panel />}
      {tab === 'deep-dives' && <DeepDivesPanel />}
      {tab === 'simulations' && <SimulationsPanel />}
      {tab === 'cot' && <ChainOfThoughtPanel />}
    </div>
  );
}

/* ══════════════════════════════════════════════════
   Deep Dives Panel — Strategic Research
   ══════════════════════════════════════════════════ */

type DeepDiveStatus = 'scoping' | 'researching' | 'analyzing' | 'framework-analysis' | 'synthesizing' | 'completed' | 'failed' | 'cancelled';

interface DeepDiveSource { title: string; url: string; snippet: string; researchArea: string; retrievedAt: string }

interface WatchlistItem {
  item: string;
  category: 'risk' | 'catalyst' | 'transaction' | 'leadership' | 'regulatory';
  trigger_signals: string[];
  current_status: string;
  priority: 'high' | 'medium' | 'low';
  created_at?: string;
}

interface FinancialSnapshot { revenue?: string; revenueGrowth?: string; headcount?: string; funding?: string; valuation?: string; profitability?: string }

interface DeepDiveReport {
  targetName: string;
  targetType: string;
  analysisDate: string;
  documentCounts: { secFilings: number; newsArticles: number; patents: number; researchSources: number };
  currentState: {
    momentum: 'positive' | 'neutral' | 'negative';
    keyStrengths: { point: string; evidence: string }[];
    keyChallenges: { point: string; evidence: string }[];
    financialSnapshot: FinancialSnapshot;
  };
  overview: { description: string; industry: string; founded?: string; headquarters?: string; leadership: { name: string; title: string }[]; products: { name: string; description: string }[]; businessModel: string };
  marketAnalysis: { tam: { value: string; methodology: string }; sam: { value: string; methodology: string }; som: { value: string; methodology: string }; growthRate: string; keyDrivers: string[]; keyTrends: string[]; regulatoryFactors: string[] };
  competitiveLandscape: {
    portersFiveForces: Record<string, { score: number; reasoning: string }>;
    competitors: { name: string; positioning: string; strengths: string[]; weaknesses: string[]; estimatedRevenue?: string; keyDifferentiator: string }[];
    competitiveAdvantage: string;
  };
  strategicRecommendations: { title: string; priority: string; description: string; expectedImpact: string; investmentRequired: string; riskLevel: string; implementationSteps: string[] }[];
  implementationRoadmap: { phase: string; timeline: string; milestones: string[]; resources: string; cost: string }[];
  roiAnalysis: { scenario: string; projections: { year: number; revenue: string; cost: string; netBenefit: string }[]; paybackPeriod: string; irr?: string; npv?: string }[];
  riskAssessment: { risk: string; probability: string; impact: string; mitigation: string; owner: string }[];
  sourceCitations?: { id: number; title: string; url?: string; type: string; snippet?: string; date?: string }[];
  verificationSummary?: { overallConfidence: number; areasVerified: number; flaggedClaims: string[]; correctionsMade: string[]; modelsUsed: string[] };
}

interface DeepDiveRecord {
  id: string;
  target: string;
  context: string | null;
  status: DeepDiveStatus;
  requested_by: string;
  sources: DeepDiveSource[];
  report: DeepDiveReport | null;
  framework_outputs?: Record<string, unknown>;
  framework_convergence?: string | null;
  watchlist?: WatchlistItem[];
  workflow_id?: string;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

type DeepDiveTab = 'current-state'| 'overview' | 'market' | 'competitive' | 'frameworks' | 'recommendations' | 'roadmap' | 'roi' | 'risks' | 'watchlist' | 'sources' | 'verification';

const DD_STATUS_LABELS: Record<DeepDiveStatus, string> = {
  scoping: 'Scoping research plan…',
  researching: 'Researching across 8 areas (5 queries each)…',
  analyzing: 'Multi-agent analysis + cross-model challenge…',
  'framework-analysis': 'Running 6 strategic frameworks…',
  synthesizing: 'Synthesizing with source citations…',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function ddStatusColor(status: DeepDiveStatus) {
  if (status === 'completed') return 'bg-tier-green';
  if (status === 'failed' || status === 'cancelled') return 'bg-prism-critical';
  return 'bg-cyan animate-pulse';
}

/* ── Workflow Step Progress (shared by deep dives + strategy lab) ─ */

interface WfStepData {
  id: string;
  type: string;
  agents: string[];
  status: 'completed' | 'running' | 'waiting' | 'pending' | 'failed' | 'skipped';
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  cost_usd: number | null;
}

interface WfDetail {
  id: string;
  status: string;
  current_step: number;
  total_steps: number;
  steps: WfStepData[];
}

function wfStepIcon(status: string): ReactNode {
  if (status === 'completed') return <span className="text-tier-green font-medium">✓</span>;
  if (status === 'running') return <span className="text-cyan animate-pulse font-medium">⟳</span>;
  if (status === 'waiting') return <span className="text-prism-elevated">⏳</span>;
  if (status === 'failed') return <span className="text-prism-critical font-medium">✗</span>;
  if (status === 'skipped') return <span className="text-txt-faint">⏭</span>;
  return <span className="text-txt-faint">–</span>;
}

function wfFormatMs(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function WorkflowStepProgress({ workflowId }: { workflowId: string }) {
  const [wf, setWf] = useState<WfDetail | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api<WfDetail>(`/workflows/${workflowId}`);
      setWf(data);
    } catch { /* ignore */ }
  }, [workflowId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!wf || ['completed', 'failed', 'cancelled'].includes(wf.status)) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [wf, refresh]);

  if (!wf) return null;

  return (
    <div className="rounded-lg bg-raised/60 p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm text-txt-muted mb-2">
        <span className="h-2 w-2 rounded-full bg-cyan animate-pulse" />
        Step {wf.current_step}/{wf.total_steps}
      </div>
      {wf.steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-3 text-[12px]">
          <span className="w-5 text-center shrink-0">{wfStepIcon(step.status)}</span>
          <span className="w-5 text-txt-faint font-mono">{i + 1}</span>
          <span className="flex-1 text-txt-secondary font-medium">{step.type}</span>
          {step.agents.length > 0 && (
            <span className="text-txt-faint">{step.agents.join(', ')}</span>
          )}
          {step.duration_ms != null && (
            <span className="text-txt-faint font-mono">{wfFormatMs(step.duration_ms)}</span>
          )}
          {step.cost_usd != null && step.cost_usd > 0 && (
            <span className="text-txt-faint font-mono">${step.cost_usd.toFixed(3)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function DeepDivesPanel() {
  const [records, setRecords] = useState<DeepDiveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [target, setTarget] = useState('');
  const [context, setContext] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await api<DeepDiveRecord[]>('/deep-dive');
      setRecords(data);
    } catch { setRecords([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const running = records.some((r) => !['completed', 'failed', 'cancelled'].includes(r.status));
    if (!running) return;
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [records, refresh]);

  const launch = async () => {
    if (!target.trim()) return;
    setLaunching(true);
    try {
      await api('/deep-dive/run', {
        method: 'POST',
        body: JSON.stringify({ target, context: context || undefined, requestedBy: 'dashboard' }),
      });
      setTarget('');
      setContext('');
      await refresh();
    } finally { setLaunching(false); }
  };

  return (
    <div className="space-y-6">
      {/* Launch Form */}
      <Card>
        <SectionHeader title="Launch Strategic Deep Dive" subtitle="8 areas × 5 queries × multi-model analysis → cross-model challenge → verification → cited synthesis" />
        <div className="mt-4 space-y-3">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Enter company name, market, or topic — e.g. 'Eaton Corporation plc'"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-txt-primary placeholder:text-txt-faint focus:outline-none focus:ring-1 focus:ring-cyan/50"
          />
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Optional context — e.g. 'Focus on their electrification strategy and industrial automation segment'"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-txt-primary placeholder:text-txt-faint focus:outline-none focus:ring-1 focus:ring-cyan/50 resize-none"
            rows={2}
          />
          <div className="flex justify-end">
            <button
              onClick={launch}
              disabled={launching || !target.trim()}
              className="rounded-lg bg-cyan/20 border border-cyan/30 px-5 py-2 text-sm font-medium text-cyan transition-all hover:bg-cyan/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <MdSearch className="text-base" />
              {launching ? 'Launching…' : 'Launch Deep Dive'}
            </button>
          </div>
        </div>
      </Card>

      {/* Records list */}
      {loading ? (
        <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : records.length === 0 ? (
        <Card><p className="text-center text-sm text-txt-muted py-6">No deep dives yet. Launch one above.</p></Card>
      ) : (
        <div className="space-y-3">
          {records.map((rec) => (
            <DeepDiveCard
              key={rec.id}
              record={rec}
              expanded={expanded === rec.id}
              onToggle={() => setExpanded(expanded === rec.id ? null : rec.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeepDiveCard({ record, expanded, onToggle }: { record: DeepDiveRecord; expanded: boolean; onToggle: () => void }) {
  return (
    <Card className="overflow-hidden">
      <button onClick={onToggle} className="w-full text-left px-5 py-4 flex items-center justify-between group">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <span className={`h-2 w-2 rounded-full flex-shrink-0 ${ddStatusColor(record.status)}`} />
            <span className="font-medium text-txt-primary truncate">{record.target}</span>
            {record.report && (
              <span className="text-[11px] text-txt-faint bg-raised px-2 py-0.5 rounded-full">{record.report.targetType}</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[12px] text-txt-muted">
            <span>{DD_STATUS_LABELS[record.status]}</span>
            <span>·</span>
            <span>{timeAgo(record.created_at)}</span>
            {record.report && (
              <>
                <span>·</span>
                <span>{record.report.documentCounts.researchSources} sources</span>
                {record.report.verificationSummary && (
                  <>
                    <span>·</span>
                    <span className={record.report.verificationSummary.overallConfidence >= 0.8 ? 'text-tier-green' : record.report.verificationSummary.overallConfidence >= 0.6 ? 'text-prism-elevated' : 'text-prism-critical'}>
                      {Math.round(record.report.verificationSummary.overallConfidence * 100)}% verified
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <MdExpandMore className={`text-xl text-txt-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && record.report && <DeepDiveDetail record={record} report={record.report} />}
      {expanded && !record.report && record.status !== 'completed' && (
        <div className="px-5 pb-4">
          {record.workflow_id ? (
            <WorkflowStepProgress workflowId={record.workflow_id} />
          ) : (
            <div className="rounded-lg bg-raised/60 p-4">
              <div className="flex items-center gap-2 text-sm text-txt-muted">
                <span className="h-2 w-2 rounded-full bg-cyan animate-pulse" />
                {DD_STATUS_LABELS[record.status]}
              </div>
              {record.error && <p className="mt-2 text-sm text-prism-critical">{record.error}</p>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function DeepDiveDetail({ record, report }: { record: DeepDiveRecord; report: DeepDiveReport }) {
  const [ddTab, setDdTab] = useState<DeepDiveTab>('current-state');

  const TAB_ITEMS: { key: DeepDiveTab; label: string }[] = [
    { key: 'current-state', label: 'Current State' },
    { key: 'overview', label: 'Overview' },
    { key: 'market', label: 'Market Analysis' },
    { key: 'competitive', label: 'Competitive' },
    { key: 'frameworks', label: 'Frameworks' },
    { key: 'recommendations', label: 'Strategic Recs' },
    { key: 'roadmap', label: 'Roadmap' },
    { key: 'roi', label: 'ROI Analysis' },
    { key: 'risks', label: 'Risk Assessment' },
    { key: 'watchlist', label: 'Watchlist' },
    { key: 'sources', label: 'Sources' },
    { key: 'verification', label: 'Verification' },
  ];

  return (
    <div className="border-t border-border">
      {/* Document counts banner */}
      <div className="flex gap-4 px-5 py-3 bg-raised/40 border-b border-border">
        {[
          { label: 'SEC Filings', val: report.documentCounts.secFilings, color: 'text-cyan' },
          { label: 'News Articles', val: report.documentCounts.newsArticles, color: 'text-tier-green' },
          { label: 'Patents', val: report.documentCounts.patents, color: 'text-prism-elevated' },
          { label: 'Research Sources', val: report.documentCounts.researchSources, color: 'text-prism-violet' },
        ].map((d) => (
          <div key={d.label} className="text-center">
            <span className={`text-lg font-bold ${d.color}`}>{d.val}</span>
            <span className="block text-[10px] text-txt-muted">{d.label}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <ExportButton label="DOCX" href={`${SCHEDULER_URL}/deep-dive/${record.id}/export?format=docx`} />
          <ExportButton label="PPTX" href={`${SCHEDULER_URL}/deep-dive/${record.id}/export?format=pptx`} />
          <ExportButton label="MD" href={`${SCHEDULER_URL}/deep-dive/${record.id}/export?format=markdown`} />
          <ExportButton label="JSON" href={`${SCHEDULER_URL}/deep-dive/${record.id}/export?format=json`} />
        </div>
      </div>

      {/* Inner tab navigation */}
      <div className="flex gap-1 px-5 py-2 border-b border-border overflow-x-auto">
        {TAB_ITEMS.map((t) => (
          <button
            key={t.key}
            onClick={() => setDdTab(t.key)}
            className={`rounded-md px-3 py-1 text-[12px] font-medium whitespace-nowrap transition-colors ${
              ddTab === t.key ? 'bg-cyan/15 text-cyan' : 'text-txt-muted hover:text-txt-secondary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-5 py-4 max-h-[600px] overflow-y-auto">
        {ddTab === 'current-state' && <DDCurrentState report={report} />}
        {ddTab === 'overview' && <DDOverview report={report} />}
        {ddTab === 'market' && <DDMarket report={report} />}
        {ddTab === 'competitive' && <DDCompetitive report={report} />}
        {ddTab === 'frameworks' && <DDFrameworks record={record} />}
        {ddTab === 'recommendations' && <DDRecommendations report={report} />}
        {ddTab === 'roadmap' && <DDRoadmap report={report} />}
        {ddTab === 'roi' && <DDRoi report={report} />}
        {ddTab === 'risks' && <DDRisks report={report} />}
        {ddTab === 'watchlist' && <DDWatchlist items={record.watchlist} />}
        {ddTab === 'sources' && <DDSources report={report} />}
        {ddTab === 'verification' && <DDVerification report={report} />}
      </div>
    </div>
  );
}

/* ── Deep Dive Sub-Tab Views ─────────────────── */

function DDCurrentState({ report }: { report: DeepDiveReport }) {
  const momColor = report.currentState.momentum === 'positive' ? 'text-tier-green' : report.currentState.momentum === 'negative' ? 'text-prism-critical' : 'text-prism-elevated';
  const momBg = report.currentState.momentum === 'positive' ? 'bg-tier-green/10 border-tier-green/30' : report.currentState.momentum === 'negative' ? 'bg-prism-critical/10 border-prism-critical/30' : 'bg-prism-elevated/10 border-prism-elevated/30';
  const fs = report.currentState.financialSnapshot;

  return (
    <div className="space-y-4">
      <div className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 border ${momBg}`}>
        <MdTrendingUp className={`text-base ${momColor}`} />
        <span className={`text-sm font-semibold ${momColor}`}>Momentum: {report.currentState.momentum.toUpperCase()}</span>
      </div>

      {(fs.revenue || fs.funding) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: 'Revenue', val: fs.revenue },
            { label: 'Growth', val: fs.revenueGrowth },
            { label: 'Headcount', val: fs.headcount },
            { label: 'Funding', val: fs.funding },
            { label: 'Valuation', val: fs.valuation },
            { label: 'Profitability', val: fs.profitability },
          ].filter((f) => f.val).map((f) => (
            <div key={f.label} className="rounded-lg bg-raised/60 p-3 border border-border">
              <span className="text-[10px] text-txt-muted uppercase tracking-wider">{f.label}</span>
              <p className="text-sm font-semibold text-txt-primary mt-0.5">{f.val}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs font-semibold text-tier-green uppercase tracking-wider mb-2">Key Strengths</h4>
          <div className="space-y-2">
            {report.currentState.keyStrengths.map((s, i) => (
              <div key={i} className="rounded-lg bg-tier-green/5 border border-tier-green/20 p-3">
                <p className="text-sm font-medium text-txt-primary">{s.point}</p>
                <p className="text-[12px] text-txt-muted mt-1">{s.evidence}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-xs font-semibold text-prism-critical uppercase tracking-wider mb-2">Key Challenges</h4>
          <div className="space-y-2">
            {report.currentState.keyChallenges.map((c, i) => (
              <div key={i} className="rounded-lg bg-prism-critical/5 border border-prism-critical/20 p-3">
                <p className="text-sm font-medium text-txt-primary">{c.point}</p>
                <p className="text-[12px] text-txt-muted mt-1">{c.evidence}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DDOverview({ report }: { report: DeepDiveReport }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-txt-secondary leading-relaxed">{report.overview.description}</p>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Industry', val: report.overview.industry },
          { label: 'Founded', val: report.overview.founded },
          { label: 'Headquarters', val: report.overview.headquarters },
          { label: 'Business Model', val: report.overview.businessModel },
        ].filter((f) => f.val).map((f) => (
          <div key={f.label} className="rounded-lg bg-raised/60 p-3 border border-border">
            <span className="text-[10px] text-txt-muted uppercase tracking-wider">{f.label}</span>
            <p className="text-sm text-txt-primary mt-0.5">{f.val}</p>
          </div>
        ))}
      </div>

      {report.overview.leadership.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-cyan uppercase tracking-wider mb-2">Leadership</h4>
          <div className="flex flex-wrap gap-2">
            {report.overview.leadership.map((l, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1 text-[12px] border border-border">
                <MdPerson className="text-cyan text-sm" />
                <span className="font-medium text-txt-primary">{l.name}</span>
                <span className="text-txt-muted">— {l.title}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {report.overview.products.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-cyan uppercase tracking-wider mb-2">Products & Services</h4>
          <div className="space-y-2">
            {report.overview.products.map((p, i) => (
              <div key={i} className="rounded-lg bg-raised/60 p-3 border border-border">
                <p className="text-sm font-medium text-txt-primary">{p.name}</p>
                <p className="text-[12px] text-txt-muted mt-0.5">{p.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DDMarket({ report }: { report: DeepDiveReport }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'TAM', ...report.marketAnalysis.tam },
          { label: 'SAM', ...report.marketAnalysis.sam },
          { label: 'SOM', ...report.marketAnalysis.som },
        ].map((s) => (
          <div key={s.label} className="rounded-lg bg-raised/60 p-4 border border-cyan/20 text-center">
            <span className="text-[11px] text-txt-muted font-semibold tracking-widest">{s.label}</span>
            <p className="text-lg font-bold text-cyan mt-1">{s.value}</p>
            <p className="text-[11px] text-txt-muted mt-1">{s.methodology}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-tier-green/10 border border-tier-green/20 px-4 py-2">
        <span className="text-sm font-semibold text-tier-green">Growth Rate: {report.marketAnalysis.growthRate}</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs font-semibold text-prism-elevated uppercase tracking-wider mb-2">Key Drivers</h4>
          <ul className="space-y-1">
            {report.marketAnalysis.keyDrivers.map((d, i) => (
              <li key={i} className="text-sm text-txt-secondary flex items-start gap-2">
                <MdChevronRight className="text-prism-elevated mt-0.5 flex-shrink-0" />{d}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-semibold text-cyan uppercase tracking-wider mb-2">Key Trends</h4>
          <ul className="space-y-1">
            {report.marketAnalysis.keyTrends.map((t, i) => (
              <li key={i} className="text-sm text-txt-secondary flex items-start gap-2">
                <MdChevronRight className="text-cyan mt-0.5 flex-shrink-0" />{t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {report.marketAnalysis.regulatoryFactors.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-prism-critical uppercase tracking-wider mb-2">Regulatory Factors</h4>
          <ul className="space-y-1">
            {report.marketAnalysis.regulatoryFactors.map((f, i) => (
              <li key={i} className="text-sm text-txt-secondary flex items-start gap-2">
                <MdWarning className="text-prism-critical mt-0.5 flex-shrink-0" />{f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DDCompetitive({ report }: { report: DeepDiveReport }) {
  const forces = report.competitiveLandscape.portersFiveForces;
  const forceLabels: [string, string][] = [
    ['threatOfNewEntrants', 'Threat of New Entrants'],
    ['bargainingPowerBuyers', 'Buyer Power'],
    ['bargainingPowerSuppliers', 'Supplier Power'],
    ['threatOfSubstitutes', 'Threat of Substitutes'],
    ['competitiveRivalry', 'Competitive Rivalry'],
  ];

  return (
    <div className="space-y-4">
      <h4 className="text-xs font-semibold text-prism-elevated uppercase tracking-wider">Porter's Five Forces</h4>
      <div className="space-y-2">
        {forceLabels.map(([key, label]) => {
          const f = forces[key];
          if (!f) return null;
          const pct = (f.score / 5) * 100;
          const barColor = f.score >= 4 ? 'bg-prism-critical' : f.score >= 3 ? 'bg-prism-elevated' : 'bg-tier-green';
          return (
            <div key={key} className="rounded-lg bg-raised/60 p-3 border border-border">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-txt-primary">{label}</span>
                <span className="text-sm font-bold text-txt-secondary">{f.score}/5</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[11px] text-txt-muted mt-1.5">{f.reasoning}</p>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg bg-cyan/5 border border-cyan/20 p-3">
        <span className="text-[10px] text-txt-muted uppercase tracking-wider">Competitive Advantage</span>
        <p className="text-sm text-txt-primary mt-1">{report.competitiveLandscape.competitiveAdvantage}</p>
      </div>

      {report.competitiveLandscape.competitors.length > 0 && (
        <>
          <h4 className="text-xs font-semibold text-cyan uppercase tracking-wider pt-2">Key Competitors</h4>
          <div className="space-y-2">
            {report.competitiveLandscape.competitors.map((c, i) => (
              <div key={i} className="rounded-lg bg-raised/60 p-3 border border-border">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-txt-primary">{c.name}</span>
                  {c.estimatedRevenue && <span className="text-[11px] text-txt-muted">{c.estimatedRevenue}</span>}
                </div>
                <p className="text-[12px] text-txt-muted mt-1">{c.positioning}</p>
                <p className="text-[11px] text-cyan mt-1">Differentiator: {c.keyDifferentiator}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Framework Analysis Tab ──────────────────── */

const FRAMEWORK_NAMES: Record<string, { label: string; color: string }> = {
  'framework-ansoff': { label: 'Ansoff Growth Matrix', color: 'text-tier-green' },
  'framework-bcg': { label: 'BCG Matrix', color: 'text-prism-violet' },
  'framework-blue-ocean': { label: 'Blue Ocean Strategy', color: 'text-cyan' },
  'framework-porters': { label: "Porter's Five Forces", color: 'text-prism-elevated' },
  'framework-pestle': { label: 'PESTLE Analysis', color: 'text-prism-high' },
  'framework-swot': { label: 'Enhanced SWOT', color: 'text-prism-critical' },
};

function DDFrameworks({ record }: { record: DeepDiveRecord }) {
  const outputs = record.framework_outputs ?? {};
  const convergence = record.framework_convergence;
  const frameworkIds = Object.keys(outputs);

  if (frameworkIds.length === 0) {
    return <p className="text-sm text-txt-faint">No framework analyses available yet.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Convergence narrative */}
      {convergence && (
        <div className="rounded-lg border border-cyan/20 bg-cyan/5 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan mb-1.5">Framework Convergence</p>
          <p className="text-[12px] text-txt-primary leading-relaxed whitespace-pre-wrap">{normalizeText(convergence)}</p>
        </div>
      )}

      {/* Individual framework cards */}
      <div className="grid grid-cols-1 gap-3">
        {frameworkIds.map((fId) => {
          const meta = FRAMEWORK_NAMES[fId] ?? { label: fId, color: 'text-txt-secondary' };
          const data = outputs[fId] as Record<string, unknown> | undefined;
          if (!data) return null;

          const summary = typeof data.summary === 'string' ? data.summary : null;
          const keyInsight = typeof data.key_insight === 'string' ? data.key_insight : null;

          return (
            <FrameworkCard
              key={fId}
              label={meta.label}
              color={meta.color}
              summary={summary}
              keyInsight={keyInsight}
              data={data}
            />
          );
        })}
      </div>
    </div>
  );
}

function FrameworkCard({ label, color, summary, keyInsight, data }: {
  label: string;
  color: string;
  summary: string | null;
  keyInsight: string | null;
  data: Record<string, unknown>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-raised/60 p-4">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between text-left">
        <span className={`text-xs font-semibold uppercase tracking-wider ${color}`}>{label}</span>
        <MdExpandMore className={`h-4 w-4 text-txt-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {summary && <p className="text-[12px] text-txt-secondary leading-relaxed mt-2">{summary}</p>}
      {keyInsight && (
        <div className="mt-2 rounded-md bg-prism-elevated/5 border border-prism-elevated/15 px-3 py-1.5">
          <span className="text-[10px] font-semibold text-prism-elevated">Key Insight: </span>
          <span className="text-[11px] text-txt-secondary">{keyInsight}</span>
        </div>
      )}
      {expanded && (
        <pre className="mt-3 rounded-md bg-surface p-3 text-[10px] text-txt-muted overflow-x-auto max-h-[300px] overflow-y-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function DDRecommendations({ report }: { report: DeepDiveReport }) {
  const priColor = (p: string) => p === 'immediate' ? 'text-prism-critical bg-prism-critical/10 border-prism-critical/20' : p === 'short-term' ? 'text-prism-elevated bg-prism-elevated/10 border-prism-elevated/20' : 'text-cyan bg-cyan/10 border-cyan/20';

  return (
    <div className="space-y-3">
      {report.strategicRecommendations.map((rec, i) => (
        <div key={i} className="rounded-lg bg-raised/60 border border-border p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-bold text-cyan">{i + 1}.</span>
            <span className="text-sm font-semibold text-txt-primary flex-1">{rec.title}</span>
            <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${priColor(rec.priority)}`}>
              {rec.priority}
            </span>
          </div>
          <p className="text-[13px] text-txt-secondary mb-3">{rec.description}</p>
          <div className="flex gap-3 text-[11px]">
            <span className="text-tier-green"><MdFlag className="inline mr-1" />Impact: {rec.expectedImpact}</span>
            <span className="text-txt-muted">Investment: {rec.investmentRequired}</span>
            <span className={rec.riskLevel === 'high' ? 'text-prism-critical' : rec.riskLevel === 'medium' ? 'text-prism-elevated' : 'text-tier-green'}>
              Risk: {rec.riskLevel}
            </span>
          </div>
          {rec.implementationSteps.length > 0 && (
            <div className="mt-3 pl-3 border-l-2 border-cyan/20">
              {rec.implementationSteps.map((s, j) => (
                <p key={j} className="text-[12px] text-txt-muted py-0.5">{j + 1}. {s}</p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DDRoadmap({ report }: { report: DeepDiveReport }) {
  return (
    <div className="space-y-3">
      {report.implementationRoadmap.map((phase, i) => (
        <div key={i} className="rounded-lg bg-raised/60 border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-txt-primary">{phase.phase}</span>
            <span className="text-[11px] text-cyan font-medium">{phase.timeline}</span>
          </div>
          <div className="flex gap-4 text-[11px] text-txt-muted mb-2">
            <span>Resources: {phase.resources}</span>
            <span>Cost: {phase.cost}</span>
          </div>
          <div className="space-y-1">
            {phase.milestones.map((m, j) => (
              <div key={j} className="flex items-center gap-2 text-[12px] text-txt-secondary">
                <MdArrowForward className="text-cyan text-xs flex-shrink-0" />{m}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DDRoi({ report }: { report: DeepDiveReport }) {
  return (
    <div className="space-y-4">
      {report.roiAnalysis.map((scenario, i) => (
        <div key={i} className="rounded-lg bg-raised/60 border border-border p-4">
          <h4 className="text-sm font-semibold text-txt-primary capitalize mb-2">{scenario.scenario} Case</h4>
          <div className="flex gap-4 text-[12px] text-txt-muted mb-3">
            {scenario.paybackPeriod && <span>Payback: <span className="text-cyan font-medium">{scenario.paybackPeriod}</span></span>}
            {scenario.irr && <span>IRR: <span className="text-tier-green font-medium">{scenario.irr}</span></span>}
            {scenario.npv && <span>NPV: <span className="text-tier-green font-medium">{scenario.npv}</span></span>}
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1 text-txt-muted font-medium">Year</th>
                <th className="text-right py-1 text-txt-muted font-medium">Revenue</th>
                <th className="text-right py-1 text-txt-muted font-medium">Cost</th>
                <th className="text-right py-1 text-txt-muted font-medium">Net Benefit</th>
              </tr>
            </thead>
            <tbody>
              {scenario.projections.map((p) => (
                <tr key={p.year} className="border-b border-border/50">
                  <td className="py-1.5 text-txt-secondary">Year {p.year}</td>
                  <td className="py-1.5 text-right text-tier-green">{p.revenue}</td>
                  <td className="py-1.5 text-right text-prism-critical">{p.cost}</td>
                  <td className="py-1.5 text-right text-cyan font-medium">{p.netBenefit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function DDRisks({ report }: { report: DeepDiveReport }) {
  const probColor = (p: string) => p === 'high' ? 'text-prism-critical' : p === 'medium' ? 'text-prism-elevated' : 'text-tier-green';
  const impactBg = (impact: string) => impact === 'high' ? 'bg-prism-critical/10 border-prism-critical/30' : impact === 'medium' ? 'bg-prism-elevated/10 border-prism-elevated/30' : 'bg-tier-green/10 border-tier-green/30';

  return (
    <div className="space-y-2">
      {report.riskAssessment.map((risk, i) => (
        <div key={i} className={`rounded-lg border p-3 ${impactBg(risk.impact)}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-txt-primary">{risk.risk}</span>
            <div className="flex gap-2 text-[10px] font-semibold uppercase">
              <span className={probColor(risk.probability)}>P: {risk.probability}</span>
              <span className={probColor(risk.impact)}>I: {risk.impact}</span>
            </div>
          </div>
          <p className="text-[12px] text-txt-muted">{risk.mitigation}</p>
          <p className="text-[11px] text-txt-faint mt-1">Owner: {risk.owner}</p>
        </div>
      ))}
    </div>
  );
}

const WATCHLIST_CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  risk: { bg: 'bg-prism-critical/10 border-prism-critical/30', text: 'text-prism-critical' },
  catalyst: { bg: 'bg-tier-green/10 border-tier-green/30', text: 'text-tier-green' },
  transaction: { bg: 'bg-cyan/10 border-cyan/30', text: 'text-cyan' },
  leadership: { bg: 'bg-prism-violet/10 border-prism-violet/30', text: 'text-prism-violet' },
  regulatory: { bg: 'bg-prism-elevated/10 border-prism-elevated/30', text: 'text-prism-elevated' },
};

function DDWatchlist({ items }: { items?: WatchlistItem[] }) {
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  if (!items || items.length === 0) return <p className="text-sm text-txt-muted">No watchlist items extracted yet.</p>;

  const categories = [...new Set(items.map((w) => w.category))];
  const filtered = categoryFilter ? items.filter((w) => w.category === categoryFilter) : items;
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const sorted = [...filtered].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setCategoryFilter(null)} className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase ${!categoryFilter ? 'bg-cyan/20 text-cyan' : 'bg-raised text-txt-muted hover:text-txt-primary'}`}>All ({items.length})</button>
        {categories.map((cat) => {
          const colors = WATCHLIST_CATEGORY_COLORS[cat] || { text: 'text-txt-muted' };
          return <button key={cat} onClick={() => setCategoryFilter(cat)} className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase ${categoryFilter === cat ? `${colors.text} bg-white/5` : 'text-txt-muted hover:text-txt-primary'}`}>{cat} ({items.filter((w) => w.category === cat).length})</button>;
        })}
      </div>
      {sorted.map((w, i) => {
        const colors = WATCHLIST_CATEGORY_COLORS[w.category] || { bg: 'bg-raised border-border', text: 'text-txt-muted' };
        return (
          <div key={i} className={`rounded-lg border p-3 ${colors.bg}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-txt-primary flex-1">{w.item}</span>
              <div className="flex gap-2 shrink-0 ml-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${colors.text}`}>{w.category}</span>
                <span className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase ${w.priority === 'high' ? 'text-white bg-gradient-to-r from-red-400 via-red-500 to-red-600' : w.priority === 'medium' ? 'text-white bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600' : 'text-white bg-gradient-to-r from-green-400 via-green-500 to-green-600'}`}>{w.priority}</span>
              </div>
            </div>
            <p className="text-[12px] text-txt-muted">{w.current_status}</p>
            {w.trigger_signals.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {w.trigger_signals.map((sig, si) => <span key={si} className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-txt-faint">{sig}</span>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DDSources({ report }: { report: DeepDiveReport }) {
  const citations = report.sourceCitations ?? [];
  if (citations.length === 0) return <p className="text-sm text-txt-muted">No source citations available.</p>;
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-txt-faint mb-3">{citations.length} sources cited in this analysis</p>
      {citations.map((src) => (
        <div key={src.id} className="flex items-start gap-2 rounded-lg bg-raised/40 px-3 py-2">
          <span className="text-xs font-bold text-cyan mt-0.5">[{src.id}]</span>
          <div className="flex-1 min-w-0">
            <span className="text-sm text-txt-primary">{src.title}</span>
            {src.url && (
              <a href={src.url} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-cyan/70 hover:text-cyan truncate">{src.url}</a>
            )}
            <div className="flex gap-2 mt-0.5">
              <span className="text-[10px] text-txt-faint uppercase">{src.type}</span>
              {src.date && <span className="text-[10px] text-txt-faint">{src.date}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DDVerification({ report }: { report: DeepDiveReport }) {
  const vs = report.verificationSummary;
  if (!vs) return <p className="text-sm text-txt-muted">No verification data available.</p>;

  const confColor = vs.overallConfidence >= 0.8 ? 'text-tier-green' : vs.overallConfidence >= 0.6 ? 'text-prism-elevated' : 'text-prism-critical';
  const confBg = vs.overallConfidence >= 0.8 ? 'bg-tier-green/10 border-tier-green/30' : vs.overallConfidence >= 0.6 ? 'bg-prism-elevated/10 border-prism-elevated/30' : 'bg-prism-critical/10 border-prism-critical/30';

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border p-4 ${confBg}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-txt-primary">Overall Confidence</span>
          <span className={`text-2xl font-bold ${confColor}`}>{Math.round(vs.overallConfidence * 100)}%</span>
        </div>
        <div className="mt-2 flex gap-4 text-[12px] text-txt-muted">
          <span>{vs.areasVerified} areas verified</span>
          <span>·</span>
          <span>{vs.modelsUsed.join(', ')}</span>
        </div>
      </div>

      {vs.flaggedClaims.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-prism-elevated uppercase mb-2">Flagged Claims</h4>
          <div className="space-y-1.5">
            {vs.flaggedClaims.map((claim, i) => (
              <div key={i} className="rounded-lg bg-prism-elevated/5 border border-prism-elevated/20 px-3 py-2 text-sm text-txt-secondary">{claim}</div>
            ))}
          </div>
        </div>
      )}

      {vs.correctionsMade.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-tier-green uppercase mb-2">Corrections Applied</h4>
          <div className="space-y-1.5">
            {vs.correctionsMade.map((corr, i) => (
              <div key={i} className="rounded-lg bg-tier-green/5 border border-tier-green/20 px-3 py-2 text-sm text-txt-secondary">{corr}</div>
            ))}
          </div>
        </div>
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
        <SectionHeader title="Launch Cascade Analysis" />
        <p className="mt-1 mb-3 text-[12px] text-txt-muted">
          Describe a proposed action and the AI executive team will forecast its cascading impact across Revenue, Engineering, Product, Marketing, and Finance.
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
          <GradientButton
            onClick={launch}
            disabled={launching || !action.trim()}
          >
            {launching ? 'Launching…' : 'Run Cascade'}
          </GradientButton>
        </div>
      </Card>

      {/* Simulation List */}
      <div>
        <SectionHeader title="Past Cascade Analyses" />
        {loading ? (
          <div className="space-y-3 mt-3"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        ) : simulations.length === 0 ? (
          <p className="mt-4 text-center text-sm text-txt-faint">No cascade analyses yet — launch one above</p>
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
                    <p className="text-sm text-txt-muted">Cascade Analysis in progress… ({s.status})</p>
                  </div>
                )}
                {expanded === s.id && s.error && (
                  <p className="mt-3 rounded-lg border border-prism-critical/20 bg-prism-critical/5 px-3 py-2 text-sm text-prism-critical">
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
  const positiveCount = report.dimensions.filter((dim) => dim.impact === 'positive').length;
  const negativeCount = report.dimensions.filter((dim) => dim.impact === 'negative').length;
  const neutralCount = report.dimensions.filter((dim) => dim.impact === 'neutral').length;
  const predictions = record.predictions ?? [];
  const observedPredictions = predictions.filter((prediction) => prediction.outcome_observed_at && typeof prediction.accuracy_score === 'number');
  const avgAccuracy = observedPredictions.length > 0
    ? observedPredictions.reduce((sum, prediction) => sum + (prediction.accuracy_score ?? 0), 0) / observedPredictions.length
    : null;

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      {/* Summary + Score + Recommendation */}
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-txt-secondary leading-relaxed flex-1">{report.summary}</p>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className={`text-2xl font-bold font-mono ${report.overallScore >= 3 ? 'text-tier-green' : report.overallScore >= 0 ? 'text-prism-elevated' : 'text-prism-critical'}`}>
            {report.overallScore > 0 ? '+' : ''}{report.overallScore}
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${rec.cls}`}>
            {rec.text}
          </span>
        </div>
      </div>

      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">Cascade Map</p>
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch">
          <div className="rounded-lg border border-border bg-raised px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-txt-faint">Current State</p>
            <p className="mt-2 text-[12px] text-txt-secondary leading-relaxed">
              {report.dimensions.length} impacted domains under a {PERSPECTIVE_LABELS[record.perspective] ?? record.perspective.toLowerCase()} scenario.
            </p>
            <p className="mt-2 text-[11px] text-txt-faint">
              {positiveCount} positive · {negativeCount} negative · {neutralCount} neutral
            </p>
          </div>
          <div className="flex items-center justify-center text-cyan"><MdArrowForward /></div>
          <div className="rounded-lg border border-cyan/20 bg-cyan/5 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan">Proposed Action</p>
            <p className="mt-2 text-[12px] text-txt-primary leading-relaxed">{record.action}</p>
          </div>
          <div className="flex items-center justify-center text-cyan"><MdArrowForward /></div>
          <div className="rounded-lg border border-border bg-raised px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-txt-faint">Predicted State T+1</p>
            <p className="mt-2 text-[12px] text-txt-secondary leading-relaxed">{report.summary}</p>
            <p className="mt-2 text-[11px] text-txt-faint">
              Recommendation: <span className="text-txt-secondary">{rec.text}</span>
            </p>
          </div>
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
                    dim.magnitude >= 3 ? 'text-tier-green' : dim.magnitude >= 0 ? 'text-prism-elevated' : 'text-prism-critical'
                  }`}>
                    {dim.magnitude > 0 ? '+' : ''}{dim.magnitude}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-txt-muted leading-relaxed">{dim.reasoning}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[10px] text-txt-faint">Confidence: {Math.round(dim.confidence * 100)}%</span>
                  <span className={`text-[10px] ${
                    dim.impact === 'positive' ? 'text-tier-green' : dim.impact === 'negative' ? 'text-prism-critical' : 'text-txt-faint'
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
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">Cascade Paths</p>
          <div className="grid gap-2 md:grid-cols-2">
            {report.cascadeChain.map((link, i) => (
              <div key={i} className="rounded-lg border border-border bg-raised px-3 py-2 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-cyan">{link.from}</span>
                  <MdArrowForward className="text-txt-faint" />
                  <span className="font-medium text-txt-secondary">{link.to}</span>
                  <span className="ml-auto text-[10px] text-txt-faint">{link.delay}</span>
                </div>
                <p className="mt-1 text-[11px] text-txt-muted">{link.effect}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {predictions.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Prediction Journal</p>
            <p className="text-[10px] text-txt-faint">
              {observedPredictions.length}/{predictions.length} observed
              {avgAccuracy !== null && ` · Avg accuracy ${Math.round(avgAccuracy * 100)}%`}
            </p>
          </div>
          <div className="space-y-2">
            {predictions.map((prediction) => (
              <div key={prediction.id} className="rounded-lg border border-border bg-raised px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan">
                      {predictionTypeLabel(prediction.prediction_type)}
                    </p>
                    <p className="mt-1 text-[12px] font-medium text-txt-secondary">
                      {predictionHeadline(prediction)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-txt-faint">{observedOutcomeLabel(prediction)}</p>
                    <p className="mt-1 text-[10px] text-txt-faint">
                      {typeof prediction.accuracy_score === 'number'
                        ? `Accuracy ${Math.round(prediction.accuracy_score * 100)}%`
                        : 'Awaiting weekly check'}
                    </p>
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-txt-muted leading-relaxed">
                  {predictionNarrative(prediction)}
                </p>
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
      <div className="flex flex-wrap gap-2">
        {record.status === 'completed' && (
          <button
            onClick={onAccept}
            className="rounded-lg bg-tier-green/15 border border-tier-green/30 px-4 py-1.5 text-sm font-medium text-tier-green transition-opacity hover:opacity-90"
          >
            Accept Recommendation
          </button>
        )}
        <ExportButton label="Word (.docx)" href={`${SCHEDULER_URL}/simulation/${record.id}/export?format=docx`} />
        <ExportButton label="PowerPoint" href={`${SCHEDULER_URL}/simulation/${record.id}/export?format=pptx`} />
        <ExportButton label="Markdown" href={`${SCHEDULER_URL}/simulation/${record.id}/export?format=markdown`} />
        <ExportButton label="JSON" href={`${SCHEDULER_URL}/simulation/${record.id}/export?format=json`} />
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
              placeholder="e.g. 'Should we narrow ICP to founder-led SMB teams already on Slack?'"
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary placeholder:text-txt-faint focus:border-cyan focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && launch()}
            />
          </div>
          <GradientButton
            onClick={launch}
            disabled={launching || !query.trim()}
          >
            {launching ? 'Launching…' : 'Analyze'}
          </GradientButton>
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
                  <p className="mt-3 rounded-lg border border-prism-critical/20 bg-prism-critical/5 px-3 py-2 text-sm text-prism-critical">
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
                    <span className={`rounded-lg px-1.5 py-0.5 text-[10px] font-medium ${
                      p.severity === 'high'
                        ? 'text-white bg-gradient-to-r from-red-400 via-red-500 to-red-600'
                        : p.severity === 'medium'
                        ? 'text-white bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600'
                        : 'text-white bg-gradient-to-r from-sky-400 via-sky-500 to-sky-600'
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
                    className="h-full rounded-full bg-cyan transition-all"
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
                      opt.feasibilityScore >= 7 ? 'text-tier-green' : opt.feasibilityScore >= 4 ? 'text-prism-elevated' : 'text-prism-critical'
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
                  <div className="rounded-lg border border-prism-critical/20 bg-prism-critical/5 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-prism-critical mb-1.5">Cons</p>
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
                  v.status === 'valid' ? 'bg-tier-green' : v.status === 'questionable' ? 'bg-prism-elevated' : 'bg-prism-critical'
                }`} />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-txt-primary">{v.assumption}</span>
                    <span className={`rounded-lg px-2 py-0.5 text-[10px] font-medium ${
                      v.status === 'valid'
                        ? 'text-white bg-gradient-to-r from-green-400 via-green-500 to-green-600'
                        : v.status === 'questionable'
                        ? 'text-white bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600'
                        : 'text-white bg-gradient-to-r from-red-400 via-red-500 to-red-600'
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
        <ExportButton label="Markdown" href={`${SCHEDULER_URL}/cot/${id}/export?format=markdown`} />
        <ExportButton label="JSON" href={`${SCHEDULER_URL}/cot/${id}/export?format=json`} />
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

/* ══════════════════════════════════════════════
   Strategy Lab v2 — Multi-Agent Strategic Analysis
   ══════════════════════════════════════════════ */

type SLv2AnalysisType = 'competitive_landscape' | 'market_opportunity' | 'product_strategy' | 'growth_diagnostic' | 'risk_assessment' | 'market_entry' | 'due_diligence';
type SLv2Depth = 'quick' | 'standard' | 'deep' | 'comprehensive';
type SLv2Status = 'planning' | 'framing' | 'decomposing' | 'researching' | 'quality-check' | 'framework-analysis' | 'analyzing' | 'synthesizing' | 'deepening' | 'completed' | 'failed';

interface SLv2ResearchProgress {
  analystRole: string;
  analystName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  searchCount?: number;
  sourceCount?: number;
  error?: string;
}

interface SLv2ExecProgress {
  execRole: string;
  execName: string;
  framework: string;
  status: 'waiting' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface SLv2Synthesis {
  executiveSummary: string;
  unifiedSwot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  crossFrameworkInsights: string[];
  strategicRecommendations: { title: string; description: string; impact: string; feasibility: string; owner: string; expectedOutcome: string; riskIfNot: string }[];
  keyRisks: string[];
  openQuestionsForFounders: string[];
}

interface SLv2Record {
  id: string;
  query: string;
  analysis_type: SLv2AnalysisType;
  depth: SLv2Depth;
  status: SLv2Status;
  requested_by: string;
  research_progress: SLv2ResearchProgress[];
  executive_progress: SLv2ExecProgress[];
  synthesis: SLv2Synthesis | null;
  total_searches: number;
  total_sources: number;
  sophia_qc: Record<string, unknown> | null;
  cover_memos: Record<string, unknown> | null;
  gaps_filled: string[];
  remaining_gaps: string[];
  overall_confidence: string | null;
  framework_outputs?: Record<string, unknown>;
  framework_convergence?: string | null;
  watchlist?: WatchlistItem[];
  workflow_id?: string;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

const SLV2_TYPE_LABELS: Record<SLv2AnalysisType, string> = {
  competitive_landscape: 'Competitive Landscape',
  market_opportunity: 'Market Opportunity',
  product_strategy: 'Product Strategy',
  growth_diagnostic: 'Growth Diagnostic',
  risk_assessment: 'Risk Assessment',
  market_entry: 'Market Entry',
  due_diligence: 'Due Diligence',
};

const SLV2_DEPTH_LABELS: Record<SLv2Depth, string> = {
  quick: 'Quick — Sarah only (~2 min)',
  standard: 'Standard — 3 analysts + 2 execs (~10 min)',
  deep: 'Deep Research — 6 analysts + 4 execs (~20 min)',
  comprehensive: 'Comprehensive Research — full + follow-up (~35 min)',
};

const SLV2_STATUS_LABELS: Record<SLv2Status, string> = {
  planning: 'Planning research briefs…',
  framing: 'Phase 0: Sarah framing request…',
  decomposing: 'Phase 0.5: Sophia decomposing research…',
  researching: 'Wave 1: Research team gathering data…',
  'quality-check': 'Wave 1.5: Sophia QC & packaging…',
  'framework-analysis': 'Wave 1.75: Running 6 strategic frameworks…',
  analyzing: 'Wave 2: Executive analysis…',
  synthesizing: 'Wave 3: Sarah synthesizing…',
  deepening: 'Wave 4: Follow-up research…',
  completed: 'Completed',
  failed: 'Failed',
};

function slv2StatusColor(status: SLv2Status) {
  if (status === 'completed') return 'bg-tier-green';
  if (status === 'failed') return 'bg-prism-critical';
  return 'bg-cyan animate-pulse';
}

function StrategyLabV2Panel() {
  const [records, setRecords] = useState<SLv2Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  const [query, setQuery] = useState('');
  const [analysisType, setAnalysisType] = useState<SLv2AnalysisType>('competitive_landscape');
  const [depth, setDepth] = useState<SLv2Depth>('standard');
  const [includeDeepDiveResearch, setIncludeDeepDiveResearch] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api<SLv2Record[]>('/strategy-lab');
      setRecords(data);
    } catch { setRecords([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll while any are running
  useEffect(() => {
    const running = records.some((r) => !['completed', 'failed'].includes(r.status));
    if (!running) return;
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [records, refresh]);

  const launch = async () => {
    if (!query.trim()) return;
    setLaunching(true);
    try {
      const trimmedQuery = query.trim();
      const launches: Promise<unknown>[] = [api('/strategy-lab/run', {
        method: 'POST',
        body: JSON.stringify({ query: trimmedQuery, analysisType, depth, requestedBy: 'dashboard' }),
      })];

      if (includeDeepDiveResearch) {
        launches.push(
          api('/deep-dive/run', {
            method: 'POST',
            body: JSON.stringify({
              target: trimmedQuery,
              context: `Attached strategy analysis: ${SLV2_TYPE_LABELS[analysisType]} at ${SLV2_DEPTH_LABELS[depth]}`,
              requestedBy: 'dashboard',
            }),
          }),
        );
      }

      await Promise.all(launches);
      setQuery('');
      await refresh();
    } finally { setLaunching(false); }
  };

  return (
    <div className="space-y-6">
      {/* Launch Form */}
      <Card>
        <SectionHeader title="Launch Multi-Agent Strategy Analysis" subtitle="Research team → Executive analysis → Sarah synthesis" />
        <div className="mt-4 space-y-3">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. 'Analyze competitor landscape for AI-powered website builders targeting SMBs'"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-txt-primary placeholder:text-txt-faint focus:outline-none focus:ring-1 focus:ring-cyan/50 resize-none"
            rows={2}
          />
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="text-[11px] font-medium text-txt-muted mb-1 block">Analysis Type</label>
              <select
                value={analysisType}
                onChange={(e) => setAnalysisType(e.target.value as SLv2AnalysisType)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-txt-primary focus:outline-none focus:ring-1 focus:ring-cyan/50"
              >
                {Object.entries(SLV2_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-[11px] font-medium text-txt-muted mb-1 block">Depth</label>
              <select
                value={depth}
                onChange={(e) => setDepth(e.target.value as SLv2Depth)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-txt-primary focus:outline-none focus:ring-1 focus:ring-cyan/50"
              >
                {Object.entries(SLV2_DEPTH_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <label className="flex min-w-[220px] items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-txt-secondary">
              <input
                type="checkbox"
                checked={includeDeepDiveResearch}
                onChange={(e) => setIncludeDeepDiveResearch(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border bg-surface text-cyan focus:ring-cyan/40"
              />
              Also run Deep Dive research
            </label>
            <button
              onClick={launch}
              disabled={launching || !query.trim()}
              className="rounded-lg bg-cyan/20 border border-cyan/30 px-5 py-2 text-sm font-medium text-cyan transition-all hover:bg-cyan/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {launching ? 'Launching…' : 'Launch Analysis'}
            </button>
          </div>
        </div>
      </Card>

      {/* Records list */}
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : records.length === 0 ? (
        <Card><p className="text-sm text-txt-faint py-4 text-center">No strategy lab v2 analyses yet</p></Card>
      ) : (
        <div className="space-y-3">
          {records.map((rec) => (
            <SLv2RecordCard
              key={rec.id}
              record={rec}
              expanded={expanded === rec.id}
              onToggle={() => setExpanded(expanded === rec.id ? null : rec.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SLv2RecordCard({ record, expanded, onToggle }: { record: SLv2Record; expanded: boolean; onToggle: () => void }) {
  const r = record;
  const isRunning = !['completed', 'failed'].includes(r.status);

  // Ensure JSONB fields are arrays (may arrive as {} from DB)
  const researchProgress = Array.isArray(r.research_progress) ? r.research_progress : [];
  const execProgress = Array.isArray(r.executive_progress) ? r.executive_progress : [];

  // Progress counts
  const researchDone = researchProgress.filter((p) => p.status === 'completed').length;
  const researchTotal = researchProgress.length;
  const execDone = execProgress.filter((p) => p.status === 'completed').length;
  const execTotal = execProgress.length;

  return (
    <Card>
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full shrink-0 ${slv2StatusColor(r.status)}`} />
              <span className="text-sm font-medium text-txt-primary line-clamp-1">{r.query}</span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-[11px] text-txt-muted">
              <span>{SLV2_TYPE_LABELS[r.analysis_type]}</span>
              <span>•</span>
              <span className="capitalize">{r.depth}</span>
              <span>•</span>
              <span>{timeAgo(r.created_at)}</span>
              {r.total_searches > 0 && (<><span>•</span><span>{r.total_searches} searches, {r.total_sources} sources</span></>)}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isRunning && (
              <span className="rounded-full border border-cyan/30 bg-cyan/10 px-2.5 py-0.5 text-[10px] font-medium text-cyan">
                {SLV2_STATUS_LABELS[r.status]}
              </span>
            )}
            <MdExpandMore className={`h-5 w-5 text-txt-faint transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="mt-4 space-y-5 border-t border-border pt-4">
          {/* Workflow Step Progress */}
          {r.workflow_id && isRunning && <WorkflowStepProgress workflowId={r.workflow_id} />}

          {/* Wave Progress */}
          <SLv2WaveProgress record={r} />

          {/* Synthesis */}
          {r.synthesis && <SLv2SynthesisView synthesis={r.synthesis} id={r.id} frameworkOutputs={r.framework_outputs} frameworkConvergence={r.framework_convergence} watchlist={r.watchlist} />}

          {/* Error */}
          {r.error && (
            <div className="rounded-lg border border-prism-critical/30 bg-prism-critical/10 px-3 py-2">
              <p className="text-sm text-prism-critical">{r.error}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function SLv2WaveProgress({ record }: { record: SLv2Record }) {
  const r = record;
  const statusOrder: SLv2Status[] = ['planning', 'framing', 'decomposing', 'researching', 'quality-check', 'analyzing', 'synthesizing', 'deepening', 'completed'];
  const currentIdx = statusOrder.indexOf(r.status);

  // Ensure JSONB fields are arrays (may arrive as {} from DB)
  const researchProgress = Array.isArray(r.research_progress) ? r.research_progress : [];
  const execProgress = Array.isArray(r.executive_progress) ? r.executive_progress : [];

  const waves = [
    { label: 'Frame', icon: <MdAutoAwesome className="h-4 w-4" />, active: r.status === 'framing', done: currentIdx > 1 },
    { label: 'Decompose', icon: <MdSearch className="h-4 w-4" />, active: r.status === 'decomposing', done: currentIdx > 2 },
    { label: 'Research', icon: <MdSearch className="h-4 w-4" />, active: r.status === 'researching', done: currentIdx > 3 },
    { label: 'QC', icon: <MdPerson className="h-4 w-4" />, active: r.status === 'quality-check', done: currentIdx > 4 },
    { label: 'Analysis', icon: <MdPerson className="h-4 w-4" />, active: r.status === 'analyzing', done: currentIdx > 5 },
    { label: 'Synthesis', icon: <MdAutoAwesome className="h-4 w-4" />, active: r.status === 'synthesizing' || r.status === 'deepening', done: r.status === 'completed' },
  ];

  return (
    <div className="space-y-4">
      {/* Wave indicator */}
      <div className="flex items-center gap-2 justify-center flex-wrap">
        {waves.map((w, i) => (
          <div key={w.label} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium ${
              w.active
                ? 'border-cyan/40 bg-cyan/15 text-cyan'
                : w.done || r.status === 'completed'
                  ? 'border-tier-green/30 bg-tier-green/10 text-tier-green'
                  : 'border-border bg-surface text-txt-faint'
            }`}>
              {w.icon}
              {w.label}
            </div>
            {i < waves.length - 1 && <MdArrowForward className="h-3 w-3 text-txt-faint" />}
          </div>
        ))}
      </div>

      {/* Sophia QC summary */}
      {r.overall_confidence && (
        <div className="rounded-lg border border-prism-elevated/20 bg-prism-elevated/5 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-prism-elevated">Sophia QC</span>
            <span className={`rounded-lg px-2 py-0.5 text-[10px] font-medium ${
              r.overall_confidence === 'high' ? 'text-white bg-gradient-to-r from-green-400 via-green-500 to-green-600' :
              r.overall_confidence === 'medium' ? 'text-white bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600' :
              'text-white bg-gradient-to-r from-red-400 via-red-500 to-red-600'
            }`}>{r.overall_confidence} confidence</span>
          </div>
          {r.gaps_filled?.length > 0 && (
            <p className="mt-1 text-[10px] text-txt-faint">Gaps filled: {r.gaps_filled.length}</p>
          )}
          {r.remaining_gaps?.length > 0 && (
            <p className="mt-0.5 text-[10px] text-prism-critical">Remaining gaps: {r.remaining_gaps.join(', ')}</p>
          )}
        </div>
      )}

      {/* Research analysts */}
      {researchProgress.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-txt-muted mb-2">Research Team</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {researchProgress.map((rp) => (
              <div key={rp.analystRole} className="rounded-lg border border-border bg-raised px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                    rp.status === 'completed' ? 'bg-tier-green' : rp.status === 'running' ? 'bg-cyan animate-pulse' : rp.status === 'failed' ? 'bg-prism-critical' : 'bg-txt-faint/30'
                  }`} />
                  <span className="text-[12px] font-medium text-txt-primary truncate">{rp.analystName}</span>
                </div>
                {(rp.searchCount || rp.sourceCount) && (
                  <p className="mt-0.5 text-[10px] text-txt-faint">{rp.searchCount ?? 0} searches · {rp.sourceCount ?? 0} pages</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Executive analysts */}
      {execProgress.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-txt-muted mb-2">Executive Analysis</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {execProgress.map((ep) => (
              <div key={ep.execRole} className="rounded-lg border border-border bg-raised px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                    ep.status === 'completed' ? 'bg-tier-green' : ep.status === 'running' ? 'bg-cyan animate-pulse' : ep.status === 'failed' ? 'bg-prism-critical' : 'bg-txt-faint/30'
                  }`} />
                  <span className="text-[12px] font-medium text-txt-primary truncate">{ep.execName}</span>
                </div>
                <p className="mt-0.5 text-[10px] text-txt-faint truncate">{ep.framework}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SLv2SynthesisView({ synthesis, id, frameworkOutputs, frameworkConvergence, watchlist }: { synthesis: SLv2Synthesis; id: string; frameworkOutputs?: Record<string, unknown>; frameworkConvergence?: string | null; watchlist?: WatchlistItem[] }) {
  const s = synthesis;
  const hasFrameworks = frameworkOutputs && Object.keys(frameworkOutputs).length > 0;
  const hasWatchlist = watchlist && watchlist.length > 0;
  const [showSection, setShowSection] = useState<'summary' | 'swot' | 'frameworks' | 'recs' | 'risks' | 'watchlist'>('summary');
  const [generatingVisual, setGeneratingVisual] = useState(false);
  const [visualImage, setVisualImage] = useState<{ data: string; mimeType: string } | null>(null);

  // Load saved visual on mount
  useEffect(() => {
    api<{ image: string; mimeType: string }>(`/strategy-lab/${id}/visual`)
      .then((resp) => setVisualImage({ data: resp.image, mimeType: resp.mimeType }))
      .catch(() => { /* no saved visual */ });
  }, [id]);

  async function generateVisual() {
    setGeneratingVisual(true);
    try {
      const resp = await api<{ image: string; mimeType: string }>(`/strategy-lab/${id}/visual`, { method: 'POST' });
      setVisualImage({ data: resp.image, mimeType: resp.mimeType });
    } catch (err) {
      console.error('Visual generation failed:', err);
    }
    setGeneratingVisual(false);
  }

  return (
    <div className="space-y-3">
      {/* Section tabs */}
      <div className="flex gap-1 rounded-lg bg-surface p-1 w-fit border border-border">
        {([
          ['summary', 'Summary'],
          ['swot', 'SWOT'],
          ...(hasFrameworks ? [['frameworks', 'Frameworks'] as const] : []),
          ['recs', 'Recommendations'],
          ['risks', 'Risks & Questions'],
          ...(hasWatchlist ? [['watchlist', 'Watchlist'] as const] : []),
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setShowSection(k)}
            className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors ${
              showSection === k ? 'bg-cyan/15 text-cyan' : 'text-txt-muted hover:text-txt-secondary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {showSection === 'summary' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-cyan/20 bg-cyan/5 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan mb-1.5">Executive Summary</p>
            <div className="text-sm text-txt-primary leading-relaxed prose-chat"><Markdown>{s.executiveSummary}</Markdown></div>
          </div>
          {s.crossFrameworkInsights.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-txt-muted mb-1.5">Cross-Framework Insights</p>
              <ul className="space-y-1">
                {s.crossFrameworkInsights.map((i, idx) => (
                  <li key={idx} className="text-[12px] text-txt-secondary leading-relaxed">• {i}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {showSection === 'swot' && (() => {
        const swotData = frameworkOutputs?.['framework-swot'] as Record<string, unknown> | undefined;
        const matrix = swotData?.interaction_matrix as Record<string, unknown[]> | undefined;
        const QUADRANTS = [
          { key: 'so_strategies', label: 'SO Strategies', subtitle: 'Strengths × Opportunities', color: 'text-tier-green', border: 'border-tier-green/20', bg: 'bg-tier-green/5', aLabel: 'Strength', bLabel: 'Opportunity', actionLabel: 'Strategy', actionKey: 'strategy', extraKey: 'expected_impact', extraLabel: 'Expected Impact' },
          { key: 'st_defenses', label: 'ST Defenses', subtitle: 'Strengths × Threats', color: 'text-cyan', border: 'border-cyan/20', bg: 'bg-cyan/5', aLabel: 'Strength', bLabel: 'Threat', actionLabel: 'Defense', actionKey: 'defense', extraKey: 'defensive_action', extraLabel: 'Action' },
          { key: 'wo_gaps', label: 'WO Gaps', subtitle: 'Weaknesses × Opportunities', color: 'text-prism-elevated', border: 'border-prism-elevated/20', bg: 'bg-prism-elevated/5', aLabel: 'Weakness', bLabel: 'Opportunity', actionLabel: 'Gap', actionKey: 'gap', extraKey: 'development_priority', extraLabel: 'Dev Priority' },
          { key: 'wt_vulnerabilities', label: 'WT Vulnerabilities', subtitle: 'Weaknesses × Threats', color: 'text-prism-critical', border: 'border-prism-critical/20', bg: 'bg-prism-critical/5', aLabel: 'Weakness', bLabel: 'Threat', actionLabel: 'Vulnerability', actionKey: 'vulnerability', extraKey: 'urgency', extraLabel: 'Urgency' },
        ] as const;
        const confidenceColor = (c: string) => c === 'high' ? 'text-tier-green' : c === 'medium' ? 'text-prism-elevated' : 'text-prism-critical';
        return (
          <div className="space-y-4">
            {/* Classic 2×2 SWOT grid */}
            <div className="grid grid-cols-2 gap-3">
              {(['strengths', 'weaknesses', 'opportunities', 'threats'] as const).map((cat) => {
                const colors = {
                  strengths: { border: 'border-tier-green/20', bg: 'bg-tier-green/5', label: 'text-tier-green' },
                  weaknesses: { border: 'border-prism-critical/20', bg: 'bg-prism-critical/5', label: 'text-prism-critical' },
                  opportunities: { border: 'border-cyan/20', bg: 'bg-cyan/5', label: 'text-cyan' },
                  threats: { border: 'border-prism-elevated/20', bg: 'bg-prism-elevated/5', label: 'text-prism-elevated' },
                };
                const c = colors[cat];
                return (
                  <div key={cat} className={`rounded-lg border ${c.border} ${c.bg} p-3`}>
                    <p className={`text-[10px] font-semibold uppercase tracking-wider ${c.label} mb-1.5`}>{cat}</p>
                    <ul className="space-y-1">
                      {s.unifiedSwot[cat].map((item, i) => (
                        <li key={i} className="text-[11px] text-txt-secondary leading-relaxed">• {item}</li>
                      ))}
                    </ul>
                    {s.unifiedSwot[cat].length === 0 && <p className="text-[11px] text-txt-faint">—</p>}
                  </div>
                );
              })}
            </div>

            {/* Interaction Matrix */}
            {matrix && (
              <div className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-txt-muted">Interaction Matrix</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {QUADRANTS.map((q) => {
                    const pairs = (matrix[q.key] ?? matrix[q.key.replace(/so_strategies/, 'strength_opportunity_pairs').replace(/wt_vulnerabilities/, 'weakness_threat_pairs').replace(/st_defenses/, 'strength_threat_pairs').replace(/wo_gaps/, 'weakness_opportunity_pairs')] ?? []) as Record<string, unknown>[];
                    if (pairs.length === 0) return null;
                    const sorted = [...pairs].sort((a, b) => ((b.priority_score as number) ?? 0) - ((a.priority_score as number) ?? 0));
                    return (
                      <div key={q.key} className={`rounded-lg border ${q.border} ${q.bg} p-3`}>
                        <div className="mb-2">
                          <p className={`text-[10px] font-semibold uppercase tracking-wider ${q.color}`}>{q.label}</p>
                          <p className="text-[9px] text-txt-faint">{q.subtitle}</p>
                        </div>
                        <div className="space-y-2">
                          {sorted.map((pair, i) => (
                            <div key={i} className="rounded-md bg-surface/60 border border-border/50 p-2">
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[9px] font-bold text-txt-muted bg-surface px-1.5 py-0.5 rounded">{pair.priority_score as number ?? '—'}</span>
                                  {pair.confidence ? <span className={`text-[9px] ${confidenceColor(pair.confidence as string)}`}>● {pair.confidence as string}</span> : null}
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-1 text-[10px] mb-1">
                                <div><span className="text-txt-faint">{q.aLabel}:</span> <span className="text-txt-secondary">{(pair[q.aLabel.toLowerCase()] ?? pair.item_a) as string}</span></div>
                                <div><span className="text-txt-faint">{q.bLabel}:</span> <span className="text-txt-secondary">{(pair[q.bLabel.toLowerCase()] ?? pair.item_b) as string}</span></div>
                              </div>
                              <p className="text-[10px] text-txt-primary leading-relaxed">{(pair[q.actionKey] ?? pair.interaction) as string}</p>
                              {pair[q.extraKey] ? (
                                <p className="text-[9px] text-txt-muted mt-1"><span className="font-medium">{q.extraLabel}:</span> {pair[q.extraKey] as string}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {showSection === 'frameworks' && hasFrameworks && (
        <div className="space-y-4">
          {frameworkConvergence && (
            <div className="rounded-lg border border-cyan/20 bg-cyan/5 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan mb-1.5">Framework Convergence</p>
              <div className="text-[12px] text-txt-primary leading-relaxed prose-chat"><Markdown>{frameworkConvergence}</Markdown></div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3">
            {Object.entries(frameworkOutputs!).map(([fId, data]) => {
              const meta = FRAMEWORK_NAMES[fId] ?? { label: fId, color: 'text-txt-secondary' };
              const d = data as Record<string, unknown> | undefined;
              if (!d) return null;
              return (
                <FrameworkCard
                  key={fId}
                  label={meta.label}
                  color={meta.color}
                  summary={typeof d.summary === 'string' ? d.summary : null}
                  keyInsight={typeof d.key_insight === 'string' ? d.key_insight : null}
                  data={d}
                />
              );
            })}
          </div>
        </div>
      )}

      {showSection === 'recs' && (
        <div className="space-y-3">
          {s.strategicRecommendations.map((rec, i) => (
            <div key={i} className="rounded-lg border border-border bg-raised px-4 py-3">
              <div className="flex items-start justify-between mb-1.5">
                <span className="text-sm font-medium text-txt-primary">{rec.title}</span>
                <div className="flex gap-1.5">
                  <span className={`rounded-lg px-2 py-0.5 text-[9px] font-medium ${
                    rec.impact === 'high' ? 'text-white bg-gradient-to-r from-green-400 via-green-500 to-green-600' : rec.impact === 'medium' ? 'text-white bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600' : 'text-white bg-gradient-to-r from-gray-400 via-gray-500 to-gray-600'
                  }`}>
                    Impact: {rec.impact}
                  </span>
                  <span className={`rounded-lg px-2 py-0.5 text-[9px] font-medium ${
                    rec.feasibility === 'high' ? 'text-white bg-gradient-to-r from-green-400 via-green-500 to-green-600' : rec.feasibility === 'medium' ? 'text-white bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600' : 'text-white bg-gradient-to-r from-gray-400 via-gray-500 to-gray-600'
                  }`}>
                    Feasibility: {rec.feasibility}
                  </span>
                </div>
              </div>
              <p className="text-[12px] text-txt-muted leading-relaxed mb-2">{rec.description}</p>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div><span className="text-txt-faint">Owner:</span> <span className="text-txt-secondary">{rec.owner}</span></div>
                <div><span className="text-txt-faint">Expected:</span> <span className="text-txt-secondary">{rec.expectedOutcome}</span></div>
              </div>
              <p className="mt-1.5 text-[11px] text-prism-critical/80">⚠ {rec.riskIfNot}</p>
            </div>
          ))}
          {s.strategicRecommendations.length === 0 && <p className="text-sm text-txt-faint">No recommendations generated</p>}
        </div>
      )}

      {showSection === 'risks' && (
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-txt-muted mb-2">Key Risks</p>
            <ul className="space-y-1">
              {s.keyRisks.map((risk, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] text-txt-secondary leading-relaxed">
                  <MdFlag className="h-3.5 w-3.5 text-prism-elevated shrink-0 mt-0.5" />
                  {risk}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-txt-muted mb-2">Open Questions for Founders</p>
            <ul className="space-y-1">
              {s.openQuestionsForFounders.map((q, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] text-txt-secondary leading-relaxed">
                  <MdChevronRight className="h-3.5 w-3.5 text-cyan shrink-0 mt-0.5" />
                  {q}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {showSection === 'watchlist' && hasWatchlist && (
        <DDWatchlist items={watchlist} />
      )}

      {/* Export Action Bar */}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <ExportButton label="Word (.docx)" href={`${SCHEDULER_URL}/strategy-lab/${id}/export?format=docx`} />
        <ExportButton label="PowerPoint" href={`${SCHEDULER_URL}/strategy-lab/${id}/export?format=pptx`} />
        <ExportButton label="Markdown" href={`${SCHEDULER_URL}/strategy-lab/${id}/export?format=markdown`} />
        <ExportButton label="JSON" href={`${SCHEDULER_URL}/strategy-lab/${id}/export?format=json`} />
        <span className="mx-1 h-5 w-px bg-border" />
        <button
          onClick={generateVisual}
          disabled={generatingVisual}
          className="rounded-lg bg-cyan/15 border border-cyan/30 px-3 py-1.5 text-[12px] font-medium text-cyan transition-colors hover:bg-cyan/25 disabled:opacity-40"
        >
          {generatingVisual ? 'Generating…' : <><MdPalette className="inline h-4 w-4 mr-1 -mt-0.5" />AI Visual</>}
        </button>
      </div>

      {/* AI Visual (if generated) */}
      {visualImage && (
        <div className="rounded-xl border border-cyan/20 bg-raised p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan">AI-Generated Infographic</p>
            <button
              onClick={() => {
                const byteChars = atob(visualImage.data);
                const byteArray = new Uint8Array(byteChars.length);
                for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
                const blob = new Blob([byteArray], { type: visualImage.mimeType });
                const u = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const ext = visualImage.mimeType.split('/')[1] || 'png';
                a.href = u; a.download = `strategy-${id}-visual.${ext}`; a.click();
                URL.revokeObjectURL(u);
              }}
              className="text-xs text-cyan hover:underline font-medium"
            >
              Download Image
            </button>
          </div>
          <img
            src={`data:${visualImage.mimeType};base64,${visualImage.data}`}
            alt="AI-generated strategic analysis infographic"
            className="w-full rounded-lg"
          />
        </div>
      )}
    </div>
  );
}
