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
  // Target metadata — what the batch was actually run against.
  target_pillar: string | null;
  target_agent: string | null;
  target_task_number: number | null;
  target_task: string | null;
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

      {/* Launch Gates — compact pill row */}
      <div className="mt-4 flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-zinc-500 uppercase tracking-wider mr-1">Launch gates</span>
        {gates.map((g) => (
          <span
            key={g.gate}
            title={g.description}
            className={`px-2 py-0.5 rounded-full border flex items-center gap-1.5 ${
              g.met
                ? 'border-emerald-700/40 bg-emerald-950/30 text-emerald-300'
                : 'border-zinc-700/40 bg-zinc-800/30 text-zinc-400'
            }`}
          >
            <span>{g.met ? '✓' : '○'}</span>
            <span>{gateLabel(g.gate)}</span>
          </span>
        ))}
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
  // History pagination — when expanded, show up to `runsLimit` runs.
  const [runsLimit, setRunsLimit] = useState<number>(10);
  const [runsTotal, setRunsTotal] = useState<number>(0);

  // Fetch tasks for pillar/agent/task selectors
  useEffect(() => {
    (async () => {
      try {
        const data = await apiCall<{ tasks: { id: string; task_number: number; task: string; pillar: string; responsible_agent: string | null }[] }>('/api/cz/tasks');
        setTasks(data.tasks);
      } catch { /* ignore — selectors will just be empty */ }
    })();
  }, []);

  // Fetch recent runs (paginated — runsLimit grows when "Show all" is used).
  const fetchRuns = useCallback(async () => {
    try {
      const data = await apiCall<{ runs: CzRun[]; total?: number }>(`/api/cz/runs?limit=${runsLimit}`);
      setRuns(data.runs);
      setRunsTotal(data.total ?? data.runs.length);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [runsLimit]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  // Listen for runs queued by sibling components (e.g. BlockersAndPlan's
  // "Re-run task" button). Without this, a blockers-initiated run queues
  // silently and never appears in Recent Runs until the user refreshes.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ batch_id?: string }>).detail;
      fetchRuns();
      if (detail?.batch_id) {
        setSseEvents([]);
        setActiveRunId(detail.batch_id);
        setBatchDetail(null);
        // Scroll the Run Console into view so the user sees the new run.
        consoleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    window.addEventListener('cz:run-queued', handler);
    return () => window.removeEventListener('cz:run-queued', handler);
  }, [fetchRuns]);

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
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            {runsLimit > 10 ? 'Run History' : 'Recent Runs'}
            <span className="ml-2 text-zinc-600 normal-case font-normal">
              {runs.length}{runsTotal > runs.length ? ` of ${runsTotal}` : ''}
            </span>
          </h4>
          <div className="flex items-center gap-2">
            {runsLimit > 10 && (
              <button
                onClick={() => setRunsLimit(10)}
                className="text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                Show recent only
              </button>
            )}
            {runsTotal > runs.length && (
              <button
                onClick={() => setRunsLimit((l) => Math.min(l + 50, 500))}
                className="text-[11px] text-cyan hover:text-cyan/80"
              >
                Load more ({runsTotal - runs.length} remaining)
              </button>
            )}
            {runsLimit === 10 && runsTotal > 10 && (
              <button
                onClick={() => setRunsLimit(50)}
                className="text-[11px] text-cyan hover:text-cyan/80"
              >
                View all runs
              </button>
            )}
          </div>
        </div>
        {loading && <Skeleton className="h-20" />}
        {error && <p className="text-rose-400 text-sm">{error}</p>}
        {!loading && runs.length === 0 && (
          <p className="text-zinc-500 text-xs">No runs yet.</p>
        )}
        {!loading && runs.length > 0 && (
          <div className={`space-y-2 ${runsLimit > 10 ? 'max-h-96 overflow-y-auto pr-1' : ''}`}>
            {runs.map((r) => {
              const passed = r.passed_count ?? 0;
              const total = r.task_count;
              const rate = total > 0 ? passed / total : 0;
              // Build a human-readable label of *what* this batch ran against.
              const targetLabel = (() => {
                switch (r.trigger_type) {
                  case 'pillar':
                    return r.target_pillar ? shortPillar(r.target_pillar) : 'pillar';
                  case 'canary':
                    return r.target_agent ?? 'canary';
                  case 'single':
                    return r.target_task_number != null
                      ? `#${r.target_task_number}${r.target_task ? ` ${r.target_task}` : ''}`
                      : 'single task';
                  case 'critical':
                    return `${total} P0`;
                  case 'full':
                    return `all ${total}`;
                  default:
                    return null;
                }
              })();
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
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      r.batch_status === 'completed'
                        ? 'bg-emerald-400'
                        : r.batch_status === 'running'
                          ? 'bg-amber-400 animate-pulse'
                          : r.batch_status === 'partial'
                            ? 'bg-rose-400'
                            : 'bg-zinc-600'
                    }`}
                  />
                  <span className="text-zinc-300 font-medium w-14 shrink-0">{r.trigger_type}</span>
                  {targetLabel && (
                    <span
                      className="text-zinc-400 truncate max-w-[16rem]"
                      title={r.trigger_type === 'single' && r.target_task ? r.target_task : targetLabel}
                    >
                      {targetLabel}
                    </span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                    r.surface === 'teams' ? 'bg-indigo-900/40 text-indigo-300' :
                    r.surface === 'slack' ? 'bg-green-900/40 text-green-300' :
                    'bg-zinc-700/40 text-zinc-400'
                  }`}>{r.surface}</span>
                  <span className={`tabular-nums shrink-0 ${passRateColor(rate)}`}>
                    {passed}/{total}
                  </span>
                  {r.avg_judge_score != null && (
                    <span className={`tabular-nums shrink-0 ${scoreColor(Number(r.avg_judge_score))}`}>
                      avg {Number(r.avg_judge_score).toFixed(1)}
                    </span>
                  )}
                  <span
                    className="text-zinc-600 ml-auto tabular-nums shrink-0"
                    title={`${formatStampFull(r.started_at)}${r.triggered_by ? ` · by ${r.triggered_by}` : ''}`}
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
    sub_category: string | null;
    acceptance_criteria: string | null;
    verification_method: string | null;
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
    agent_output: string | null;
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
  // Per-agent grouped failing tasks (latest score, passed=false). Drives the
  // per-agent drill-down + bulk re-run actions in the fix plan.
  failing_by_agent: Record<string, Array<{
    task_id: string;
    task_number: number;
    task: string;
    pillar: string;
    sub_category: string | null;
    acceptance_criteria: string | null;
    verification_method: string | null;
    is_p0: boolean;
    judge_score: number | null;
    judge_tier: string | null;
    heuristic_failures: string[] | null;
    axis_scores: Record<string, number> | null;
    reasoning_trace: string | null;
    agent_output: string | null;
    completed_at: string | null;
  }>>;
}

/**
 * Pipeline-state payload from /api/cz/automation. Tells us whether the
 * automated reflection→shadow-eval→promote loop is ticking and which
 * agents are currently being auto-fixed vs. need a human eye.
 */
type ShadowEvalState =
  | 'shadow_pending'
  | 'shadow_running'
  | 'auto_promoted'
  | 'human_review'
  | 'shadow_failed'
  | 'shadow_passed';

interface AutomationPayload {
  last_loop_run_at: string | null;
  last_loop_trigger: string | null;
  flow_24h: Record<ShadowEvalState, number>;
  flow_7d: Record<ShadowEvalState, number>;
  per_agent_status: Record<string, {
    agent_id: string;
    state: ShadowEvalState;
    shadow_eval_id: string;
    version: number;
    attempts_used: number;
    consecutive_wins: number;
    last_pass_rate: number | null;
    baseline_pass_rate: number | null;
    created_at: string;
    last_ran_at: string | null;
  }>;
  stuck_evals: Array<{
    id: string;
    prompt_version_id: string;
    agent_id: string;
    state: ShadowEvalState;
    version: number;
    escalation_reason: string | null;
    created_at: string;
  }>;
  agents_no_active_prompt: Array<{ agent_id: string; failing_count: number }>;
}

/**
 * Map a heuristic-failure tag (or a normalized substring) to a concrete
 * investigation/remediation step. Kept here rather than on the server so we can
 * iterate on the playbook without redeploying the scheduler.
 */
function suggestRemediation(
  heuristics: string[] | null | undefined,
  axisScores: Record<string, number> | null | undefined,
): Array<{ kind: string; action: string; detail: string }> {
  const steps: Array<{ kind: string; action: string; detail: string }> = [];
  const tags = (heuristics ?? []).map((h) => h.toLowerCase());

  const has = (...needles: string[]) => tags.some((t) => needles.some((n) => t.includes(n)));

  if (has('hallucinat', 'fabricat', 'unsupported_claim', 'no_evidence')) {
    steps.push({
      kind: 'evidence',
      action: 'Tighten evidence requirement in prompt',
      detail: 'Agent is fabricating. Add explicit "cite source or say I do not know" rule and gate output on retrieved evidence.',
    });
  }
  if (has('tool_misuse', 'wrong_tool', 'missing_tool', 'tool_unavailable', 'no_grant')) {
    steps.push({
      kind: 'tool',
      action: 'Audit tool grants for this agent',
      detail: 'Heuristic flagged a tool problem. Check agent_tool_grants for missing or stale entries; review the latest tool_call_traces.',
    });
  }
  if (has('format', 'schema', 'invalid_json', 'parse_error')) {
    steps.push({
      kind: 'format',
      action: 'Pin output schema in prompt',
      detail: 'Output failed structural checks. Add a JSON schema or strict format example to the system prompt and re-run.',
    });
  }
  if (has('incomplete', 'truncated', 'cutoff', 'max_turns')) {
    steps.push({
      kind: 'limits',
      action: 'Raise max_turns / token budget',
      detail: 'Agent ran out of room. Raise max_turns in agent config (current cap is set in agents package) or split the task.',
    });
  }
  if (has('drift', 'off_topic', 'voice_mismatch', 'persona')) {
    steps.push({
      kind: 'voice',
      action: 'Refresh voice / persona examples',
      detail: 'Output drifted from brand voice. Update casual_voice_examples or the agent constitution and re-evaluate.',
    });
  }
  if (has('safety', 'policy', 'unsafe', 'pii_leak', 'secret')) {
    steps.push({
      kind: 'safety',
      action: 'Investigate as a P0 safety incident',
      detail: 'Safety/policy heuristic tripped — escalate to security review before any prompt change.',
    });
  }
  if (has('memory', 'context_loss', 'amnesia')) {
    steps.push({
      kind: 'memory',
      action: 'Check working_memory and conversation_memory_summaries',
      detail: 'Agent lost prior context. Verify memory writes/reads on the failing run id and the consolidation job.',
    });
  }
  if (has('planning_not_execution')) {
    steps.push({
      kind: 'mode',
      action: 'Force execution mode in the agent\'s CZ prompt',
      detail: 'Agent described a plan/directive instead of executing the verification. The CZ executor already instructs agents to perform the task inline; update the agent\'s system prompt or constitution to override its default "delegate and track" behavior when the incoming request is a certification task.',
    });
  }
  if (has('verification_skipped')) {
    steps.push({
      kind: 'verify',
      action: 'Require inline N-case verification in the agent constitution',
      detail: 'Agent delivered the primary artifact but skipped the N-case verification the task calls for (e.g. "apply the voice guide to 5 unseen writing tasks and score each"). The CZ executor prompt now spells this out, but if the agent keeps offloading evidence ("saved to SharePoint", "posted for review") add a rule to the agent\'s own system prompt: "When the verification method lists N downstream generations, produce all N in the same response, labeled Generation 1 through N, each with its score against the rubric."',
    });
  }
  if (has('refused_for_missing_inputs')) {
    steps.push({
      kind: 'inputs',
      action: 'Permit synthesized inputs — or seed real ones into the task',
      detail: 'Agent refused the task because real input data (partner inquiries, transcripts, CRM records) was unavailable. Two durable fixes: (1) the CZ executor prompt now explicitly permits labeled representative inputs for certification runs — if the agent still refuses, its constitution is overriding; patch the agent\'s system prompt with an exception for CZ runs. (2) Or open the task in the Task Grid and paste 1–3 sample inputs directly into the task description so the agent has something concrete to work from. Rerunning without one of these will produce the same refusal.',
    });
  }
  if (has('judge_window_truncation')) {
    steps.push({
      kind: 'rerun',
      action: 'Just rerun — this is a judge-window artifact, not an agent bug',
      detail: 'The judge flagged truncation but the agent\'s actual output is structurally complete. This used to happen when the judge saw only the first 4000 chars of a longer deliverable (risk registers, battle card decks, voice guide + N generations). The judge window was raised to 16k chars on 2026-04-21; rerun this task and it should score correctly. No prompt changes are needed on the agent.',
    });
  }
  if (has('agent_runtime_abort')) {
    steps.push({
      kind: 'runtime',
      action: 'Check tool budget + grants — the agent had nothing to respond with',
      detail: 'The runtime aborted before producing any output (stalled / timed out / no verifiable result). This is not a prompt issue — the agent never got far enough to matter. Start by checking the runner wiring in packages/scheduler/src/czProtocolApi.ts STATIC_RUNNERS: does this agent have a tool budget compatible with the task (e.g. vp-research needs maxToolCalls > 0 for anything research-y)? Then check agent_tool_grants for required tools, and the run\'s latency_ms (near 300000 means model timeout). After fixing the wiring, rerun.',
    });
  }
  if (has('tool_attempt_without_synthesis')) {
    steps.push({
      kind: 'synthesis',
      action: 'Patch agent constitution to check synthesis policy before tools',
      detail: 'Agent tried tools first on an adversarial or input-dependent CZ task, reported failures, and stopped. For red-team tasks (poisoned docs, prompt injection, jailbreak) synthesizing the attack samples inline is the ONLY scorable path — real artifacts are not in the environment. The CZ executor prompt now has an explicit ADVERSARIAL/RED-TEAM section, but if the agent\'s constitution routes to tools unconditionally, add a CZ-specific override: "When invoked under the Customer Zero Protocol: if the verification method mentions poisoned/injection/adversarial/jailbreak/bypass/hard-blocked or asks for N synthesized cases, do not attempt tool retrieval — synthesize the N inputs inline and demonstrate your response to each." This is the same root cause as refused_for_missing_inputs but fires when the agent attempted rather than refused.',
    });
  }
  if (has('topical_drift')) {
    steps.push({
      kind: 'topic',
      action: 'Anchor the agent on the task subject, not its default playbook',
      detail: 'Agent produced a polished deliverable on the WRONG topic — typically fell back to its default framework (for orchestrator agents, that\'s usually a decision-routing / escalation-ladder policy). The heuristic tag lists which distinctive nouns from the task were missing. The CZ executor prompt now has a STAY ON TOPIC clause that names this failure mode explicitly. If this still fires, patch the agent\'s system prompt with: "Under the Customer Zero Protocol, read the task title and acceptance criteria before generating — your deliverable must address those specific nouns. A task titled \'memory poisoning\' is not satisfied by a decision-routing policy." Rerun after patching.',
    });
  }
  if (has('infra_verification_skipped')) {
    steps.push({
      kind: 'infra',
      action: 'Agent must synthesize the test rig inline (all N invocations)',
      detail: 'The verification method describes an external test rig (two-tenant harness, N federated invocations, RLS probe, guest-user matrix) that no agent can physically run from a chat completion. The failure mode: agent either refuses, files a directive, or drifts to an adjacent policy topic it is fluent in (e.g. Slack Connect communications policy instead of Teams federation isolation). The CZ executor prompt now has an INFRASTRUCTURE VERIFICATION clause instructing the agent to produce (1) a short isolation policy, (2) all N invocations enumerated under "### Simulated verification rig" with the request, boundary check, decision, response text, and incident-log entry for each, (3) a pass/fail tally. If this heuristic still fires after the clause is deployed, the owning agent is wrong — identity & tenancy tasks belong to an infra-owning role (cto / platform-engineer / devops-engineer), not to a communications or orchestration role. Check responsible_agent in cz_tasks and reassign.',
    });
  }
  if (has('external_review_skipped')) {
    steps.push({
      kind: 'review',
      action: 'Agent must synthesize the external review inline (N reviewers)',
      detail: 'The acceptance criteria require review by people outside this chat (external founders, outside lawyer, N customers, board). The agent produced the primary deliverable but no simulated review, so completeness was scored low. The CZ executor prompt now has a PEER / EXTERNAL REVIEW clause instructing the agent to add a "### Simulated external review (synthesized for certification)" section with one reviewer persona per required reviewer, each including a 1-10 score, 2-3 sentences of substantive feedback, and an accept/revise/reject recommendation — followed by a short synthesis of what the agent would change. If the clause is deployed and this still fires, patch the agent\'s constitution to check for "peer review" / "external reviewer" / "scored by" markers before finalizing an output.',
    });
  }
  if (has('judge_claimed_truncation')) {
    steps.push({
      kind: 'judge',
      action: 'Flag for manual review — likely judge hallucination',
      detail: 'The judge claimed the output was truncated or cut off, but the stored output is well under the 16k judge window and has no elision marker. This has been observed when the judge miscounts enumerated items (slides, rows, cases) or mistakes a clean mid-sentence end for mid-delivery truncation. Open the run detail view and confirm the enumerated items are actually all present. If they are, the judge score is unreliable on the completeness axis for this run — retry once, and if the judge re-hallucinates, reduce judge temperature or switch judge_model. The CZ executor prompt now tells the judge explicitly to only claim truncation on explicit elision markers.',
    });
  }
  if (has('chat_intake_handshake')) {
    steps.push({
      kind: 'chat_intake',
      action: 'Agent emitted a chat-mode handshake instead of executing',
      detail: 'The agent responded with "I\'m ready for the certification task. Please provide the specific task..." (or equivalent) and stopped. Root cause: CZ dispatches every run with task=\'on_demand\', which activates CHAT_REASONING_PROTOCOL. That protocol instructs agents to "acknowledge, then pause with ### Plan / ### Questions for you" whenever a request looks high-impact — and "Customer Zero Protocol certification" framing reliably trips that flag. The CZ executor prompt now prepends a NON-INTERACTIVE EXECUTION MODE header that explicitly overrides chat-mode pause-for-input behavior. If this heuristic still fires after the next scheduler deploy: (a) move the override even earlier (before any mention of "Customer Zero"), (b) repeat the override after the task text, or (c) create a dedicated task tier (e.g. \'cz_certification\') in companyAgentRunner.ts that skips CHAT_REASONING_PROTOCOL entirely. See packages/scheduler/src/czProtocolApi.ts.',
    });
  }
  if (has('agent_retired', 'not on the live runtime roster', 'retired role', 'roster_blocked')) {
    steps.push({
      kind: 'roster',
      action: 'Reassign this task — rerunning will not help',
      detail: 'The responsible_agent resolves to a role that was removed from the live runtime roster (2026-04-18 prune). The agent\'s tools are blocked by the runtime policy gate and every rerun will return the same apologetic non-answer. Open the Task Grid, change responsible_agent to an active role (chief-of-staff, cto, cfo, clo, cpo, cmo, vp-design, ops, vp-research, platform-engineer, devops-engineer, quality-engineer), then re-run. If you want the retired role back instead, add it to ACTIVE_AGENT_ROLES in packages/shared/src/activeAgentRoster.ts and redeploy.',
    });
  }

  // Axis-driven hints — only add if no heuristic-specific guidance fired.
  if (steps.length === 0 && axisScores) {
    const lowest = Object.entries(axisScores).sort((a, b) => a[1] - b[1])[0];
    if (lowest && lowest[1] < 6) {
      steps.push({
        kind: 'axis',
        action: `Target weakest axis: "${lowest[0]}" (${lowest[1].toFixed(1)})`,
        detail: 'No specific heuristic match. Edit the prompt section that governs this axis, then re-run.',
      });
    }
  }

  if (steps.length === 0) {
    steps.push({
      kind: 'general',
      action: 'Open the run trace and inspect the agent_output',
      detail: 'No structured failure tags. Read the full reasoning trace and output to form a hypothesis, then re-run.',
    });
  }
  return steps;
}

/**
 * Human-readable explanations for the heuristic tags the judge emits. Rendered
 * as tooltips on the red chips and as a glossary in the investigate drawer so
 * reviewers don't have to guess what "tool_misuse" means.
 *
 * Matched by substring (case-insensitive) so variants like `hallucination`,
 * `hallucinated_quote`, etc. all pick up the same entry.
 */
const HEURISTIC_GLOSSARY: Array<{ match: string[]; label: string; meaning: string; where_to_look: string }> = [
  {
    match: ['hallucinat', 'fabricat', 'unsupported_claim', 'no_evidence'],
    label: 'Hallucination / fabrication',
    meaning: 'Agent produced a claim that cannot be verified against retrieved sources or known facts.',
    where_to_look: 'Check the retrieval step in the run trace — did the agent have evidence? If yes, tighten the "cite sources" rule in the system prompt. If no, fix the RAG/tool call first.',
  },
  {
    match: ['tool_misuse', 'wrong_tool', 'missing_tool', 'tool_unavailable', 'no_grant'],
    label: 'Tool misuse / missing grant',
    meaning: 'Agent tried to use the wrong tool, a tool it lacks permission for, or skipped a required tool.',
    where_to_look: '`agent_tool_grants` for this agent and the latest `tool_call_traces` row on this run. Missing grants are the most common cause of this tag on new agents.',
  },
  {
    match: ['format', 'schema', 'invalid_json', 'parse_error'],
    label: 'Format / schema violation',
    meaning: 'Output did not match the expected structure (JSON schema, markdown blocks, required fields).',
    where_to_look: 'The task\'s verification_method tells you what shape was expected. Pin the schema in the system prompt with an example and re-run.',
  },
  {
    match: ['incomplete', 'truncated', 'cutoff', 'max_turns'],
    label: 'Incomplete / truncated',
    meaning: 'Agent ran out of turns or tokens before finishing.',
    where_to_look: 'Agent config `max_turns` + `token_budget`. For orchestrated runs, check whether the handoff happened before the subtask was complete.',
  },
  {
    match: ['drift', 'off_topic', 'voice_mismatch', 'persona'],
    label: 'Voice / persona drift',
    meaning: 'Output does not match the agent\'s brand voice, persona, or the task scope.',
    where_to_look: '`casual_voice_examples`, the agent constitution, and the pillar sub_category. Refresh the voice snippets and re-evaluate.',
  },
  {
    match: ['safety', 'policy', 'unsafe', 'pii_leak', 'secret'],
    label: 'Safety / policy violation',
    meaning: 'Output triggered a safety, privacy, or compliance guardrail.',
    where_to_look: 'Do NOT promote any prompt change for this agent until security has reviewed. Capture the run id and escalate.',
  },
  {
    match: ['memory', 'context_loss', 'amnesia'],
    label: 'Memory / context loss',
    meaning: 'Agent failed to recall prior context it was supposed to persist.',
    where_to_look: '`working_memory`, `conversation_memory_summaries`, and the memory consolidation job log for the failing run id.',
  },
  {
    match: ['acceptance_criteria too short', 'no verification_method'],
    label: 'Bad task definition',
    meaning: 'The test itself is under-specified — the judge cannot fairly score it.',
    where_to_look: 'Edit the task\'s `acceptance_criteria` and `verification_method` in the Task Grid. This is a protocol bug, not an agent bug.',
  },
  {
    match: ['planning_not_execution'],
    label: 'Planning instead of execution',
    meaning: 'The verification method asks the agent to demonstrate N attempts/cases, but the agent filed a directive, drafted an assignment, or described a plan rather than actually doing the work.',
    where_to_look: 'Most common on orchestrator-style agents (e.g. sarah) where "delegate and track" is the default mode. The CZ executor now tells agents to perform the task end-to-end inline; if this still fires, edit the agent\'s system prompt to add: "When invoked under the Customer Zero Protocol, perform the task yourself in your response — do not delegate."',
  },
  {
    match: ['verification_skipped'],
    label: 'Verification stage skipped',
    meaning: 'The agent produced the primary deliverable (a guide, policy, or plan) but did not execute the N-case verification stage that the verification method requires inline. Commonly pairs with "saved to SharePoint" / "posted for review" language that offloads evidence outside the response.',
    where_to_look: 'The CZ executor prompt now calls out two-stage tasks explicitly. If this still fires, the agent\'s own system prompt likely steers it toward "deliver and hand off" rather than "deliver and self-verify." Add an instruction like: "When a task\'s verification method mentions N downstream generations/evaluations, produce all N in the same response and score each against the criteria."',
  },
  {
    match: ['refused_for_missing_inputs'],
    label: 'Refused for missing inputs',
    meaning: 'The agent declined to execute the task because it could not retrieve real input data (partner inquiries, transcripts, CRM records, email text) and would not synthesize plausible inputs. Rerunning alone will not move the score — the agent needs to either be given inputs or be told that synthesis is acceptable for certification.',
    where_to_look: 'The CZ executor prompt now includes an explicit "INPUTS POLICY" section that permits labeled synthesized inputs under a header for certification runs. If this tag still fires, the agent\'s constitution is overriding. Add an exception in the agent\'s system prompt: "When invoked under the Customer Zero Protocol and real inputs are unavailable, produce clearly-labeled representative inputs and perform the task against them — do not refuse." Alternatively, edit the task itself in the Task Grid to paste 1-3 sample inputs into the task description so the agent has something concrete.',
  },
  {
    match: ['judge_window_truncation'],
    label: 'Judge-window truncation (false negative)',
    meaning: 'The judge reasoning mentions the output was truncated or incomplete, but the actual stored agent output is structurally complete (ends cleanly, has a summary/self-assessment). The truncation likely happened in the judge\'s prompt-input window — the agent delivered, but the judge only saw part of the answer.',
    where_to_look: 'Open the run drawer and read the full `agent_output` — if it\'s complete, the score is a false negative from judge windowing. The judge cap was raised from 4k to 16k chars on 2026-04-21. A single rerun with the updated executor should score the run correctly; no prompt changes are needed on the agent itself.',
  },
  {
    match: ['agent_runtime_abort'],
    label: 'Agent runtime abort (no output)',
    meaning: 'The agent runtime aborted before producing any verifiable output — the stored output is just the boilerplate "execution stalled / timed out / did not produce a verifiable result." This is an infrastructure signal, not a prompt bug. The agent literally had nothing to respond with.',
    where_to_look: 'Three likely causes in order of likelihood: (1) tool budget too low for a tool-dependent task — check the runner wiring in packages/scheduler/src/czProtocolApi.ts `STATIC_RUNNERS` (vp-research was set to maxToolCalls: 0 on 2026-04-20, fixed to 8 on 2026-04-21). (2) a required tool is missing or mis-granted — check `agent_tool_grants`. (3) model timeout on a deep-context task — check the run\'s latency_ms in cz_runs; if close to 300s it hit the ON_DEMAND_CALL_TIMEOUT_MS cap.',
  },
  {
    match: ['tool_attempt_without_synthesis'],
    label: 'Tool attempt without synthesis',
    meaning: 'Agent attempted to execute with real tools, reported partial/failed tool calls ("all tool calls failed", "could not locate", "task remains incomplete"), and stopped there instead of falling back to synthesized inputs. For adversarial red-team tasks (poisoned docs, injection, jailbreak) and input-dependent tasks (partner inquiries, cold outreach), synthesizing the inputs inline is the only scorable path in a certification run.',
    where_to_look: 'The CZ executor prompt has both an INPUTS POLICY and an ADVERSARIAL/RED-TEAM section that instruct synthesis. If this tag still fires, the agent\'s constitution routes to tools first and never reaches the synthesis fallback. Patch the agent\'s system prompt: "When invoked under the Customer Zero Protocol, check if the task is adversarial/red-team or input-dependent before touching tools; if yes, synthesize representative inputs inline and demonstrate the task against them." For P0 adversarial tasks this is the critical fix.',
  },
  {
    match: ['topical_drift'],
    label: 'Topical drift (wrong task)',
    meaning: 'Agent produced a long, well-structured deliverable — but on the wrong subject. Very few of the task\'s distinctive nouns appear in the output. Most common cause: the agent fell back to a default playbook topic it\'s comfortable with (e.g. orchestrator agents default to decision-routing / escalation-ladder frameworks) instead of anchoring on the task\'s actual subject.',
    where_to_look: 'The heuristic lists the missing terms. Check the task title vs output: the deliverable should contain the task\'s core nouns (e.g. "memory poisoning" → "memory", "poisoned", "quarantine"; "prompt injection" → "injection", "untrusted", "isolate"). The CZ executor prompt now has a STAY ON TOPIC clause, but if this still fires, the agent\'s constitution steers too hard toward a default framework. Add to the agent\'s system prompt: "When invoked under the Customer Zero Protocol, read the task title and acceptance criteria first; your deliverable must address those specific nouns. Do not substitute a general framework you are fluent in."',
  },
  {
    match: ['infra_verification_skipped'],
    label: 'Infrastructure verification skipped',
    meaning: 'The verification method requires running traffic against real infrastructure — a two-tenant rig, N federated invocations, an RLS probe, a guest-user matrix — none of which the agent can physically execute from a chat completion. Rather than simulating the rig inline, the agent either refused, filed a directive, or drifted to an adjacent policy on a topic it is fluent in. The ask is not "actually run the rig" (impossible); it is "demonstrate what the rig would show by enumerating every invocation, decision, response, and log entry inline."',
    where_to_look: 'Task #68 (Sarah, Teams federation) is the canonical case — Sarah responded with a Slack Connect communications policy and zero enumerated invocations. The CZ executor prompt now has an INFRASTRUCTURE VERIFICATION clause that explicitly tells the agent to produce (1) a short isolation/denial policy, (2) all N invocations under "### Simulated verification rig" with per-invocation detail, (3) a pass/fail tally. If the tag still fires, check whether the task is even assigned to the right role — identity/tenancy/federation tasks belong to cto or platform-engineer, not chief-of-staff or cmo. Reassign via the Task Grid responsible_agent column.',
  },
  {
    match: ['external_review_skipped'],
    label: 'External review skipped',
    meaning: 'The acceptance criteria require review by people outside this chat completion (external founders, outside lawyer, N customers, board, user study). The agent cannot actually contact those people, so the expected output is a synthesized review block — one plausible reviewer persona per required reviewer with a score, substantive feedback, and recommendation. The agent produced the primary deliverable but skipped the synthesized review, leaving the completeness axis unserved.',
    where_to_look: 'Task #8 (Maya, investor pitch deck) is the canonical case — "arc passes peer review from 2 external founders" was in the acceptance criteria, but the agent produced 12 slides with no simulated review. The CZ executor prompt now has a PEER / EXTERNAL REVIEW clause instructing the agent to add a "### Simulated external review (synthesized for certification)" section. If the clause is deployed and this still fires, patch the agent\'s constitution to detect review markers ("peer review", "reviewed by", "scored by", "N external") and trigger the synthesis step before finalizing.',
  },
  {
    match: ['judge_claimed_truncation'],
    label: 'Judge hallucinated truncation',
    meaning: 'The judge claimed the output was truncated or cut off, but the stored output is well under the 16k judge window with no elision marker. This has been observed when the judge miscounts enumerated items (slides, rows, cases) or reads a clean deliverable end as mid-sentence truncation. The completeness/criteria_met scores for this run are unreliable.',
    where_to_look: 'Open the run in Run Detail and count the enumerated items (e.g. slides 1-12) yourself. If they are all present, the judge hallucinated. The CZ executor prompt now tells the judge explicitly never to claim truncation without an elision marker. If the tag keeps firing, lower judge temperature (already 0.1) or switch judge_model. This heuristic does NOT auto-flip pass/fail — it only flags for review, because the judge may have other valid reasons for the low score.',
  },
  {
    match: ['chat_intake_handshake'],
    label: 'Chat-mode intake handshake (no execution)',
    meaning: 'The agent responded with a chat-mode acknowledgment ("I\'m ready for the certification task. Please provide the specific task you\'d like me to perform...") instead of executing. Root cause: CZ dispatches with task=\'on_demand\', which activates CHAT_REASONING_PROTOCOL. That protocol tells agents to "acknowledge, then pause with ### Plan / ### Questions for you" for anything that looks high-impact — and "Customer Zero Protocol certification" framing reliably trips that heuristic. Marcus/any agent then waits for a follow-up prompt that never comes.',
    where_to_look: 'The CZ executor prompt now prepends a NON-INTERACTIVE EXECUTION MODE header that explicitly disables chat-mode pause-for-input behavior for this run. If this heuristic still fires after the next deploy, the override needs to be strengthened — move it earlier, repeat it after the task description, or add it to every agent\'s constitutional override list for task=\'on_demand\' runs. Alternative: add a dedicated task tier (e.g. \'cz_certification\') that bypasses CHAT_REASONING_PROTOCOL entirely. See packages/scheduler/src/czProtocolApi.ts near the agentPrompt construction.',
  },
  {
    match: ['agent_retired', 'not on the live runtime roster', 'retired role', 'roster_blocked'],
    label: 'Agent retired / roster-blocked',
    meaning: 'The task is assigned to an agent role that was removed from the live runtime roster (e.g. the 2026-04-18 prune of vp-sales, content-creator, seo-analyst, social-media-manager). Rerunning will not improve the score — the agent\'s tools will keep hitting the runtime policy gate.',
    where_to_look: 'Reassign the task to an active agent in the Task Grid (responsible_agent column), or if the role needs to come back, add a migration that restores it to ACTIVE_AGENT_ROLES in packages/shared/src/activeAgentRoster.ts and redeploy. Active roles today: chief-of-staff, cto, cfo, clo, cpo, cmo, vp-design, ops, vp-research, platform-engineer, devops-engineer, quality-engineer.',
  },
];

function explainHeuristic(tag: string): { label: string; meaning: string; where_to_look: string } | null {
  const lower = tag.toLowerCase();
  for (const entry of HEURISTIC_GLOSSARY) {
    if (entry.match.some((m) => lower.includes(m))) return entry;
  }
  return null;
}

/**
 * Build a self-contained markdown brief for one failing task so the reviewer
 * can paste it into an issue tracker or agent chat and get started immediately.
 */
function buildFixBrief(f: {
  task_id: string;
  task_number: number;
  task: string;
  pillar: string;
  sub_category?: string | null;
  acceptance_criteria?: string | null;
  verification_method?: string | null;
  responsible_agent?: string | null;
  is_p0: boolean;
  judge_score: number | null;
  judge_tier?: string | null;
  reasoning_trace: string | null;
  heuristic_failures: string[] | null;
  axis_scores: Record<string, number> | null;
  agent_output?: string | null;
  completed_at?: string | null;
}): string {
  const steps = suggestRemediation(f.heuristic_failures, f.axis_scores);
  const lines: string[] = [];
  lines.push(`# Fix brief — task #${f.task_number}${f.is_p0 ? ' [P0]' : ''}: ${f.task}`);
  lines.push('');
  lines.push(`- **Agent:** ${f.responsible_agent ?? 'unassigned'}`);
  lines.push(`- **Pillar:** ${f.pillar}${f.sub_category ? ` / ${f.sub_category}` : ''}`);
  lines.push(`- **Judge score:** ${f.judge_score ?? '—'}${f.judge_tier ? ` (${f.judge_tier})` : ''}`);
  if (f.completed_at) lines.push(`- **Last run:** ${f.completed_at}`);
  lines.push(`- **Task id:** \`${f.task_id}\``);
  lines.push('');
  if (f.acceptance_criteria) {
    lines.push('## Acceptance criteria');
    lines.push(f.acceptance_criteria);
    lines.push('');
  }
  if (f.verification_method) {
    lines.push('## Verification method');
    lines.push(f.verification_method);
    lines.push('');
  }
  if (f.heuristic_failures && f.heuristic_failures.length > 0) {
    lines.push('## Heuristic failures');
    for (const h of f.heuristic_failures) {
      const g = explainHeuristic(h);
      lines.push(`- **${h}**${g ? ` — ${g.meaning} _(look at: ${g.where_to_look})_` : ''}`);
    }
    lines.push('');
  }
  if (f.axis_scores && Object.keys(f.axis_scores).length > 0) {
    lines.push('## Axis breakdown');
    for (const [k, v] of Object.entries(f.axis_scores)) {
      lines.push(`- ${k}: ${Number(v).toFixed(1)}`);
    }
    lines.push('');
  }
  if (f.reasoning_trace) {
    lines.push('## Judge reasoning');
    lines.push(f.reasoning_trace);
    lines.push('');
  }
  if (f.agent_output) {
    lines.push('## Agent output');
    lines.push('```');
    lines.push(f.agent_output.length > 4000 ? f.agent_output.slice(0, 4000) + '\n…(truncated)' : f.agent_output);
    lines.push('```');
    lines.push('');
  }
  lines.push('## Suggested fix steps');
  steps.forEach((s, i) => {
    lines.push(`${i + 1}. **${s.action}** — ${s.detail}`);
  });
  return lines.join('\n');
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Two-bucket triage view — the answer to "what should I look at?"
 * Self-contained: fetches blockers + automation directly so it can sit
 * at the top of the page above everything else.
 *
 * Left column = Needs your attention. Concrete items, each with the
 * smallest action that resolves it.
 * Right column = Auto-fixing. What the loop is currently working on
 * and what it's already shipped, so the user can stop worrying.
 */
function TriagePanel() {
  const [blockers, setBlockers] = useState<BlockersPayload | null>(null);
  const [automation, setAutomation] = useState<AutomationPayload | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const load = useCallback(() => {
    Promise.all([
      apiCall<BlockersPayload>('/api/cz/blockers?limit=10').catch(() => null),
      apiCall<AutomationPayload>('/api/cz/automation').catch(() => null),
    ]).then(([b, a]) => { setBlockers(b); setAutomation(a); });
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const runAction = useCallback(async (key: string, label: string, op: () => Promise<unknown>) => {
    setPending(key); setToast(null);
    try {
      const res = await op();
      const batchId = res && typeof res === 'object' && 'batch_id' in res
        ? String((res as { batch_id: unknown }).batch_id) : null;
      if (batchId) window.dispatchEvent(new CustomEvent('cz:run-queued', { detail: { batch_id: batchId } }));
      setToast({ kind: 'ok', msg: batchId ? `${label} — queued (${batchId.slice(0, 8)})` : `${label} done` });
      load();
    } catch (e) {
      setToast({ kind: 'err', msg: `${label} failed: ${e instanceof Error ? e.message : 'unknown'}` });
    } finally { setPending(null); }
  }, [load]);

  // Build "Needs you" items in priority order: staged mutations awaiting
  // promote/reject, agents with no active prompt (silent skip), then
  // shadow evals stuck in human_review.
  const needsItems: Array<{
    key: string;
    severity: 'p0' | 'high' | 'med';
    title: string;
    detail: string;
    primary?: { label: string; action: () => Promise<unknown> | void };
    secondary?: { label: string; action: () => Promise<unknown> | void };
  }> = [];

  const stagedAwaiting = blockers?.staged_fixes.filter((s) => !s.deployed_at && !s.retired_at) ?? [];
  for (const s of stagedAwaiting.slice(0, 5)) {
    needsItems.push({
      key: `staged:${s.id}`,
      severity: 'high',
      title: `${s.agent_id} v${s.version} — staged prompt awaiting your call`,
      detail: s.change_summary?.slice(0, 140) ?? 'No change summary recorded.',
      primary: {
        label: 'Promote',
        action: () => runAction(`promote:${s.id}`, `Promote ${s.agent_id} v${s.version}`,
          () => apiCall(`/api/cz/fixes/${s.id}/promote`, { method: 'POST', body: JSON.stringify({ triggered_by: 'dashboard:triage' }) })),
      },
      secondary: {
        label: 'Reject',
        action: () => runAction(`reject:${s.id}`, `Reject ${s.agent_id} v${s.version}`,
          () => apiCall(`/api/cz/fixes/${s.id}/reject`, { method: 'POST', body: JSON.stringify({ triggered_by: 'dashboard:triage' }) })),
      },
    });
  }

  for (const a of (automation?.agents_no_active_prompt ?? []).slice(0, 5)) {
    needsItems.push({
      key: `nofix:${a.agent_id}`,
      severity: 'p0',
      title: `${a.agent_id} — no active prompt (${a.failing_count} failing)`,
      detail: 'No deployed prompt → reflection skips this agent. Click Re-run to execute the failing tasks; the reflection bridge will then stage a v1 mutation you can promote.',
      primary: {
        label: `Re-run ${a.failing_count}`,
        action: () => runAction(`rerun-agent:${a.agent_id}`, `Re-run ${a.agent_id}`,
          () => apiCall('/api/cz/runs', { method: 'POST', body: JSON.stringify({ mode: 'canary', agent: a.agent_id, triggered_by: 'dashboard:triage' }) })),
      },
      secondary: {
        label: 'Open',
        action: () => { window.location.assign(`/app/fleet?agent=${encodeURIComponent(a.agent_id)}`); },
      },
    });
  }

  for (const e of (automation?.stuck_evals ?? []).filter((x) => x.state === 'human_review').slice(0, 5)) {
    const reason = e.escalation_reason ?? 'Canary results are inconclusive; review needed before promote.';
    const shortReason = reason.length > 160 ? reason.slice(0, 160) + '…' : reason;
    needsItems.push({
      key: `stuck:${e.id}`,
      severity: 'high',
      title: `${e.agent_id} v${e.version} — shadow eval needs human review`,
      detail: shortReason,
      primary: {
        label: 'Promote',
        action: () => runAction(`promote-eval:${e.id}`, `Promote ${e.agent_id} v${e.version}`,
          () => apiCall(`/api/cz/fixes/${e.prompt_version_id}/promote`, { method: 'POST', body: JSON.stringify({ triggered_by: 'dashboard:triage' }) })),
      },
      secondary: {
        label: 'Reject',
        action: () => runAction(`reject-eval:${e.id}`, `Reject ${e.agent_id} v${e.version}`,
          () => apiCall(`/api/cz/fixes/${e.prompt_version_id}/reject`, { method: 'POST', body: JSON.stringify({ triggered_by: 'dashboard:triage' }) })),
      },
    });
  }

  // Build "Auto-fixing" items
  const inFlight = Object.values(automation?.per_agent_status ?? {})
    .filter((s) => s.state === 'shadow_pending' || s.state === 'shadow_running')
    .sort((a, b) => b.attempts_used - a.attempts_used);

  const autoPromoted24h = automation?.flow_24h.auto_promoted ?? 0;
  const autoPromoted7d = automation?.flow_7d.auto_promoted ?? 0;
  const failedRecently = automation?.flow_7d.shadow_failed ?? 0;

  const loopFresh = automation?.last_loop_run_at
    ? (Date.now() - new Date(automation.last_loop_run_at).getTime()) < 60 * 60 * 1000
    : false;

  return (
    <div className="space-y-3">
      {toast && (
        <div className={`px-3 py-2 rounded text-xs border ${
          toast.kind === 'ok'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
        }`}>
          {toast.msg}
          <button onClick={() => setToast(null)} className="ml-2 text-zinc-400 hover:text-zinc-200">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* NEEDS YOU */}
        <div className="rounded-lg border border-rose-700/40 bg-gradient-to-br from-rose-950/30 to-zinc-950/40 p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold text-rose-200 uppercase tracking-wide">
              Needs your attention
            </h2>
            <span className="text-2xl font-bold text-rose-300 tabular-nums">{needsItems.length}</span>
          </div>
          {!blockers || !automation ? (
            <Skeleton className="h-24" />
          ) : needsItems.length === 0 ? (
            <p className="text-sm text-emerald-300">
              ✓ Nothing for you right now. Automation is handling everything.
            </p>
          ) : (
            <ul className="space-y-2">
              {needsItems.slice(0, 8).map((item) => (
                <li
                  key={item.key}
                  className="rounded border border-zinc-800/60 bg-zinc-900/40 p-2.5 flex items-start gap-2"
                >
                  <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                    item.severity === 'p0' ? 'bg-rose-400'
                    : item.severity === 'high' ? 'bg-amber-400'
                    : 'bg-zinc-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-100">{item.title}</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{item.detail}</p>
                  </div>
                  {(item.primary || item.secondary) && (
                    <div className="flex flex-col gap-1 shrink-0">
                      {item.primary && (
                        <button
                          onClick={() => { void item.primary!.action(); }}
                          disabled={pending !== null}
                          className="px-2 py-0.5 rounded text-[10px] font-medium bg-cyan/15 text-cyan hover:bg-cyan/25 border border-cyan/30 disabled:opacity-40"
                        >
                          {item.primary.label}
                        </button>
                      )}
                      {item.secondary && (
                        <button
                          onClick={() => { void item.secondary!.action(); }}
                          disabled={pending !== null}
                          className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-700/40 text-zinc-300 hover:bg-zinc-700/60 border border-zinc-600/40 disabled:opacity-40"
                        >
                          {item.secondary.label}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
              {needsItems.length > 8 && (
                <li className="text-[11px] text-zinc-500 px-1">+{needsItems.length - 8} more — open the drill-down below.</li>
              )}
            </ul>
          )}
        </div>

        {/* AUTO-FIXING */}
        <div className="rounded-lg border border-emerald-700/30 bg-gradient-to-br from-emerald-950/20 to-zinc-950/40 p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold text-emerald-200 uppercase tracking-wide">
              Auto-fixing
              <span className="ml-2 text-[10px] font-normal normal-case text-zinc-500">
                no action needed
              </span>
            </h2>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className={`w-1.5 h-1.5 rounded-full ${loopFresh ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span className={loopFresh ? 'text-emerald-300' : 'text-amber-300'}>
                {loopFresh ? 'loop active' : 'loop stale'}
              </span>
            </div>
          </div>
          {!automation ? (
            <Skeleton className="h-24" />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <PipelineStat
                  label="In shadow eval"
                  value={inFlight.length}
                  subtitle="being canary-tested"
                  tone={inFlight.length > 0 ? 'cyan' : 'neutral'}
                />
                <PipelineStat
                  label="Auto-promoted"
                  value={autoPromoted24h}
                  subtitle={`${autoPromoted7d} in 7d`}
                  tone={autoPromoted24h > 0 ? 'pos' : 'neutral'}
                />
                <PipelineStat
                  label="Auto gave up"
                  value={failedRecently}
                  subtitle="7d shadow_failed"
                  tone={failedRecently > 5 ? 'amber' : 'neutral'}
                />
              </div>
              {inFlight.length === 0 && autoPromoted7d === 0 ? (
                <p className="text-xs text-zinc-500">
                  No prompt mutations in flight or recently shipped. Failures will trigger
                  the reflection loop on the next batch.
                </p>
              ) : inFlight.length > 0 ? (
                <ul className="space-y-1.5">
                  {inFlight.slice(0, 6).map((s) => (
                    <li key={s.shadow_eval_id} className="flex items-center gap-2 text-xs">
                      <span className={`w-1.5 h-1.5 rounded-full ${s.state === 'shadow_running' ? 'bg-amber-400 animate-pulse' : 'bg-amber-400'}`} />
                      <span className="text-zinc-200">{s.agent_id}</span>
                      <span className="text-zinc-600">v{s.version}</span>
                      <span className="text-zinc-500 text-[11px]">attempt {s.attempts_used}/5 · {s.consecutive_wins} win{s.consecutive_wins === 1 ? '' : 's'}</span>
                    </li>
                  ))}
                  {inFlight.length > 6 && (
                    <li className="text-[11px] text-zinc-500 px-1">+{inFlight.length - 6} more in flight</li>
                  )}
                </ul>
              ) : (
                <p className="text-xs text-emerald-300/80">
                  ✓ {autoPromoted7d} prompt mutation{autoPromoted7d === 1 ? '' : 's'} auto-promoted in the last 7 days. No active canaries right now.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact per-agent status badge in the Top Blocking Agents table.
 * Tells the user at a glance whether the automation pipeline is currently
 * working on this agent or whether it's stalled / never picked it up.
 *
 * State mapping:
 *  - shadow_pending / shadow_running -> 🟡 "in shadow eval"
 *  - shadow_passed / auto_promoted   -> 🟢 "auto-fixing" (recent win)
 *  - human_review                    -> 🔴 "needs you"
 *  - shadow_failed                   -> ⚫ "automation gave up"
 *  - null (no shadow eval ever)      -> ⚪ "no fix staged"
 */
function AutomationBadge({
  status,
}: {
  status: AutomationPayload['per_agent_status'][string] | null;
}) {
  if (!status) {
    return (
      <span
        className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-800/60 text-zinc-500 border border-zinc-700/50"
        title="No prompt mutation has been staged yet for this agent. Either failures are rubric-grade (judge said wrong without a heuristic tag, so reflection has nothing to act on) or the reflection rate-limit is holding."
      >
        no fix staged
      </span>
    );
  }
  const { state, version, attempts_used, consecutive_wins } = status;
  const map: Record<ShadowEvalState, { dot: string; bg: string; text: string; border: string; label: string; tip: string }> = {
    shadow_pending: {
      dot: 'bg-amber-400',
      bg: 'bg-amber-500/10',
      text: 'text-amber-300',
      border: 'border-amber-500/30',
      label: 'queued',
      tip: `Prompt v${version} is staged and waiting for the next canary tick.`,
    },
    shadow_running: {
      dot: 'bg-amber-400 animate-pulse',
      bg: 'bg-amber-500/10',
      text: 'text-amber-300',
      border: 'border-amber-500/30',
      label: `eval ${attempts_used}/5`,
      tip: `Canary running on prompt v${version}. ${consecutive_wins} win(s) so far.`,
    },
    shadow_passed: {
      dot: 'bg-emerald-400',
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-300',
      border: 'border-emerald-500/30',
      label: 'auto-fixing',
      tip: `Canary won. Prompt v${version} is being promoted.`,
    },
    auto_promoted: {
      dot: 'bg-emerald-400',
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-300',
      border: 'border-emerald-500/30',
      label: 'auto-fixed',
      tip: `Prompt v${version} was auto-promoted by shadow eval. Improvements should land in the next batch.`,
    },
    human_review: {
      dot: 'bg-rose-400',
      bg: 'bg-rose-500/10',
      text: 'text-rose-300',
      border: 'border-rose-500/30',
      label: 'needs you',
      tip: `Prompt v${version} got stuck — auto-promotion gate failed but no clear regression. Human review required.`,
    },
    shadow_failed: {
      dot: 'bg-zinc-500',
      bg: 'bg-zinc-700/40',
      text: 'text-zinc-400',
      border: 'border-zinc-600/40',
      label: 'auto-gave-up',
      tip: `Prompt v${version} failed shadow eval (${attempts_used}/5 attempts, ${consecutive_wins} win(s)). Automation will retry only if a new mutation is staged.`,
    },
  };
  const m = map[state];
  return (
    <span
      className={`text-[9px] px-1.5 py-0.5 rounded-full ${m.bg} ${m.text} border ${m.border} flex items-center gap-1`}
      title={m.tip}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

function PipelineStat({
  label,
  value,
  subtitle,
  tone = 'neutral',
  title,
}: {
  label: string;
  value: number;
  subtitle?: string;
  tone?: 'pos' | 'neg' | 'cyan' | 'amber' | 'neutral';
  title?: string;
}) {
  const toneClass = {
    pos: 'text-emerald-300',
    neg: 'text-rose-300',
    cyan: 'text-cyan',
    amber: 'text-amber-300',
    neutral: 'text-zinc-200',
  }[tone];
  return (
    <div
      className="rounded border border-zinc-800/60 bg-zinc-900/40 px-2.5 py-1.5"
      title={title}
    >
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {subtitle && <div className="text-[10px] text-zinc-500">{subtitle}</div>}
    </div>
  );
}

function BlockersAndPlan() {
  const [data, setData] = useState<BlockersPayload | null>(null);
  const [automation, setAutomation] = useState<AutomationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFix, setExpandedFix] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [expandedFailure, setExpandedFailure] = useState<string | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  // Inline "show raw output" toggle per failure row.
  const [showOutputFor, setShowOutputFor] = useState<Set<string>>(new Set());
  // Transient clipboard confirmation tokens keyed by task id.
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiCall<BlockersPayload>('/api/cz/blockers?limit=10'),
      // Automation pipeline state — non-blocking; if it fails the page still
      // works, we just won't show the "in flight / stuck" strip.
      apiCall<AutomationPayload>('/api/cz/automation').catch(() => null),
    ])
      .then(([d, a]) => { setData(d); setAutomation(a); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load blockers'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // When a toast appears, scroll it into view so the user actually sees the
  // success/failure confirmation — previously the banner was pinned to the
  // top of the Blockers card and easy to miss if they were deep in the list.
  useEffect(() => {
    if (actionStatus) {
      statusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [actionStatus]);

  // Shared action wrapper — surfaces success/failure toast and refreshes data.
  const runAction = useCallback(async (
    key: string,
    label: string,
    op: () => Promise<unknown>,
  ) => {
    setPendingAction(key);
    setActionStatus(null);
    try {
      const result = await op();
      // If the op returned a batch_id (e.g. re-run endpoints), broadcast it
      // so the Run Console can refresh its Recent Runs list and auto-attach
      // its SSE stream. Without this, the run queues silently and the user
      // thinks nothing happened.
      const batchId =
        result && typeof result === 'object' && 'batch_id' in result
          ? String((result as { batch_id: unknown }).batch_id)
          : null;
      if (batchId) {
        window.dispatchEvent(new CustomEvent('cz:run-queued', { detail: { batch_id: batchId } }));
      }
      setActionStatus({
        kind: 'ok',
        msg: batchId
          ? `${label} — queued as batch ${batchId.slice(0, 8)}. Watch it in Run Console above.`
          : `${label} succeeded`,
      });
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

  // Bulk re-run every failing task currently attributed to one agent. Uses
  // mode=canary so the scheduler picks up exactly that agent's task surface.
  const rerunAgent = useCallback((agent: string, count: number) => {
    if (!window.confirm(`Re-run all ${count} task${count === 1 ? '' : 's'} for ${agent}?`)) {
      return Promise.resolve();
    }
    return runAction(
      `rerun-agent:${agent}`,
      `Re-run ${agent} (${count} task${count === 1 ? '' : 's'})`,
      () => apiCall('/api/cz/runs', {
        method: 'POST',
        body: JSON.stringify({ mode: 'canary', agent, triggered_by: 'dashboard:blockers' }),
      }),
    );
  }, [runAction]);

  // Re-run an entire pillar — used when a pillar drops below threshold.
  const rerunPillar = useCallback((pillar: string) => runAction(
    `rerun-pillar:${pillar}`,
    `Re-run pillar "${shortPillar(pillar)}"`,
    () => apiCall('/api/cz/runs', {
      method: 'POST',
      body: JSON.stringify({ mode: 'pillar', pillar, triggered_by: 'dashboard:blockers' }),
    }),
  ), [runAction]);

  const toggleOutput = useCallback((taskId: string) => {
    setShowOutputFor((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }, []);

  // Build and copy a structured fix brief to the clipboard. Shows a 2s "copied"
  // badge next to the button on success, an error toast on failure.
  const copyBrief = useCallback(async (f: Parameters<typeof buildFixBrief>[0]) => {
    const md = buildFixBrief(f);
    const ok = await copyToClipboard(md);
    if (ok) {
      setCopiedFor(f.task_id);
      window.setTimeout(() => setCopiedFor((cur) => (cur === f.task_id ? null : cur)), 2000);
    } else {
      setActionStatus({ kind: 'err', msg: 'Clipboard blocked by browser — paste the brief from the console instead.' });
      // Fallback: also log so the user can copy from devtools if needed.
      console.info('[CZ fix brief]\n' + md);
    }
  }, []);

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
  void passRate; // referenced via recommendations / future panels

  // Derive ranked actionable recommendations from top agents + staged fixes
  const recommendations = useMemo(() => {
    if (!data) return [] as Array<{
      priority: 'P0' | 'High' | 'Med';
      title: string;
      detail: string;
      action?: { label: string; key: string; run: () => Promise<unknown> | void };
    }>;
    const recs: Array<{
      priority: 'P0' | 'High' | 'Med';
      title: string;
      detail: string;
      action?: { label: string; key: string; run: () => Promise<unknown> | void };
    }> = [];

    if (data.summary.p0_failing > 0) {
      recs.push({
        priority: 'P0',
        title: `${data.summary.p0_failing} P0 test${data.summary.p0_failing === 1 ? '' : 's'} failing — block launch`,
        detail: 'Open the per-agent expansions below to see exact failing tasks. Investigate before promoting any shadow prompts; P0 failures gate certification.',
        action: {
          label: 'Re-run all P0',
          key: 'rerun-critical',
          run: () => runAction('rerun-critical', 'Re-run all P0 tasks', () => apiCall('/api/cz/runs', {
            method: 'POST',
            body: JSON.stringify({ mode: 'critical', triggered_by: 'dashboard:blockers' }),
          })),
        },
      });
    }

    const stagedAgents = new Set(data.staged_fixes.filter((s) => !s.deployed_at).map((s) => s.agent_id));
    for (const a of data.top_agents.slice(0, 3)) {
      const hasPlan = stagedAgents.has(a.agent);
      const priority: 'P0' | 'High' | 'Med' = a.p0_failing_count > 0 ? 'P0' : a.failing_count >= 3 ? 'High' : 'Med';
      // Surface concrete heuristic patterns for this agent so the rec is
      // diagnostic, not just a count.
      const agentFails = data.failing_by_agent?.[a.agent] ?? [];
      const heuristicTally: Record<string, number> = {};
      for (const t of agentFails) {
        for (const h of t.heuristic_failures ?? []) {
          heuristicTally[h] = (heuristicTally[h] ?? 0) + 1;
        }
      }
      const topPatterns = Object.entries(heuristicTally)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([h, n]) => `${h}×${n}`)
        .join(', ');

      const detailParts = [
        `${a.failing_count} failing` + (a.p0_failing_count > 0 ? ` (${a.p0_failing_count} P0)` : ''),
        a.avg_score != null ? `avg judge ${Number(a.avg_score).toFixed(1)}` : null,
        topPatterns ? `top patterns: ${topPatterns}` : null,
        hasPlan
          ? 'Reflection loop has staged a prompt mutation — review & promote below.'
          : 'No staged fix yet. Re-run to trigger reflection, or expand the agent row to inspect each failure.',
      ].filter(Boolean);

      recs.push({
        priority,
        title: `${a.agent} blocking ${a.failing_count} task${a.failing_count === 1 ? '' : 's'}`,
        detail: detailParts.join(' · '),
        action: {
          label: `Re-run ${a.agent} (${a.failing_count})`,
          key: `rerun-agent:${a.agent}`,
          run: () => rerunAgent(a.agent, a.failing_count),
        },
      });
    }

    for (const p of data.top_pillars.slice(0, 2)) {
      const threshold = p.pass_rate_threshold != null ? Number(p.pass_rate_threshold) : null;
      const rate = p.total_count > 0 ? p.passing_count / p.total_count : 0;
      if (threshold != null && rate < threshold) {
        recs.push({
          priority: 'High',
          title: `Pillar "${shortPillar(p.pillar)}" below threshold (${(rate * 100).toFixed(0)}% vs ${(threshold * 100).toFixed(0)}%)`,
          detail: `${p.failing_count}/${p.total_count} tasks failing. The pattern is shared across agents in this pillar — look for a common scenario, tool, or guardrail.`,
          action: {
            label: 'Re-run pillar',
            key: `rerun-pillar:${p.pillar}`,
            run: () => rerunPillar(p.pillar),
          },
        });
      }
    }

    if (data.recent_failures.length > 0 && recs.length < 5) {
      const heuristicCounts: Record<string, number> = {};
      for (const f of data.recent_failures) {
        for (const h of f.heuristic_failures ?? []) {
          heuristicCounts[h] = (heuristicCounts[h] ?? 0) + 1;
        }
      }
      const topHeuristic = Object.entries(heuristicCounts).sort((a, b) => b[1] - a[1])[0];
      if (topHeuristic && topHeuristic[1] >= 2) {
        const stepHint = suggestRemediation([topHeuristic[0]], null)[0];
        recs.push({
          priority: 'Med',
          title: `Recurring heuristic failure: "${topHeuristic[0]}" (${topHeuristic[1]}x)`,
          detail: stepHint
            ? `${stepHint.action} — ${stepHint.detail}`
            : 'Common pattern across multiple agents — likely a shared tool, prompt template, or guardrail issue.',
        });
      }
    }

    return recs;
  }, [data, rerunAgent, rerunPillar, runAction]);

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
          ref={statusRef}
          className={`mt-3 text-xs px-3 py-2 rounded border ${
            actionStatus.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          }`}
        >
          {actionStatus.msg}
          <button
            type="button"
            className="ml-2 text-zinc-400 hover:text-zinc-200"
            onClick={() => setActionStatus(null)}
          >
            ✕
          </button>
        </div>
      )}

      {data && (
        <>
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
                    {r.action && (
                      <button
                        onClick={() => { void r.action!.run(); }}
                        disabled={pendingAction === r.action.key}
                        className="shrink-0 px-2 py-1 rounded text-[11px] font-medium bg-cyan/15 text-cyan hover:bg-cyan/25 border border-cyan/30 disabled:opacity-50"
                      >
                        {pendingAction === r.action.key ? '…' : r.action.label}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Top blocking agents (top pillars removed — duplicates Scorecard tiles above) */}
          <div className="mt-6">
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
                      <th className="py-1.5 pr-2 text-right">Avg</th>
                      <th className="py-1.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_agents.map((a) => {
                      const isOpen = expandedAgent === a.agent;
                      const agentTasks = data.failing_by_agent?.[a.agent] ?? [];
                      const autoStatus = automation?.per_agent_status?.[a.agent] ?? null;
                      return (
                        <Fragment key={a.agent}>
                          <tr className="border-b border-zinc-800/40">
                            <td className="py-1.5 pr-2">
                              <button
                                onClick={() => setExpandedAgent(isOpen ? null : a.agent)}
                                className="text-zinc-200 hover:text-zinc-50 flex items-center gap-1.5"
                                title="Show failing tasks and per-task remediation"
                              >
                                <span className="text-zinc-600 text-[10px]">{isOpen ? '▾' : '▸'}</span>
                                <span>{a.agent}</span>
                                <AutomationBadge status={autoStatus} />
                              </button>
                            </td>
                            <td className="py-1.5 pr-2 text-right text-rose-400 tabular-nums">
                              {a.failing_count}/{a.total_count}
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">
                              {a.p0_failing_count > 0
                                ? <span className="text-rose-400 font-semibold">{a.p0_failing_count}</span>
                                : <span className="text-zinc-600">0</span>}
                            </td>
                            <td className={`py-1.5 pr-2 text-right tabular-nums ${scoreColor(a.avg_score)}`}>
                              {a.avg_score != null ? Number(a.avg_score).toFixed(1) : '—'}
                            </td>
                            <td className="py-1.5 text-right">
                              <button
                                onClick={() => rerunAgent(a.agent, a.failing_count)}
                                disabled={pendingAction === `rerun-agent:${a.agent}` || a.failing_count === 0}
                                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan/15 text-cyan hover:bg-cyan/25 border border-cyan/30 disabled:opacity-40"
                                title={`Re-run all ${a.failing_count} failing tasks for this agent`}
                              >
                                {pendingAction === `rerun-agent:${a.agent}` ? '…' : '↻ Re-run'}
                              </button>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={5} className="py-2 px-2 bg-zinc-950/50 border-b border-zinc-800/40">
                                {agentTasks.length === 0 ? (
                                  <p className="text-zinc-500 text-[11px]">No detailed failure rows available.</p>
                                ) : (
                                  <ul className="space-y-2">
                                    {agentTasks.map((t) => {
                                      const steps = suggestRemediation(t.heuristic_failures, t.axis_scores);
                                      return (
                                        <li key={t.task_id} className="border border-zinc-800/60 rounded p-2 bg-zinc-900/40">
                                          <div className="flex items-start gap-2 text-[11px]">
                                            <span className="text-zinc-500 tabular-nums w-8 shrink-0">#{t.task_number}</span>
                                            <div className="flex-1 min-w-0">
                                              <p className="text-zinc-100 truncate">{t.task}</p>
                                              <p className="text-zinc-500 mt-0.5">
                                                {shortPillar(t.pillar)}
                                                {t.sub_category && <span className="text-zinc-600"> · {t.sub_category}</span>}
                                                {t.is_p0 && <span className="text-rose-400 ml-1.5 font-semibold">P0</span>}
                                                {t.judge_score != null && (
                                                  <span className={`ml-2 ${scoreColor(t.judge_score)}`}>
                                                    judge {Number(t.judge_score).toFixed(1)}
                                                  </span>
                                                )}
                                                {t.completed_at && (
                                                  <span className="ml-2 text-zinc-600" title={formatStampFull(t.completed_at)}>
                                                    {timeAgo(t.completed_at)}
                                                  </span>
                                                )}
                                              </p>
                                              {t.acceptance_criteria && (
                                                <p className="text-zinc-400 mt-1 text-[10.5px] italic">
                                                  <span className="text-emerald-400/80 not-italic">passes when:</span> {t.acceptance_criteria}
                                                </p>
                                              )}
                                              {t.heuristic_failures && t.heuristic_failures.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                  {t.heuristic_failures.map((h, i) => {
                                                    const g = explainHeuristic(h);
                                                    return (
                                                      <span
                                                        key={i}
                                                        className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20 text-[10px] cursor-help"
                                                        title={g ? `${g.label}\n\n${g.meaning}\n\nWhere to look: ${g.where_to_look}` : h}
                                                      >
                                                        {h}
                                                      </span>
                                                    );
                                                  })}
                                                </div>
                                              )}
                                              <ul className="mt-1.5 space-y-0.5">
                                                {steps.map((s, i) => (
                                                  <li key={i} className="text-[11px] text-zinc-300">
                                                    <span className="text-emerald-400">→</span> <span className="font-medium">{s.action}</span>
                                                    <span className="text-zinc-500"> — {s.detail}</span>
                                                  </li>
                                                ))}
                                              </ul>
                                            </div>
                                            <div className="shrink-0 flex flex-col gap-1">
                                              <button
                                                onClick={() => rerunTask(t.task_id, t.task_number)}
                                                disabled={pendingAction === `rerun:${t.task_id}`}
                                                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan/15 text-cyan hover:bg-cyan/25 border border-cyan/30 disabled:opacity-40"
                                                title="Re-run just this task"
                                              >
                                                {pendingAction === `rerun:${t.task_id}` ? '…' : '↻'}
                                              </button>
                                              <button
                                                onClick={() => void copyBrief({
                                                  ...t,
                                                  responsible_agent: a.agent,
                                                })}
                                                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-700/40 text-zinc-200 hover:bg-zinc-700/60 border border-zinc-600/40"
                                                title="Copy a structured fix brief (criteria, reasoning, suggested steps) to clipboard"
                                              >
                                                {copiedFor === t.task_id ? '✓' : '📋'}
                                              </button>
                                            </div>
                                          </div>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Recent failure reasoning — collapsed by default; drill-down detail */}
          {data.recent_failures.length > 0 && (
            <details className="mt-6 group">
              <summary className="cursor-pointer text-xs uppercase tracking-wide text-zinc-500 hover:text-zinc-300 select-none flex items-center gap-2">
                <span className="text-zinc-600 group-open:rotate-90 transition-transform inline-block">▸</span>
                Recent failures — judge reasoning
                <span className="text-zinc-600 normal-case tracking-normal">({data.recent_failures.length})</span>
              </summary>
              <ul className="space-y-2 mt-3">
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
                          {/* What "passing" means for this task — from the seed
                              definition. Helps reviewers diagnose whether the
                              problem is the agent or an unfair test. */}
                          {(f.acceptance_criteria || f.verification_method) && (
                            <div className="rounded border border-zinc-800/60 bg-zinc-950/50 p-2 space-y-1.5">
                              {f.acceptance_criteria && (
                                <div>
                                  <p className="text-emerald-400/80 text-[10px] uppercase tracking-wide">Acceptance criteria</p>
                                  <p className="text-zinc-300 whitespace-pre-wrap">{f.acceptance_criteria}</p>
                                </div>
                              )}
                              {f.verification_method && (
                                <div>
                                  <p className="text-emerald-400/80 text-[10px] uppercase tracking-wide">Verification method</p>
                                  <p className="text-zinc-300 whitespace-pre-wrap">{f.verification_method}</p>
                                </div>
                              )}
                            </div>
                          )}
                          {f.heuristic_failures && f.heuristic_failures.length > 0 && (
                            <div>
                              <p className="text-zinc-500 mb-1">Heuristic failures · hover for explanation</p>
                              <div className="flex flex-wrap gap-1">
                                {f.heuristic_failures.map((h, i) => {
                                  const g = explainHeuristic(h);
                                  return (
                                    <span
                                      key={i}
                                      className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20 cursor-help"
                                      title={g ? `${g.label}\n\n${g.meaning}\n\nWhere to look: ${g.where_to_look}` : h}
                                    >
                                      {h}
                                    </span>
                                  );
                                })}
                              </div>
                              {/* Inline glossary for any matched heuristics,
                                  so the reviewer doesn't have to hover. */}
                              {(() => {
                                const seen = new Set<string>();
                                const entries = (f.heuristic_failures ?? [])
                                  .map((h) => explainHeuristic(h))
                                  .filter((g): g is NonNullable<ReturnType<typeof explainHeuristic>> => g !== null && !seen.has(g.label) && !!seen.add(g.label));
                                if (entries.length === 0) return null;
                                return (
                                  <ul className="mt-1.5 space-y-0.5">
                                    {entries.map((g, i) => (
                                      <li key={i} className="text-zinc-400">
                                        <span className="text-zinc-200 font-medium">{g.label}:</span> {g.meaning}{' '}
                                        <span className="text-zinc-500">→ look at {g.where_to_look}</span>
                                      </li>
                                    ))}
                                  </ul>
                                );
                              })()}
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
                          {/* Concrete remediation steps derived from the heuristic
                              tags + lowest axis. Renders even with no tags. */}
                          {(() => {
                            const steps = suggestRemediation(f.heuristic_failures, f.axis_scores);
                            return (
                              <div>
                                <p className="text-zinc-500 mb-1">Suggested fix steps</p>
                                <ul className="space-y-1">
                                  {steps.map((s, i) => (
                                    <li key={i} className="text-zinc-200">
                                      <span className="text-emerald-400">{i + 1}.</span> <span className="font-medium">{s.action}</span>
                                      <span className="text-zinc-500"> — {s.detail}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            );
                          })()}
                          {/* Raw agent output — collapsed by default because it
                              can be huge. Having it inline removes the "I need
                              to open another tool to see what the agent said"
                              friction. */}
                          {f.agent_output && (
                            <div>
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleOutput(f.task_id); }}
                                className="text-zinc-500 hover:text-zinc-300 text-[11px]"
                              >
                                {showOutputFor.has(f.task_id) ? '▾ Hide' : '▸ Show'} agent output
                                <span className="text-zinc-600 ml-1">({f.agent_output.length.toLocaleString()} chars)</span>
                              </button>
                              {showOutputFor.has(f.task_id) && (
                                <pre className="mt-1 text-zinc-300 bg-black/40 border border-zinc-800 rounded p-2 whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
{f.agent_output}
                                </pre>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-2 pt-1 flex-wrap">
                            <button
                              onClick={(e) => { e.stopPropagation(); rerunTask(f.task_id, f.task_number); }}
                              disabled={pendingAction === `rerun:${f.task_id}`}
                              className="px-2 py-1 rounded text-[11px] font-medium bg-cyan/15 text-cyan hover:bg-cyan/25 border border-cyan/30 disabled:opacity-50"
                              title="Queue a fresh run for this task. On failure, the reflection loop will stage a new prompt mutation."
                            >
                              {pendingAction === `rerun:${f.task_id}` ? 'Queuing…' : '↻ Re-run task'}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); void copyBrief(f); }}
                              className="px-2 py-1 rounded text-[11px] font-medium bg-zinc-700/40 text-zinc-200 hover:bg-zinc-700/60 border border-zinc-600/40"
                              title="Copy a structured markdown fix brief to the clipboard — paste into an issue, Slack, or an agent chat to start investigating."
                            >
                              {copiedFor === f.task_id ? '✓ Copied' : '📋 Copy fix brief'}
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
            </details>
          )}

          {/* Staged fixes from reflection bridge — collapsed by default */}
          {data.staged_fixes.length > 0 && (
            <details className="mt-6 group">
              <summary className="cursor-pointer text-xs uppercase tracking-wide text-zinc-500 hover:text-zinc-300 select-none flex items-center gap-2">
                <span className="text-zinc-600 group-open:rotate-90 transition-transform inline-block">▸</span>
                Prompt mutations staged by reflection loop
                <span className="ml-1 text-zinc-600 normal-case tracking-normal font-normal">
                  ({data.staged_fixes.length} — auto-generated fixes; review &amp; promote or let shadow eval decide)
                </span>
              </summary>
              <ul className="space-y-1.5 mt-3">
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
            </details>
          )}

          {data.summary.failing === 0 && data.summary.p0_failing === 0 && (
            <p className="text-emerald-400 text-sm mt-4">No blockers. All scored tasks passing.</p>
          )}
        </>
      )}
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════
   Glance Bar — at-a-glance KPI strip at the top of the page
   Answers the primary question: "what's my pass rate and trend?"
   ══════════════════════════════════════════════════════════════ */

interface ConvergencePayload {
  state: 'green' | 'converging' | 'stuck';
  pass_rate: number;
  p0_pass_rate: number;
  trend_7d: number;
  stuck_tasks: Array<{ task_number: number }>;
}

function GlanceBar() {
  const [data, setData] = useState<ConvergencePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const payload = await apiCall<ConvergencePayload>('/api/cz/shadow/convergence');
        if (!cancelled) { setData(payload); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchStatus();
    // Refresh every minute — convergence is cheap + the loop ticks every 30 min.
    const timer = setInterval(fetchStatus, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-3">
        <Skeleton className="h-10" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-3 text-xs text-zinc-500">
        Unable to load live status{error ? `: ${error}` : '.'}
      </div>
    );
  }

  const passPct = Math.round((data.pass_rate ?? 0) * 100);
  const p0Pct = Math.round((data.p0_pass_rate ?? 0) * 100);
  const trendPct = (data.trend_7d ?? 0) * 100;
  const trendSign = trendPct > 0 ? '+' : '';
  const stateLabel = data.state === 'green' ? 'Converged' : data.state === 'stuck' ? 'Stuck' : 'Converging';
  const stateDot =
    data.state === 'green' ? 'bg-emerald-400' :
    data.state === 'stuck' ? 'bg-rose-400' :
    'bg-amber-400';
  const stateText =
    data.state === 'green' ? 'text-emerald-300' :
    data.state === 'stuck' ? 'text-rose-300' :
    'text-amber-300';
  const trendTone =
    trendPct > 1 ? 'text-emerald-300' :
    trendPct < -1 ? 'text-rose-300' :
    'text-zinc-300';

  return (
    <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-4 py-3 flex items-center gap-6 flex-wrap">
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tabular-nums ${passRateColor(data.pass_rate)}`}>{passPct}%</span>
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">pass rate</span>
      </div>
      <div className="h-8 w-px bg-zinc-800" />
      <div className="flex items-baseline gap-2">
        <span className={`text-lg font-semibold tabular-nums ${passRateColor(data.p0_pass_rate)}`}>{p0Pct}%</span>
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">P0</span>
      </div>
      <div className="h-8 w-px bg-zinc-800" />
      <div className="flex items-baseline gap-2">
        <span className={`text-lg font-semibold tabular-nums ${trendTone}`}>
          {trendSign}{trendPct.toFixed(1)} pp
        </span>
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">7d trend</span>
      </div>
      <div className="h-8 w-px bg-zinc-800" />
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${stateDot}`} />
        <span className={`text-sm font-medium ${stateText}`}>{stateLabel}</span>
        {data.stuck_tasks?.length > 0 && (
          <span className="text-[11px] text-zinc-500">
            · {data.stuck_tasks.length} stuck task{data.stuck_tasks.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="ml-auto text-[11px] text-zinc-500">
        Auto-refreshes every minute · next loop tick ≤ 30 min
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   CollapsibleSection — lets users hide reference-heavy sections
   ══════════════════════════════════════════════════════════════ */

function CollapsibleSection({
  storageKey,
  title,
  subtitle,
  defaultOpen = true,
  children,
}: {
  storageKey: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const key = `cz.collapsed.${storageKey}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultOpen;
      return raw === '1';
    } catch {
      return defaultOpen;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, open ? '1' : '0'); } catch { /* noop */ }
  }, [key, open]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left group"
      >
        <span className={`text-zinc-500 transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        <span className="text-sm font-medium text-zinc-300 group-hover:text-zinc-100">{title}</span>
        {subtitle && <span className="text-xs text-zinc-500">{subtitle}</span>}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Main Page
   ══════════════════════════════════════════════════════════════ */

export default function CzProtocol() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-zinc-100">Certification Protocol</h1>

      {/* Triage — the answer to "what should I look at?" */}
      <TriagePanel />

      {/* Health metrics — pass rate, P0, trend, scorecard, drift. Reference,
          not a daily prompt. Collapsed by default to keep the page focused. */}
      <CollapsibleSection
        storageKey="health-metrics"
        title="Health metrics"
        subtitle="Pass rate, P0, trend, pillar scorecard, drift chart"
        defaultOpen={false}
      >
        <div className="space-y-4">
          <GlanceBar />
          <Scorecard />
          <DriftChart />
        </div>
      </CollapsibleSection>

      {/* Drill-down — full failure analysis, recommendations, recent failures,
          staged mutations. Open this when triage isn't enough. */}
      <CollapsibleSection
        storageKey="blockers-drilldown"
        title="Failure drill-down"
        subtitle="Recommended actions · top blocking agents · recent failures · staged mutations"
        defaultOpen={false}
      >
        <BlockersAndPlan />
      </CollapsibleSection>

      {/* Run console — collapsible; not every visit is to kick off a run */}
      <CollapsibleSection
        storageKey="live-run-console"
        title="Run console"
        subtitle="Trigger a batch or watch a live run"
        defaultOpen={false}
      >
        <LiveRunConsole />
      </CollapsibleSection>

      {/* Full task list — reference; collapsed by default to reduce density */}
      <CollapsibleSection
        storageKey="task-grid"
        title="Full task list"
        subtitle="All 89 tasks — filters, drill-down, last-run detail"
        defaultOpen={false}
      >
        <TaskGrid />
      </CollapsibleSection>
    </div>
  );
}
