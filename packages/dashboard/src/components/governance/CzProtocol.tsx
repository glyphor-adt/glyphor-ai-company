import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, SectionHeader, Skeleton, Badge, GradientButton, Sparkline } from '../ui';
import { apiCall, buildApiHeaders, CANONICAL_SCHEDULER_URL } from '../../lib/firebase';

/* ══════════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════════ */

interface CzTask {
  id: string;
  task_number: number;
  pillar: string;
  sub_category: string | null;
  task: string;
  acceptance_criteria: string;
  verification_method: string | null;
  responsible_agent: string | null;
  is_p0: boolean;
  created_by: string;
  created_at: string;
  latest_pass: boolean | null;
  latest_score: number | null;
  latest_judge_tier: string | null;
  latest_run_at: string | null;
}

interface CzPillar {
  pillar: string;
  display_order: number;
  pass_rate_threshold: number;
  avg_score_threshold: number;
  pillar_is_p0: boolean;
  total_tasks: number;
  passed: number;
  avg_score: number | null;
  pass_rate: number | null;
  surfaces?: Record<string, { pass_rate: number; avg_score: number; passed: number; total: number }>;
}

interface CzGate {
  gate: string;
  display_order: number;
  description: string;
  met: boolean;
  current_p0_pass: boolean;
  current_overall_pass_rate: number;
  current_avg_score: number;
}

interface CzRun {
  batch_id: string;
  trigger_type: string;
  triggered_by: string | null;
  surface: string;
  batch_status: string;
  task_count: number;
  passed_count: number;
  failed_count: number;
  scored: number;
  pending: number;
  avg_judge_score: number | null;
  started_at: string;
  completed_at: string | null;
}

interface CzDriftPoint {
  batch_id: string;
  completed_at: string;
  surface: string;
  pillar: string;
  total: number;
  passed: number;
  avg_score: number;
  pass_rate: number;
}

interface SseEvent {
  timestamp: string;
  event: string;
  data: Record<string, unknown>;
}

/* ══════════════════════════════════════════════════════════════
   Helpers
   ══════════════════════════════════════════════════════════════ */

const PILLARS_SHORT: Record<string, string> = {
  'Combating AI Slop': 'AI Slop',
  'Eliminating Context Amnesia': 'Context Amnesia',
  'Memory Persistence': 'Memory',
  'Multi-Agent Orchestration Fidelity': 'Orchestration',
  'Governing Shadow AI': 'Shadow AI',
  'Agentic Security': 'Security',
  'Legal Liability': 'Legal',
  'Data Sovereignty': 'Data Sov.',
  'Defending Against Misuse': 'Misuse Defense',
  'Chat Surface Fidelity': 'Surface',
};

function shortPillar(p: string): string {
  return PILLARS_SHORT[p] ?? p;
}

function scoreColor(score: number | null): string {
  if (score == null) return 'text-zinc-500';
  if (score >= 8) return 'text-emerald-400';
  if (score >= 6) return 'text-amber-400';
  return 'text-rose-400';
}

function passRateColor(rate: number | null): string {
  if (rate == null) return 'text-zinc-500';
  if (rate >= 0.9) return 'text-emerald-400';
  if (rate >= 0.7) return 'text-amber-400';
  return 'text-rose-400';
}

function gateLabel(gate: string): string {
  return gate.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Compact absolute timestamp, e.g. "Apr 20, 4:32p". Use for table cells and task detail rows. */
function formatStamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const m = d.toLocaleString(undefined, { month: 'short', day: 'numeric' });
  const t = d.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
  return `${m} · ${t}`;
}

/** Full ISO-ish timestamp for tooltips, e.g. "2026-04-20 16:32:45". */
function formatStampFull(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
}


/* ══════════════════════════════════════════════════════════════
   Panel 1: Scorecard
   ══════════════════════════════════════════════════════════════ */

function Scorecard() {
  const [pillars, setPillars] = useState<CzPillar[]>([]);
  const [gates, setGates] = useState<CzGate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [surface, setSurface] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const qs = surface ? `?surface=${surface}` : '';
        const data = await apiCall<{ pillars: CzPillar[]; gates: CzGate[] }>(`/api/cz/scorecard${qs}`);
        if (!cancelled) {
          setPillars(data.pillars);
          setGates(data.gates);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [surface]);

  if (loading) return <Card><Skeleton className="h-48" /></Card>;
  if (error) return <Card><p className="text-rose-400 text-sm">{error}</p></Card>;

  const hasPillarData = pillars.length > 0;

  return (
    <Card>
      <SectionHeader title="Scorecard" subtitle="Latest completed run" />

      {/* Surface Toggle */}
      <div className="flex items-center gap-2 mt-2">
        {[null, 'direct', 'teams', 'slack'].map((s) => (
          <button
            key={s ?? 'all'}
            className={`text-xs px-2 py-1 rounded ${surface === s ? 'bg-cyan/20 text-cyan' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
            onClick={() => setSurface(s)}
          >
            {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
          </button>
        ))}
      </div>

      {!hasPillarData && (
        <div className="mt-4 rounded-lg border border-dashed border-zinc-700/40 bg-zinc-900/30 p-8 text-center">
          <p className="text-zinc-400 text-sm font-medium">No completed runs yet</p>
          <p className="text-zinc-600 text-xs mt-1">Execute a test run to populate pillar scores and pass rates</p>
        </div>
      )}

      {hasPillarData && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
          {pillars.map((p) => {
            const rate = Number(p.pass_rate ?? 0);
            const score = Number(p.avg_score ?? 0);
            const meetsRate = rate >= Number(p.pass_rate_threshold);
            const meetsScore = score >= Number(p.avg_score_threshold);
            return (
              <div
                key={p.pillar}
                className={`rounded-lg border p-3 ${
                  p.pillar_is_p0
                    ? 'border-rose-700/40 bg-rose-950/20'
                    : 'border-zinc-700/40 bg-zinc-800/30'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[11px] font-medium text-zinc-300 truncate">{shortPillar(p.pillar)}</span>
                  {p.pillar_is_p0 && <Badge color="red">P0</Badge>}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className={`text-xl font-bold tabular-nums ${passRateColor(rate)}`}>
                    {(rate * 100).toFixed(0)}%
                  </span>
                  <span className={`text-xs tabular-nums ${scoreColor(score)}`}>
                    avg {score.toFixed(1)}
                  </span>
                </div>
                <div className="text-[10px] mt-1 text-zinc-500">
                  {p.passed}/{p.total_tasks} passed
                  {!meetsRate && <span className="text-rose-400 ml-2">below {(Number(p.pass_rate_threshold) * 100).toFixed(0)}%</span>}
                  {!meetsScore && <span className="text-amber-400 ml-2">avg &lt; {Number(p.avg_score_threshold).toFixed(1)}</span>}
                </div>
                <div className="w-full h-1 rounded-full bg-zinc-700/40 mt-2">
                  <div
                    className={`h-full rounded-full transition-all ${
                      rate >= Number(p.pass_rate_threshold) ? 'bg-emerald-500' : rate >= 0.5 ? 'bg-amber-500' : 'bg-rose-500'
                    }`}
                    style={{ width: `${Math.max(rate * 100, 2)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Launch Gates */}
      <div className="mt-6">
        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Launch Gates</h4>
        <div className="flex gap-3">
          {gates.map((g) => (
            <div
              key={g.gate}
              className={`flex-1 rounded-lg border p-3 ${
                g.met ? 'border-emerald-700/40 bg-emerald-950/20' : 'border-zinc-700/40 bg-zinc-800/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-lg ${g.met ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  {g.met ? '✓' : '○'}
                </span>
                <span className="text-xs font-medium text-zinc-300">{gateLabel(g.gate)}</span>
              </div>
              <p className="text-[10px] text-zinc-500 mt-1">{g.description}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════
   Panel 2: Task Grid
   ══════════════════════════════════════════════════════════════ */

function TaskGrid() {
  const [tasks, setTasks] = useState<CzTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterPillar, setFilterPillar] = useState<string | null>(null);
  const [filterP0, setFilterP0] = useState(false);
  // Last-run date filter: quick presets + optional explicit date range.
  // Presets are mutually exclusive with a custom range.
  type RunDatePreset = 'all' | 'today' | '7d' | '30d' | 'never' | 'custom';
  const [runDatePreset, setRunDatePreset] = useState<RunDatePreset>('all');
  const [runDateFrom, setRunDateFrom] = useState<string>(''); // yyyy-mm-dd (local)
  const [runDateTo, setRunDateTo] = useState<string>('');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<{ scores: Array<{ passed: boolean; judge_score: number; judge_tier: string; reasoning_trace: string | null; agent_output: string | null; axis_scores: Record<string, number> | null; heuristic_failures: string[] | null; mode: string; started_at: string | null }> } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const qs = new URLSearchParams();
      if (filterPillar) qs.set('pillar', filterPillar);
      if (filterP0) qs.set('p0', 'true');
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const data = await apiCall<{ tasks: CzTask[] }>(`/api/cz/tasks${suffix}`);
      setTasks(data.tasks);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filterPillar, filterP0]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const pillarList = useMemo(() => {
    const unique = [...new Set(tasks.map((t) => t.pillar))];
    return unique.sort();
  }, [tasks]);

  // Apply the Last-Run date filter client-side. Presets compute a sliding
  // window based on task.latest_run_at; 'never' keeps only tasks that have
  // not run; 'custom' uses the explicit from/to date inputs (inclusive days
  // in the user's local timezone).
  const filteredTasks = useMemo(() => {
    const now = Date.now();
    const dayMs = 86_400_000;
    return tasks.filter((t) => {
      if (runDatePreset === 'all') return true;
      const raw = t.latest_run_at;
      if (runDatePreset === 'never') return raw == null;
      if (raw == null) return false;
      const ts = new Date(raw).getTime();
      if (isNaN(ts)) return false;
      if (runDatePreset === 'today') {
        const start = new Date(); start.setHours(0, 0, 0, 0);
        return ts >= start.getTime();
      }
      if (runDatePreset === '7d') return now - ts <= 7 * dayMs;
      if (runDatePreset === '30d') return now - ts <= 30 * dayMs;
      if (runDatePreset === 'custom') {
        if (runDateFrom) {
          const from = new Date(runDateFrom); from.setHours(0, 0, 0, 0);
          if (ts < from.getTime()) return false;
        }
        if (runDateTo) {
          const to = new Date(runDateTo); to.setHours(23, 59, 59, 999);
          if (ts > to.getTime()) return false;
        }
        return true;
      }
      return true;
    });
  }, [tasks, runDatePreset, runDateFrom, runDateTo]);

  return (
    <Card>
      <SectionHeader
        title="Task Grid"
        subtitle={
          filteredTasks.length === tasks.length
            ? `${tasks.length} tasks`
            : `${filteredTasks.length} of ${tasks.length} tasks`
        }
      />

      {/* Pillar + P0 filters */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button
          className={`text-xs px-2 py-1 rounded ${!filterPillar ? 'bg-cyan/20 text-cyan' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
          onClick={() => setFilterPillar(null)}
        >
          All Pillars
        </button>
        {pillarList.map((p) => (
          <button
            key={p}
            className={`text-xs px-2 py-1 rounded ${filterPillar === p ? 'bg-cyan/20 text-cyan' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
            onClick={() => setFilterPillar(p === filterPillar ? null : p)}
          >
            {shortPillar(p)}
          </button>
        ))}
        <button
          className={`text-xs px-2 py-1 rounded ml-2 ${filterP0 ? 'bg-rose-900/40 text-rose-300' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
          onClick={() => setFilterP0(!filterP0)}
        >
          P0 Only
        </button>
      </div>

      {/* Last-Run date filter */}
      <div className="flex items-center gap-2 mt-2 flex-wrap text-xs">
        <span className="text-zinc-500">Last run:</span>
        {([
          ['all', 'All'],
          ['today', 'Today'],
          ['7d', 'Last 7d'],
          ['30d', 'Last 30d'],
          ['never', 'Never run'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            className={`px-2 py-1 rounded ${runDatePreset === key ? 'bg-cyan/20 text-cyan' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
            onClick={() => {
              setRunDatePreset(key);
              setRunDateFrom('');
              setRunDateTo('');
            }}
          >
            {label}
          </button>
        ))}
        <span className="ml-1 flex items-center gap-1">
          <span className="text-zinc-600">from</span>
          <input
            type="date"
            value={runDateFrom}
            onChange={(e) => { setRunDateFrom(e.target.value); setRunDatePreset('custom'); }}
            className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-200 [color-scheme:dark]"
          />
          <span className="text-zinc-600">to</span>
          <input
            type="date"
            value={runDateTo}
            onChange={(e) => { setRunDateTo(e.target.value); setRunDatePreset('custom'); }}
            className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-200 [color-scheme:dark]"
          />
          {(runDateFrom || runDateTo || runDatePreset !== 'all') && (
            <button
              className="ml-1 text-zinc-500 hover:text-zinc-300"
              onClick={() => { setRunDatePreset('all'); setRunDateFrom(''); setRunDateTo(''); }}
              title="Clear date filter"
            >
              ✕ clear
            </button>
          )}
        </span>
      </div>

      {loading && <Skeleton className="h-40 mt-3" />}
      {error && <p className="text-rose-400 text-sm mt-3">{error}</p>}

      {!loading && !error && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 text-left border-b border-zinc-700/40">
                <th className="py-2 pr-2 w-8">#</th>
                <th className="py-2 pr-3">Task</th>
                <th className="py-2 pr-3 w-24">Pillar</th>
                <th className="py-2 pr-2 w-14">Agent</th>
                <th className="py-2 pr-2 w-10 text-center">P0</th>
                <th className="py-2 pr-2 w-14 text-right">Score</th>
                <th className="py-2 pr-2 w-12 text-center">Pass</th>
                <th className="py-2 w-28">Last Run</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((t) => (
                <Fragment key={t.id}>
                  <tr
                    className="border-b border-zinc-800/40 hover:bg-zinc-800/30 cursor-pointer"
                    onClick={() => {
                      if (expandedTask === t.id) {
                        setExpandedTask(null);
                        setTaskDetail(null);
                      } else {
                        setExpandedTask(t.id);
                        setTaskDetail(null);
                        setDetailLoading(true);
                        apiCall<{ task: unknown; scores: Array<{ passed: boolean; judge_score: number; judge_tier: string; reasoning_trace: string | null; agent_output: string | null; axis_scores: Record<string, number> | null; heuristic_failures: string[] | null; mode: string; started_at: string | null }> }>(`/api/cz/tasks/${t.id}`)
                          .then((d) => setTaskDetail({ scores: d.scores }))
                          .catch(() => setTaskDetail({ scores: [] }))
                          .finally(() => setDetailLoading(false));
                      }
                    }}
                  >
                    <td className="py-2 pr-2 text-zinc-500 tabular-nums">{t.task_number}</td>
                    <td className="py-2 pr-3 text-zinc-200 max-w-[300px] truncate">{t.task}</td>
                    <td className="py-2 pr-3 text-zinc-400">{shortPillar(t.pillar)}</td>
                    <td className="py-2 pr-2 text-zinc-400">{t.responsible_agent ?? '—'}</td>
                    <td className="py-2 pr-2 text-center">
                      {t.is_p0 && <span className="text-rose-400 font-bold">●</span>}
                    </td>
                    <td className={`py-2 pr-2 text-right tabular-nums ${scoreColor(t.latest_score)}`}>
                      {t.latest_score != null ? Number(t.latest_score).toFixed(1) : '—'}
                    </td>
                    <td className="py-2 pr-2 text-center">
                      {t.latest_pass == null ? (
                        <span className="text-zinc-600">—</span>
                      ) : t.latest_pass ? (
                        <span className="text-emerald-400">✓</span>
                      ) : (
                        <span className="text-rose-400">✗</span>
                      )}
                    </td>
                    <td
                      className="py-2 text-zinc-400 tabular-nums whitespace-nowrap"
                      title={formatStampFull(t.latest_run_at)}
                    >
                      {t.latest_run_at ? (
                        <span>
                          {formatStamp(t.latest_run_at)}
                          <span className="text-zinc-600 ml-1">({timeAgo(t.latest_run_at)})</span>
                        </span>
                      ) : (
                        <span className="text-zinc-600">never</span>
                      )}
                    </td>
                  </tr>
                  {expandedTask === t.id && (
                    <tr key={`${t.id}-detail`} className="bg-zinc-900/50">
                      <td colSpan={8} className="p-3">
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <p className="text-zinc-500 mb-1">Acceptance Criteria</p>
                            <p className="text-zinc-300">{t.acceptance_criteria}</p>
                          </div>
                          <div>
                            <p className="text-zinc-500 mb-1">Verification Method</p>
                            <p className="text-zinc-300">{t.verification_method ?? '—'}</p>
                          </div>
                          <div>
                            <p className="text-zinc-500 mb-1">Sub-category</p>
                            <p className="text-zinc-300">{t.sub_category ?? '—'}</p>
                          </div>
                          <div>
                            <p className="text-zinc-500 mb-1">Last Run</p>
                            <p className="text-zinc-300" title={formatStampFull(t.latest_run_at)}>
                              {t.latest_run_at ? (
                                <>
                                  {formatStamp(t.latest_run_at)}
                                  <span className="text-zinc-500 ml-2">({timeAgo(t.latest_run_at)})</span>
                                </>
                              ) : 'Never'}
                              {t.latest_judge_tier && (
                                <span className="text-zinc-500 ml-2">tier: {t.latest_judge_tier}</span>
                              )}
                            </p>
                          </div>
                        </div>
                        {/* Latest score detail */}
                        {detailLoading && <Skeleton className="h-24 mt-3" />}
                        {!detailLoading && taskDetail && taskDetail.scores.length > 0 && (() => {
                          const s = taskDetail.scores[0];
                          return (
                            <div className="mt-4 space-y-3 border-t border-zinc-800/40 pt-3">
                              <div className="flex items-center gap-4 text-xs">
                                <span className="text-zinc-500">Score: <span className={scoreColor(s.judge_score)}>{s.judge_score?.toFixed(1)}</span></span>
                                <span className="text-zinc-500">Tier: <span className="text-zinc-300">{s.judge_tier}</span></span>
                                <span className={s.passed ? 'text-emerald-400' : 'text-rose-400'}>{s.passed ? 'PASS' : 'FAIL'}</span>
                                {s.axis_scores && Object.keys(s.axis_scores).length > 0 && (
                                  <span className="text-zinc-600">
                                    {Object.entries(s.axis_scores).map(([k, v]) => `${k}: ${(v * 10).toFixed(0)}`).join(' · ')}
                                  </span>
                                )}
                              </div>
                              {s.reasoning_trace && (
                                <div>
                                  <p className="text-zinc-500 text-[11px] font-medium mb-1">Judge Reasoning</p>
                                  <p className="text-zinc-400 text-xs">{s.reasoning_trace}</p>
                                </div>
                              )}
                              {s.heuristic_failures && s.heuristic_failures.length > 0 && (
                                <div>
                                  <p className="text-zinc-500 text-[11px] font-medium mb-1">Heuristic Failures</p>
                                  <p className="text-rose-400/80 text-xs">{s.heuristic_failures.join('; ')}</p>
                                </div>
                              )}
                              {s.agent_output && (
                                <div>
                                  <p className="text-zinc-500 text-[11px] font-medium mb-1">Agent Output</p>
                                  <pre className="text-zinc-300 text-xs whitespace-pre-wrap break-words max-h-80 overflow-y-auto border border-zinc-700/40 rounded-lg p-3 bg-zinc-950/60 leading-relaxed">
                                    {s.agent_output}
                                  </pre>
                                </div>
                              )}
                              {!s.agent_output && s.judge_tier === 'heuristic' && (
                                <p className="text-zinc-600 text-xs italic">No agent output — test used heuristic scoring only (no LLM was invoked).</p>
                              )}
                            </div>
                          );
                        })()}
                        {!detailLoading && taskDetail && taskDetail.scores.length === 0 && (
                          <p className="text-zinc-600 text-xs mt-3 italic">No scores recorded for this task yet.</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {filteredTasks.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-zinc-500 text-xs">
                    No tasks match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════
   Panel 3: Live Run Console
   ══════════════════════════════════════════════════════════════ */

interface BatchDetailRun {
  run_id?: string;
  id?: string;
  task_number: number;
  pillar: string;
  task: string;
  responsible_agent?: string;
  is_p0: boolean;
  status: string;
  passed: boolean | null;
  judge_score: number | null;
  judge_tier: string | null;
  reasoning_trace: string | null;
  axis_scores: Record<string, number> | null;
  agent_output?: string | null;
  latency_ms?: number | null;
  heuristic_failures?: string[] | null;
}

function LiveRunConsole() {
  const [runs, setRuns] = useState<CzRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sseEvents, setSseEvents] = useState<SseEvent[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [launchMode, setLaunchMode] = useState<string>('full');
  const [launchSurface, setLaunchSurface] = useState<string>('direct');
  const [launchPillar, setLaunchPillar] = useState<string>('');
  const [launchAgent, setLaunchAgent] = useState<string>('');
  const [launchTaskId, setLaunchTaskId] = useState<string>('');
  const [tasks, setTasks] = useState<{ id: string; task_number: number; task: string; pillar: string; responsible_agent: string | null }[]>([]);
  const [launching, setLaunching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const [batchDetail, setBatchDetail] = useState<{ batch_id: string; runs: BatchDetailRun[] } | null>(null);
  const [batchDetailLoading, setBatchDetailLoading] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  // Fetch tasks for pillar/agent/task selectors
  useEffect(() => {
    (async () => {
      try {
        const data = await apiCall<{ tasks: { id: string; task_number: number; task: string; pillar: string; responsible_agent: string | null }[] }>('/api/cz/tasks');
        setTasks(data.tasks);
      } catch { /* ignore — selectors will just be empty */ }
    })();
  }, []);

  // Fetch recent runs
  const fetchRuns = useCallback(async () => {
    try {
      const data = await apiCall<{ runs: CzRun[] }>('/api/cz/runs?limit=10');
      setRuns(data.runs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  // SSE stream for active run — uses fetch() so we can send Authorization headers
  // (native EventSource cannot send custom headers → 401 on the scheduler)
  useEffect(() => {
    if (!activeRunId) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const addEvent = (event: string, data: Record<string, unknown>) => {
      setSseEvents((prev) => [...prev, { timestamp: new Date().toISOString(), event, data }]);
      if (consoleRef.current) {
        consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
      }
    };

    (async () => {
      try {
        const headers = await buildApiHeaders();
        const resp = await fetch(
          `${CANONICAL_SCHEDULER_URL}/api/cz/runs/${activeRunId}/stream`,
          { headers, signal: ctrl.signal },
        );
        if (!resp.ok || !resp.body) {
          addEvent('error', { message: `SSE stream failed: ${resp.status}` });
          return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE frames (event: ... \n data: ... \n\n)
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            if (!frame.trim()) continue;
            let eventName = 'message';
            let eventData = '';
            for (const line of frame.split('\n')) {
              if (line.startsWith('event: ')) eventName = line.slice(7);
              else if (line.startsWith('data: ')) eventData = line.slice(6);
            }
            if (!eventData) continue;
            try {
              const parsed = JSON.parse(eventData);
              addEvent(eventName, parsed);
              if (eventName === 'run_complete') {
                ctrl.abort();
                fetchRuns();
                return;
              }
            } catch { /* ignore malformed frames */ }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          addEvent('error', { message: 'SSE connection lost' });
        }
      }
    })();

    return () => { ctrl.abort(); };
  }, [activeRunId, fetchRuns]);

  // Derived lists for selectors
  const pillarList = useMemo(() => [...new Set(tasks.map((t) => t.pillar))].sort(), [tasks]);
  const agentList = useMemo(() => [...new Set(tasks.map((t) => t.responsible_agent).filter(Boolean) as string[])].sort(), [tasks]);

  // Launch a new run
  const launchRun = async () => {
    setLaunching(true);
    setError(null);
    try {
      const body: Record<string, string> = { mode: launchMode, surface: launchSurface };
      if (launchMode === 'pillar') {
        if (!launchPillar) { setError('Select a pillar first'); setLaunching(false); return; }
        body.pillar = launchPillar;
      } else if (launchMode === 'canary') {
        if (!launchAgent) { setError('Select an agent first'); setLaunching(false); return; }
        body.agent = launchAgent;
      } else if (launchMode === 'single') {
        if (!launchTaskId) { setError('Select a task first'); setLaunching(false); return; }
        body.task_id = launchTaskId;
      }
      const data = await apiCall<{ batch_id: string }>('/api/cz/runs', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setSseEvents([]);
      setActiveRunId(data.batch_id);
      await fetchRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLaunching(false);
    }
  };

  return (
    <Card>
      <SectionHeader title="Run Console" subtitle="Execute and monitor certification test runs" />

      {/* Launch Controls */}
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <select
          className="bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700"
          value={launchMode}
          onChange={(e) => setLaunchMode(e.target.value)}
        >
          <option value="full">Full (89 tasks)</option>
          <option value="critical">Critical (P0 only)</option>
          <option value="pillar">By Pillar</option>
          <option value="canary">Canary (by agent)</option>
          <option value="single">Single Task</option>
        </select>

        {launchMode === 'pillar' && (
          <select
            className="bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700"
            value={launchPillar}
            onChange={(e) => setLaunchPillar(e.target.value)}
          >
            <option value="">— select pillar —</option>
            {pillarList.map((p) => <option key={p} value={p}>{shortPillar(p)}</option>)}
          </select>
        )}

        {launchMode === 'canary' && (
          <select
            className="bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700"
            value={launchAgent}
            onChange={(e) => setLaunchAgent(e.target.value)}
          >
            <option value="">— select agent —</option>
            {agentList.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}

        {launchMode === 'single' && (
          <select
            className="bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700 max-w-[200px]"
            value={launchTaskId}
            onChange={(e) => setLaunchTaskId(e.target.value)}
          >
            <option value="">— select task —</option>
            {tasks.map((t) => <option key={t.id} value={t.id}>#{t.task_number} {t.task.slice(0, 40)}</option>)}
          </select>
        )}

        <select
          className="bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700"
          value={launchSurface}
          onChange={(e) => setLaunchSurface(e.target.value)}
        >
          <option value="direct">Direct</option>
          <option value="teams">Teams</option>
          <option value="slack">Slack</option>
        </select>
        <GradientButton onClick={launchRun} disabled={launching}>
          {launching ? 'Launching...' : 'Run Now'}
        </GradientButton>
      </div>

      {/* Console Output */}
      {sseEvents.length === 0 && !activeRunId && (
        <div className="mt-3 rounded-lg border border-dashed border-zinc-700/40 bg-zinc-950/30 p-8 flex items-center justify-center">
          <p className="text-zinc-600 text-xs">Click <span className="text-zinc-400 font-medium">Run Now</span> to execute tests — live output will stream here</p>
        </div>
      )}
      {sseEvents.length > 0 && (
        <div
          ref={consoleRef}
          className="mt-3 bg-zinc-950 rounded-lg border border-zinc-800 p-3 max-h-80 overflow-y-auto font-mono text-[11px]"
        >
          {sseEvents.map((evt, i) => {
            const ts = new Date(evt.timestamp).toLocaleTimeString();
            if (evt.event === 'task_started') {
              return (
                <div key={i} className="text-zinc-400 leading-relaxed">
                  <span className="text-zinc-600">{ts}</span>{' '}
                  <span className="text-blue-400">▶</span>{' '}
                  <span className="text-zinc-500">#{(evt.data as { task_number?: number }).task_number}</span>{' '}
                  <span className="text-zinc-300">{(evt.data as { task?: string }).task ?? ''}</span>{' '}
                  <span className="text-zinc-600">({shortPillar((evt.data as { pillar?: string }).pillar ?? '')})</span>
                </div>
              );
            }
            if (evt.event === 'task_scored') {
              const d = evt.data as { task_number?: number; task?: string; pass?: boolean; judge_score?: number; reasoning_trace?: string; heuristic_failures?: string[]; latency_ms?: number; pillar?: string; judge_tier?: string; responsible_agent?: string; agent_output_preview?: string; axis_scores?: Record<string, number> };
              return (
                <div key={i} className="leading-relaxed mb-1">
                  <div className={d.pass ? 'text-emerald-400' : 'text-rose-400'}>
                    <span className="text-zinc-600">{ts}</span>{' '}
                    <span>{d.pass ? '✓' : '✗'}</span>{' '}
                    <span className="text-zinc-500">#{d.task_number}</span>{' '}
                    <span className={d.pass ? 'text-emerald-300' : 'text-rose-300'}>{d.task ?? ''}</span>{' '}
                    <span className={scoreColor(d.judge_score ?? null)}>
                      {d.judge_score?.toFixed(1)}
                    </span>
                    {d.judge_tier && <span className="text-zinc-600 ml-1">[{d.judge_tier}]</span>}
                    {d.latency_ms != null && <span className="text-zinc-600 ml-1">{(d.latency_ms / 1000).toFixed(1)}s</span>}
                  </div>
                  {d.reasoning_trace && (
                    <div className="text-zinc-500 ml-6 text-[10px]">{d.reasoning_trace}</div>
                  )}
                  {d.agent_output_preview && (
                    <div className="text-zinc-600 ml-6 text-[10px] mt-0.5 border-l border-zinc-800 pl-2 max-h-16 overflow-hidden">
                      {d.agent_output_preview}
                    </div>
                  )}
                  {d.axis_scores && Object.keys(d.axis_scores).length > 0 && (
                    <div className="text-zinc-600 ml-6 text-[10px] mt-0.5 flex gap-3">
                      {Object.entries(d.axis_scores).map(([k, v]) => (
                        <span key={k} className={v >= 0.7 ? 'text-emerald-600' : v >= 0.5 ? 'text-amber-600' : 'text-rose-600'}>
                          {k}: {(v * 10).toFixed(0)}
                        </span>
                      ))}
                    </div>
                  )}
                  {d.heuristic_failures && d.heuristic_failures.length > 0 && (
                    <div className="text-rose-500/70 ml-6 text-[10px]">
                      failures: {d.heuristic_failures.join('; ')}
                    </div>
                  )}
                </div>
              );
            }
            if (evt.event === 'agent_invoked') {
              const d = evt.data as { task_number?: number; agent?: string };
              return (
                <div key={i} className="text-indigo-400/70 leading-relaxed text-[10px] ml-6">
                  <span className="text-zinc-600">{ts}</span>{' '}
                  ⚡ invoking <span className="text-indigo-300">{d.agent}</span> for #{d.task_number}…
                </div>
              );
            }
            if (evt.event === 'agent_responded') {
              const d = evt.data as { task_number?: number; agent?: string; status?: string; output_length?: number; elapsed_ms?: number; model?: string; cost?: number };
              return (
                <div key={i} className="text-indigo-400/70 leading-relaxed text-[10px] ml-6">
                  <span className="text-zinc-600">{ts}</span>{' '}
                  ← <span className="text-indigo-300">{d.agent}</span>{' '}
                  <span className={d.status === 'completed' ? 'text-emerald-600' : 'text-rose-600'}>{d.status}</span>{' '}
                  {d.output_length != null && <span className="text-zinc-600">{d.output_length} chars</span>}{' '}
                  {d.elapsed_ms != null && <span className="text-zinc-600">{(d.elapsed_ms / 1000).toFixed(1)}s</span>}{' '}
                  {d.model && <span className="text-zinc-700">{d.model}</span>}
                </div>
              );
            }
            if (evt.event === 'pillar_complete') {
              const d = evt.data as { pillar?: string; passed?: number; total?: number; pass_rate?: number };
              return (
                <div key={i} className="text-cyan leading-relaxed border-t border-zinc-800/50 mt-1 pt-1">
                  <span className="text-zinc-600">{ts}</span>{' '}
                  <span className="text-cyan">■</span>{' '}
                  <span className="text-cyan font-medium">{shortPillar(d.pillar ?? '')}</span>{' '}
                  <span className={passRateColor(d.pass_rate ?? null)}>
                    {d.passed}/{d.total} ({((d.pass_rate ?? 0) * 100).toFixed(0)}%)
                  </span>
                </div>
              );
            }
            if (evt.event === 'run_complete') {
              const d = evt.data as { passed?: number; failed?: number; total?: number };
              return (
                <div key={i} className="text-cyan leading-relaxed border-t border-zinc-700/50 mt-1 pt-1 font-medium">
                  <span className="text-zinc-600">{ts}</span>{' '}
                  <span className="text-cyan">✔ Run complete</span>{' '}
                  <span className="text-emerald-400">{d.passed} passed</span>
                  {(d.failed ?? 0) > 0 && <span className="text-rose-400"> · {d.failed} failed</span>}
                  <span className="text-zinc-500"> / {d.total} total</span>
                </div>
              );
            }
            if (evt.event === 'error') {
              return (
                <div key={i} className="text-rose-400 leading-relaxed">
                  <span className="text-zinc-600">{ts}</span>{' '}
                  <span>[error]</span>{' '}
                  {JSON.stringify(evt.data)}
                </div>
              );
            }
            // Fallback for connected or unknown events
            return (
              <div key={i} className="text-zinc-400 leading-relaxed">
                <span className="text-zinc-600">{ts}</span>{' '}
                <span className="text-zinc-500">[{evt.event}]</span>{' '}
                {JSON.stringify(evt.data)}
              </div>
            );
          })}
        </div>
      )}

      {/* Recent Runs */}
      <div className="mt-4">
        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Recent Runs</h4>
        {loading && <Skeleton className="h-20" />}
        {error && <p className="text-rose-400 text-sm">{error}</p>}
        {!loading && runs.length === 0 && (
          <p className="text-zinc-500 text-xs">No runs yet.</p>
        )}
        {!loading && runs.length > 0 && (
          <div className="space-y-2">
            {runs.map((r) => {
              const passed = r.passed_count ?? 0;
              const total = r.task_count;
              const rate = total > 0 ? passed / total : 0;
              return (
                <div
                  key={r.batch_id}
                  className="flex items-center gap-3 text-xs border border-zinc-800/40 rounded p-2 hover:bg-zinc-800/20 cursor-pointer"
                  onClick={async () => {
                    if (r.batch_status === 'running') {
                      setSseEvents([]);
                      setActiveRunId(r.batch_id);
                      setBatchDetail(null);
                    } else {
                      // Load batch detail for completed/partial runs
                      setBatchDetailLoading(true);
                      setExpandedRunId(null);
                      try {
                        const data = await apiCall<{ batch_id: string; runs: BatchDetailRun[] }>(`/api/cz/runs/${r.batch_id}`);
                        setBatchDetail(data);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBatchDetailLoading(false);
                      }
                    }
                  }}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      r.batch_status === 'completed'
                        ? 'bg-emerald-400'
                        : r.batch_status === 'running'
                          ? 'bg-amber-400 animate-pulse'
                          : r.batch_status === 'partial'
                            ? 'bg-rose-400'
                            : 'bg-zinc-600'
                    }`}
                  />
                  <span className="text-zinc-300 font-medium w-14">{r.trigger_type}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    r.surface === 'teams' ? 'bg-indigo-900/40 text-indigo-300' :
                    r.surface === 'slack' ? 'bg-green-900/40 text-green-300' :
                    'bg-zinc-700/40 text-zinc-400'
                  }`}>{r.surface}</span>
                  <span className={`tabular-nums ${passRateColor(rate)}`}>
                    {passed}/{total}
                  </span>
                  {r.avg_judge_score != null && (
                    <span className={`tabular-nums ${scoreColor(Number(r.avg_judge_score))}`}>
                      avg {Number(r.avg_judge_score).toFixed(1)}
                    </span>
                  )}
                  <span
                    className="text-zinc-600 ml-auto tabular-nums"
                    title={formatStampFull(r.started_at)}
                  >
                    {formatStamp(r.started_at)} · {timeAgo(r.started_at)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Batch Detail Drill-Down */}
      {batchDetailLoading && (
        <div className="mt-4"><Skeleton className="h-24" /></div>
      )}
      {batchDetail && !batchDetailLoading && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Run Detail · <span className="text-zinc-500 font-mono">{batchDetail.batch_id.slice(0, 8)}</span>
            </h4>
            <button
              onClick={() => setBatchDetail(null)}
              className="text-zinc-600 hover:text-zinc-400 text-xs"
            >✕ close</button>
          </div>
          <div className="space-y-1">
            {(batchDetail.runs ?? []).map((s) => {
              const rid = s.run_id ?? s.id ?? `${s.task_number}`;
              const isExpanded = expandedRunId === rid;
              return (
                <div key={rid} className="border border-zinc-800/40 rounded">
                  <div
                    className="flex items-center gap-2 text-[11px] p-2 cursor-pointer hover:bg-zinc-800/20"
                    onClick={() => setExpandedRunId(isExpanded ? null : rid)}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${s.passed ? 'bg-emerald-400' : s.passed === false ? 'bg-rose-400' : 'bg-zinc-600'}`} />
                    <span className="text-zinc-500">#{s.task_number}</span>
                    <span className="text-zinc-300 flex-1 truncate">{s.task}</span>
                    {s.responsible_agent && <span className="text-indigo-400/70 text-[10px]">{s.responsible_agent}</span>}
                    {s.judge_score != null && (
                      <span className={`tabular-nums ${scoreColor(s.judge_score)}`}>
                        {s.judge_score.toFixed(1)}
                      </span>
                    )}
                    {s.judge_tier && <span className="text-zinc-600 text-[10px]">[{s.judge_tier}]</span>}
                    <span className="text-zinc-700">{isExpanded ? '▾' : '▸'}</span>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-zinc-800/30 p-3 bg-zinc-950/50 text-xs space-y-3">
                      <div className="flex gap-4 text-zinc-500">
                        <span>Pillar: <span className="text-zinc-400">{s.pillar}</span></span>
                        {s.is_p0 && <span className="text-amber-500">P0</span>}
                        {s.latency_ms != null && <span>Latency: <span className="text-zinc-400">{(s.latency_ms / 1000).toFixed(1)}s</span></span>}
                      </div>
                      {s.reasoning_trace && (
                        <div>
                          <p className="text-zinc-500 font-medium text-[11px] mb-1">Judge Reasoning</p>
                          <p className="text-zinc-400">{s.reasoning_trace}</p>
                        </div>
                      )}
                      {s.axis_scores && Object.keys(s.axis_scores).length > 0 && (
                        <div>
                          <p className="text-zinc-500 font-medium text-[11px] mb-1">Axis Scores</p>
                          <div className="flex gap-3">
                            {Object.entries(s.axis_scores).map(([k, v]) => (
                              <span key={k} className={v >= 0.7 ? 'text-emerald-500' : v >= 0.5 ? 'text-amber-500' : 'text-rose-500'}>
                                {k}: {(v * 10).toFixed(0)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {s.heuristic_failures && s.heuristic_failures.length > 0 && (
                        <div>
                          <p className="text-zinc-500 font-medium text-[11px] mb-1">Failures</p>
                          <p className="text-rose-400/80">{s.heuristic_failures.join('; ')}</p>
                        </div>
                      )}
                      {s.agent_output && (
                        <div>
                          <p className="text-zinc-500 font-medium text-[11px] mb-1">Agent Output</p>
                          <pre className="text-zinc-300 whitespace-pre-wrap break-words max-h-96 overflow-y-auto border border-zinc-700/40 rounded-lg p-3 bg-zinc-950/60 leading-relaxed">
                            {s.agent_output}
                          </pre>
                        </div>
                      )}
                      {!s.agent_output && s.judge_tier === 'heuristic' && (
                        <p className="text-zinc-600 italic">No agent output — heuristic scoring only (no LLM invoked).</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════
   Panel 4: Drift Chart
   ══════════════════════════════════════════════════════════════ */

function DriftChart() {
  const [series, setSeries] = useState<CzDriftPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [filterPillar, setFilterPillar] = useState<string | null>(null);
  const [filterSurface, setFilterSurface] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const qs = new URLSearchParams({ days: String(days) });
        if (filterPillar) qs.set('pillar', filterPillar);
        if (filterSurface) qs.set('surface', filterSurface);
        const data = await apiCall<{ series: CzDriftPoint[] }>(`/api/cz/drift?${qs.toString()}`);
        if (!cancelled) setSeries(data.series);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [days, filterPillar, filterSurface]);

  // Group by pillar for sparklines
  const byPillar = useMemo(() => {
    const map = new Map<string, { passRates: number[]; scores: number[]; dates: string[] }>();
    for (const pt of series) {
      if (!map.has(pt.pillar)) map.set(pt.pillar, { passRates: [], scores: [], dates: [] });
      const entry = map.get(pt.pillar)!;
      entry.passRates.push(Number(pt.pass_rate));
      entry.scores.push(Number(pt.avg_score));
      entry.dates.push(pt.completed_at);
    }
    return map;
  }, [series]);

  const pillarNames = useMemo(() => [...byPillar.keys()].sort(), [byPillar]);

  return (
    <Card>
      <SectionHeader title="Drift Chart" subtitle={`Last ${days} days`} />

      <div className="flex items-center gap-2 mt-3">
        {[7, 14, 30, 60, 90].map((d) => (
          <button
            key={d}
            className={`text-xs px-2 py-1 rounded ${days === d ? 'bg-cyan/20 text-cyan' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
            onClick={() => setDays(d)}
          >
            {d}d
          </button>
        ))}
        <span className="text-zinc-600 mx-1">|</span>
        {[null, 'direct', 'teams', 'slack'].map((s) => (
          <button
            key={s ?? 'all'}
            className={`text-xs px-2 py-1 rounded ${filterSurface === s ? 'bg-cyan/20 text-cyan' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
            onClick={() => setFilterSurface(s)}
          >
            {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
          </button>
        ))}
      </div>

      {loading && <Skeleton className="h-40 mt-3" />}
      {error && <p className="text-rose-400 text-sm mt-3">{error}</p>}

      {!loading && series.length === 0 && (
        <p className="text-zinc-500 text-xs mt-3">No drift data yet. Complete some runs to see trends.</p>
      )}

      {!loading && series.length > 0 && (
        <div className="mt-4 space-y-3">
          {pillarNames.map((pillar) => {
            const data = byPillar.get(pillar)!;
            const latestRate = data.passRates[data.passRates.length - 1];
            const latestScore = data.scores[data.scores.length - 1];
            const prevRate = data.passRates.length > 1 ? data.passRates[data.passRates.length - 2] : latestRate;
            const delta = latestRate - prevRate;

            return (
              <div
                key={pillar}
                className="flex items-center gap-4 border-b border-zinc-800/30 pb-2"
              >
                <span className="text-xs text-zinc-300 w-28 flex-shrink-0">{shortPillar(pillar)}</span>
                <div className="flex-1 h-8">
                  <Sparkline data={data.passRates.map((r) => r * 100)} />
                </div>
                <span className={`text-xs tabular-nums w-12 text-right ${passRateColor(latestRate)}`}>
                  {(latestRate * 100).toFixed(0)}%
                </span>
                <span
                  className={`text-[10px] tabular-nums w-10 text-right ${
                    delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-zinc-500'
                  }`}
                >
                  {delta > 0 ? '+' : ''}{(delta * 100).toFixed(1)}
                </span>
                <span className={`text-xs tabular-nums w-10 text-right ${scoreColor(latestScore)}`}>
                  {latestScore.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════
   Blockers & Fix Plan
   Summarizes failing tasks, top blocking agents/pillars, recent
   failure reasoning, and any prompt mutations already staged by
   the reflection bridge (source='cz_reflection').
   ══════════════════════════════════════════════════════════════ */

interface BlockersPayload {
  summary: {
    total_tasks: number;
    passing: number;
    failing: number;
    unscored: number;
    p0_failing: number;
    p0_total: number;
    avg_score: number | null;
    last_run_at: string | null;
  };
  top_agents: Array<{
    agent: string;
    total_count: number;
    failing_count: number;
    p0_failing_count: number;
    avg_score: number | null;
    last_run_at: string | null;
  }>;
  top_pillars: Array<{
    pillar: string;
    pass_rate_threshold: number | null;
    avg_score_threshold: number | null;
    total_count: number;
    passing_count: number;
    failing_count: number;
    avg_score: number | null;
    last_run_at: string | null;
  }>;
  recent_failures: Array<{
    task_id: string;
    task_number: number;
    task: string;
    pillar: string;
    responsible_agent: string | null;
    is_p0: boolean;
    completed_at: string | null;
    surface: string | null;
    mode: string | null;
    judge_score: number | null;
    judge_tier: string | null;
    reasoning_trace: string | null;
    heuristic_failures: string[] | null;
    axis_scores: Record<string, number> | null;
  }>;
  staged_fixes: Array<{
    id: string;
    agent_id: string;
    version: number;
    prompt_text: string | null;
    change_summary: string | null;
    source: string;
    created_at: string;
    deployed_at: string | null;
    retired_at: string | null;
  }>;
}

function BlockersAndPlan() {
  const [data, setData] = useState<BlockersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFix, setExpandedFix] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [expandedFailure, setExpandedFailure] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiCall<BlockersPayload>('/api/cz/blockers?limit=10')
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load blockers'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Shared action wrapper — surfaces success/failure toast and refreshes data.
  const runAction = useCallback(async (
    key: string,
    label: string,
    op: () => Promise<unknown>,
  ) => {
    setPendingAction(key);
    setActionStatus(null);
    try {
      await op();
      setActionStatus({ kind: 'ok', msg: `${label} succeeded` });
      load();
    } catch (e) {
      setActionStatus({ kind: 'err', msg: `${label} failed: ${e instanceof Error ? e.message : 'unknown error'}` });
    } finally {
      setPendingAction(null);
    }
  }, [load]);

  const rerunTask = useCallback((taskId: string, taskNumber: number) => runAction(
    `rerun:${taskId}`,
    `Re-run task #${taskNumber}`,
    () => apiCall('/api/cz/runs', {
      method: 'POST',
      body: JSON.stringify({ mode: 'single', task_id: taskId, triggered_by: 'dashboard:blockers' }),
    }),
  ), [runAction]);

  const promoteFix = useCallback((versionId: string, agent: string, version: number) => {
    if (!window.confirm(
      `Promote ${agent} v${version} to production?\n\n` +
      `This skips the 10-run shadow evaluation gate and deploys the staged prompt immediately. ` +
      `The currently-deployed version will be retired.`,
    )) return Promise.resolve();
    return runAction(
      `promote:${versionId}`,
      `Promote ${agent} v${version}`,
      () => apiCall(`/api/cz/fixes/${versionId}/promote`, {
        method: 'POST',
        body: JSON.stringify({ triggered_by: 'dashboard:blockers' }),
      }),
    );
  }, [runAction]);

  const rejectFix = useCallback((versionId: string, agent: string, version: number) => {
    const reason = window.prompt(`Reject ${agent} v${version}?\n\nOptional reason (logged to activity):`);
    if (reason === null) return Promise.resolve();
    return runAction(
      `reject:${versionId}`,
      `Reject ${agent} v${version}`,
      () => apiCall(`/api/cz/fixes/${versionId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ triggered_by: 'dashboard:blockers', reason }),
      }),
    );
  }, [runAction]);

  const passRate = useMemo(() => {
    if (!data) return null;
    const scored = data.summary.passing + data.summary.failing;
    if (scored === 0) return null;
    return data.summary.passing / scored;
  }, [data]);

  // Derive ranked actionable recommendations from top agents + staged fixes
  const recommendations = useMemo(() => {
    if (!data) return [] as Array<{ priority: 'P0' | 'High' | 'Med'; title: string; detail: string }>;
    const recs: Array<{ priority: 'P0' | 'High' | 'Med'; title: string; detail: string }> = [];

    if (data.summary.p0_failing > 0) {
      recs.push({
        priority: 'P0',
        title: `${data.summary.p0_failing} P0 test${data.summary.p0_failing === 1 ? '' : 's'} failing — block launch`,
        detail: 'Investigate and fix before promoting any shadow prompts. P0 failures gate certification.',
      });
    }

    const stagedAgents = new Set(data.staged_fixes.filter((s) => !s.deployed_at).map((s) => s.agent_id));
    for (const a of data.top_agents.slice(0, 3)) {
      const hasPlan = stagedAgents.has(a.agent);
      const priority: 'P0' | 'High' | 'Med' = a.p0_failing_count > 0 ? 'P0' : a.failing_count >= 3 ? 'High' : 'Med';
      recs.push({
        priority,
        title: `${a.agent}: ${a.failing_count} failing${a.p0_failing_count > 0 ? ` (${a.p0_failing_count} P0)` : ''}`,
        detail: hasPlan
          ? 'Prompt mutation already staged by reflection loop — review & promote via shadow eval.'
          : 'No staged fix yet. Re-run failing tasks to trigger reflection, or hand-author a prompt patch.',
      });
    }

    for (const p of data.top_pillars.slice(0, 2)) {
      const threshold = p.pass_rate_threshold != null ? Number(p.pass_rate_threshold) : null;
      const rate = p.total_count > 0 ? p.passing_count / p.total_count : 0;
      if (threshold != null && rate < threshold) {
        recs.push({
          priority: 'High',
          title: `Pillar "${p.pillar}" below threshold (${(rate * 100).toFixed(0)}% vs ${(threshold * 100).toFixed(0)}%)`,
          detail: `${p.failing_count}/${p.total_count} tasks failing. Target the shared scenario pattern, not individual tasks.`,
        });
      }
    }

    if (data.recent_failures.length > 0 && recs.length < 3) {
      const heuristicCounts: Record<string, number> = {};
      for (const f of data.recent_failures) {
        for (const h of f.heuristic_failures ?? []) {
          heuristicCounts[h] = (heuristicCounts[h] ?? 0) + 1;
        }
      }
      const topHeuristic = Object.entries(heuristicCounts).sort((a, b) => b[1] - a[1])[0];
      if (topHeuristic && topHeuristic[1] >= 2) {
        recs.push({
          priority: 'Med',
          title: `Recurring heuristic failure: "${topHeuristic[0]}" (${topHeuristic[1]}x)`,
          detail: 'Common pattern across multiple agents — likely a shared tool, prompt template, or guardrail issue.',
        });
      }
    }

    return recs;
  }, [data]);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionHeader
          title="Blockers & Fix Plan"
          subtitle="Automated failure analysis with prioritized recommendations."
        />
        <button
          onClick={load}
          disabled={loading}
          className="text-xs text-cyan hover:text-cyan/80 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="text-rose-400 text-sm mt-3">{error}</p>}
      {loading && !data && <Skeleton className="h-32 mt-3" />}
      {actionStatus && (
        <div
          className={`mt-3 text-xs px-3 py-2 rounded border ${
            actionStatus.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          }`}
        >
          {actionStatus.msg}
          <button
            className="ml-2 text-zinc-400 hover:text-zinc-200"
            onClick={() => setActionStatus(null)}
          >
            ✕
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
            <SummaryStat label="Total" value={String(data.summary.total_tasks)} />
            <SummaryStat
              label="Passing"
              value={`${data.summary.passing}${passRate != null ? ` (${(passRate * 100).toFixed(0)}%)` : ''}`}
              tone="pos"
            />
            <SummaryStat label="Failing" value={String(data.summary.failing)} tone={data.summary.failing > 0 ? 'neg' : 'neutral'} />
            <SummaryStat
              label="P0 Failing"
              value={`${data.summary.p0_failing}/${data.summary.p0_total}`}
              tone={data.summary.p0_failing > 0 ? 'neg' : 'pos'}
            />
            <SummaryStat
              label="Last Run"
              value={data.summary.last_run_at ? formatStamp(data.summary.last_run_at) : 'never'}
              title={formatStampFull(data.summary.last_run_at)}
            />
          </div>

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div className="mt-5">
              <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Plan to fix — ranked</h3>
              <ul className="space-y-2">
                {recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                        r.priority === 'P0'
                          ? 'bg-rose-500/20 text-rose-300'
                          : r.priority === 'High'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-zinc-700/50 text-zinc-300'
                      }`}
                    >
                      {r.priority}
                    </span>
                    <div className="flex-1">
                      <p className="text-zinc-100">{r.title}</p>
                      <p className="text-zinc-500 text-xs">{r.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Two-column: Top agents + Top pillars */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            <div>
              <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Top blocking agents</h3>
              {data.top_agents.length === 0 ? (
                <p className="text-xs text-emerald-400">No failing agents. 🎉</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-zinc-500 text-left border-b border-zinc-700/40">
                    <tr>
                      <th className="py-1.5 pr-2">Agent</th>
                      <th className="py-1.5 pr-2 text-right">Failing</th>
                      <th className="py-1.5 pr-2 text-right">P0</th>
                      <th className="py-1.5 text-right">Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_agents.map((a) => (
                      <tr key={a.agent} className="border-b border-zinc-800/40">
                        <td className="py-1.5 pr-2 text-zinc-200">{a.agent}</td>
                        <td className="py-1.5 pr-2 text-right text-rose-400 tabular-nums">
                          {a.failing_count}/{a.total_count}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">
                          {a.p0_failing_count > 0
                            ? <span className="text-rose-400 font-semibold">{a.p0_failing_count}</span>
                            : <span className="text-zinc-600">0</span>}
                        </td>
                        <td className={`py-1.5 text-right tabular-nums ${scoreColor(a.avg_score)}`}>
                          {a.avg_score != null ? Number(a.avg_score).toFixed(1) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Top blocking pillars</h3>
              {data.top_pillars.length === 0 ? (
                <p className="text-xs text-emerald-400">All pillars passing thresholds.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-zinc-500 text-left border-b border-zinc-700/40">
                    <tr>
                      <th className="py-1.5 pr-2">Pillar</th>
                      <th className="py-1.5 pr-2 text-right">Pass %</th>
                      <th className="py-1.5 pr-2 text-right">Failing</th>
                      <th className="py-1.5 text-right">Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_pillars.map((p) => {
                      const rate = p.total_count > 0 ? (p.passing_count / p.total_count) * 100 : 0;
                      const threshold = p.pass_rate_threshold != null ? Number(p.pass_rate_threshold) * 100 : null;
                      const belowThreshold = threshold != null && rate < threshold;
                      return (
                        <tr key={p.pillar} className="border-b border-zinc-800/40">
                          <td className="py-1.5 pr-2 text-zinc-200">{shortPillar(p.pillar)}</td>
                          <td className={`py-1.5 pr-2 text-right tabular-nums ${belowThreshold ? 'text-rose-400' : 'text-zinc-300'}`}>
                            {rate.toFixed(0)}%{threshold != null && <span className="text-zinc-600"> /{threshold.toFixed(0)}</span>}
                          </td>
                          <td className="py-1.5 pr-2 text-right text-rose-400 tabular-nums">
                            {p.failing_count}/{p.total_count}
                          </td>
                          <td className={`py-1.5 text-right tabular-nums ${scoreColor(p.avg_score)}`}>
                            {p.avg_score != null ? Number(p.avg_score).toFixed(1) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Recent failure reasoning */}
          {data.recent_failures.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Recent failures — judge reasoning</h3>
              <ul className="space-y-2">
                {data.recent_failures.map((f) => {
                  const isOpen = expandedFailure === f.task_id;
                  return (
                    <li key={f.task_id} className="border border-zinc-800/60 rounded-md bg-zinc-900/30">
                      <button
                        className="w-full flex items-start gap-3 p-2.5 text-left hover:bg-zinc-800/30"
                        onClick={() => setExpandedFailure(isOpen ? null : f.task_id)}
                      >
                        <span className="text-zinc-600 tabular-nums text-xs pt-0.5 w-8 shrink-0">#{f.task_number}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-zinc-100 text-sm truncate">{f.task}</p>
                          <p className="text-zinc-500 text-xs mt-0.5">
                            {f.responsible_agent ?? '—'} · {shortPillar(f.pillar)}
                            {f.is_p0 && <span className="text-rose-400 ml-1.5 font-semibold">P0</span>}
                            {f.surface && f.surface !== 'direct' && <span className="ml-1.5">({f.surface})</span>}
                            <span className="ml-2 text-zinc-600" title={formatStampFull(f.completed_at)}>
                              {formatStamp(f.completed_at)}
                            </span>
                          </p>
                        </div>
                        <span className={`text-sm tabular-nums shrink-0 ${scoreColor(f.judge_score)}`}>
                          {f.judge_score != null ? Number(f.judge_score).toFixed(1) : '—'}
                        </span>
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3 space-y-2 text-xs border-t border-zinc-800/60 pt-2">
                          {f.heuristic_failures && f.heuristic_failures.length > 0 && (
                            <div>
                              <p className="text-zinc-500 mb-1">Heuristic failures</p>
                              <div className="flex flex-wrap gap-1">
                                {f.heuristic_failures.map((h, i) => (
                                  <span key={i} className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">
                                    {h}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {f.reasoning_trace && (
                            <div>
                              <p className="text-zinc-500 mb-1">Judge reasoning ({f.judge_tier ?? 'unknown tier'})</p>
                              <p className="text-zinc-300 whitespace-pre-wrap">{f.reasoning_trace}</p>
                            </div>
                          )}
                          {f.axis_scores && Object.keys(f.axis_scores).length > 0 && (
                            <div>
                              <p className="text-zinc-500 mb-1">Axis breakdown</p>
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(f.axis_scores).map(([k, v]) => (
                                  <span key={k} className="text-zinc-400">
                                    {k}: <span className={scoreColor(Number(v))}>{Number(v).toFixed(1)}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); rerunTask(f.task_id, f.task_number); }}
                              disabled={pendingAction === `rerun:${f.task_id}`}
                              className="px-2 py-1 rounded text-[11px] font-medium bg-cyan/15 text-cyan hover:bg-cyan/25 border border-cyan/30 disabled:opacity-50"
                              title="Queue a fresh run for this task. On failure, the reflection loop will stage a new prompt mutation."
                            >
                              {pendingAction === `rerun:${f.task_id}` ? 'Queuing…' : '↻ Re-run task'}
                            </button>
                            <span className="text-zinc-600 text-[11px]">
                              A failed re-run will trigger a new reflection-generated fix within ~24h.
                            </span>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Staged fixes from reflection bridge */}
          {data.staged_fixes.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
                Prompt mutations staged by reflection loop
                <span className="ml-2 text-zinc-600 normal-case font-normal">
                  (auto-generated fixes — review &amp; promote, or let shadow eval decide)
                </span>
              </h3>
              <ul className="space-y-1.5">
                {data.staged_fixes.map((s) => {
                  const isOpen = expandedFix === s.id;
                  const status =
                    s.deployed_at ? 'deployed' :
                    s.retired_at ? 'retired' :
                    'staged';
                  const statusClass =
                    status === 'deployed' ? 'bg-emerald-500/15 text-emerald-300' :
                    status === 'retired' ? 'bg-zinc-700/40 text-zinc-400 line-through' :
                    'bg-amber-500/15 text-amber-300';
                  const actionable = status === 'staged';
                  return (
                    <li key={s.id} className="border border-zinc-800/60 rounded-md bg-zinc-900/30">
                      <div className="flex items-start gap-3 px-3 py-2 text-xs">
                        <button
                          onClick={() => setExpandedFix(isOpen ? null : s.id)}
                          className="flex-1 min-w-0 flex items-start gap-3 text-left hover:bg-zinc-800/20 -mx-1 px-1 rounded"
                        >
                          <span className="text-zinc-600 text-[10px] pt-0.5 shrink-0">{isOpen ? '▾' : '▸'}</span>
                          <span className="text-zinc-200 w-24 shrink-0 truncate">{s.agent_id}</span>
                          <span className="text-zinc-500 w-12 shrink-0 tabular-nums">v{s.version}</span>
                          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] ${statusClass}`}>
                            {status}
                          </span>
                          <span className="text-zinc-400 flex-1 min-w-0 truncate" title={s.change_summary ?? ''}>
                            {s.change_summary ?? '(no summary)'}
                          </span>
                          <span className="text-zinc-600 tabular-nums shrink-0" title={formatStampFull(s.created_at)}>
                            {formatStamp(s.created_at)}
                          </span>
                        </button>
                        {actionable && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); promoteFix(s.id, s.agent_id, s.version); }}
                              disabled={pendingAction !== null}
                              className="px-2 py-1 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30 disabled:opacity-50"
                              title="Deploy this prompt mutation now, retiring the current baseline. Skips the 10-run shadow eval gate."
                            >
                              {pendingAction === `promote:${s.id}` ? '…' : '✓ Promote'}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); rejectFix(s.id, s.agent_id, s.version); }}
                              disabled={pendingAction !== null}
                              className="px-2 py-1 rounded text-[11px] font-medium bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 border border-rose-500/30 disabled:opacity-50"
                              title="Retire this staged mutation without deploying. The reflection loop may stage a new one after the next failure."
                            >
                              {pendingAction === `reject:${s.id}` ? '…' : '✗ Reject'}
                            </button>
                          </div>
                        )}
                      </div>
                      {isOpen && (
                        <div className="px-3 pb-3 pt-1 text-xs border-t border-zinc-800/60 space-y-2">
                          {s.change_summary && (
                            <div>
                              <p className="text-zinc-500 mb-1">Change summary</p>
                              <p className="text-zinc-300 whitespace-pre-wrap">{s.change_summary}</p>
                            </div>
                          )}
                          {s.prompt_text ? (
                            <div>
                              <p className="text-zinc-500 mb-1">Proposed prompt (v{s.version})</p>
                              <pre className="text-zinc-300 bg-black/40 border border-zinc-800 rounded p-2 whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
{s.prompt_text}
                              </pre>
                            </div>
                          ) : (
                            <p className="text-zinc-600 italic">No prompt text recorded for this version.</p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {data.staged_fixes.length === 0 && data.summary.failing > 0 && (
            <div className="mt-6 text-xs text-zinc-500 border border-zinc-800/60 rounded-md p-3 bg-zinc-900/30">
              <p className="text-zinc-300">No staged prompt fixes yet.</p>
              <p className="mt-1">
                The reflection loop stages a prompt mutation after a batch completes with failures. Re-run the failing tasks above to trigger a fresh analysis,
                or hand-author a prompt change in the agents package.
              </p>
            </div>
          )}

          {data.summary.failing === 0 && data.summary.p0_failing === 0 && (
            <p className="text-emerald-400 text-sm mt-4">No blockers. All scored tasks passing.</p>
          )}
        </>
      )}
    </Card>
  );
}

function SummaryStat({
  label,
  value,
  tone = 'neutral',
  title,
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg' | 'neutral';
  title?: string;
}) {
  const color =
    tone === 'pos' ? 'text-emerald-300' :
    tone === 'neg' ? 'text-rose-300' :
    'text-zinc-100';
  return (
    <div className="border border-zinc-800/60 rounded-md px-3 py-2 bg-zinc-900/30" title={title}>
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`text-sm font-semibold tabular-nums mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Main Page
   ══════════════════════════════════════════════════════════════ */

export default function CzProtocol() {
  // Determine workflow step based on data availability
  const [completedSteps, setCompletedSteps] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        // Check if any runs exist (step 1 done)
        const runsData = await apiCall<{ batches: Array<{ batch_status: string }> }>('/api/cz/runs?limit=1');
        if (!runsData.batches?.length) { setCompletedSteps(0); return; }

        // Runs exist — step 1 is done
        const hasCompleted = runsData.batches.some((b) => b.batch_status === 'completed' || b.batch_status === 'scored');
        if (!hasCompleted) { setCompletedSteps(1); return; }

        // Completed runs exist — scorecard is reviewable (step 2 done)
        // Check if any launch gate is met (step 3)
        const scorecard = await apiCall<{ gates: Array<{ met: boolean }> }>('/api/cz/scorecard');
        const anyGateMet = scorecard.gates?.some((g) => g.met);

        // Check if drift data exists (step 4)
        const drift = await apiCall<{ series: unknown[] }>('/api/cz/drift?days=30');
        const hasDrift = (drift.series?.length ?? 0) > 1;

        if (hasDrift && anyGateMet) setCompletedSteps(4);
        else if (anyGateMet) setCompletedSteps(3);
        else setCompletedSteps(2);
      } catch {
        setCompletedSteps(0);
      }
    })();
  }, []);

  const steps = [
    { num: 1, label: 'Run tests' },
    { num: 2, label: 'Review scorecard' },
    { num: 3, label: 'Check gates' },
    { num: 4, label: 'Track drift' },
  ];

  return (
    <div className="space-y-8">
      {/* Header + workflow guide */}
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Certification Protocol</h1>
        <p className="text-sm text-zinc-400 mt-1">
          89 tasks across 10 pillars, 19 P0 critical tests, 3 launch gates.
        </p>
        <div className="flex items-center flex-wrap gap-y-2 mt-4 text-xs">
          {steps.map((step, i) => {
            const isActive = step.num === completedSteps + 1;
            const isDone = step.num <= completedSteps;
            return (
              <span key={step.num} className="flex items-center">
                {i > 0 && <span className="text-zinc-700 mx-2">&rarr;</span>}
                <span className="flex items-center gap-1.5">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                    isDone ? 'bg-emerald-500/20 text-emerald-400' :
                    isActive ? 'bg-cyan/15 text-cyan' :
                    'bg-zinc-800 text-zinc-500'
                  }`}>
                    {isDone ? '✓' : step.num}
                  </span>
                  <span className={
                    isDone ? 'text-emerald-400' :
                    isActive ? 'text-cyan' :
                    'text-zinc-500'
                  }>{step.label}</span>
                </span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Step 1: Run tests */}
      <LiveRunConsole />

      {/* Step 2+3: Scorecard + Launch Gates */}
      <Scorecard />

      {/* Blockers & Fix Plan — failure analysis + prioritized recommendations */}
      <BlockersAndPlan />

      {/* Step 4: Trends over time */}
      <DriftChart />

      {/* Reference: Full task list */}
      <TaskGrid />
    </div>
  );
}
