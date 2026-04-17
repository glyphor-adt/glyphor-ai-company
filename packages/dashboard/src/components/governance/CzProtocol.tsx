import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  id: string;
  mode: string;
  trigger_type: string;
  triggered_by: string | null;
  status: string;
  task_count: number;
  passed_count: number;
  failed_count: number;
  overall_pass_rate: number | null;
  avg_judge_score: number | null;
  started_at: string;
  completed_at: string | null;
  passed?: number;
  failed?: number;
}

interface CzDriftPoint {
  run_id: string;
  completed_at: string;
  mode: string;
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

/* ══════════════════════════════════════════════════════════════
   Panel 1: Scorecard
   ══════════════════════════════════════════════════════════════ */

function Scorecard() {
  const [pillars, setPillars] = useState<CzPillar[]>([]);
  const [gates, setGates] = useState<CzGate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiCall<{ pillars: CzPillar[]; gates: CzGate[] }>('/api/cz/scorecard');
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
  }, []);

  if (loading) return <Card><Skeleton className="h-48" /></Card>;
  if (error) return <Card><p className="text-rose-400 text-sm">{error}</p></Card>;

  const hasPillarData = pillars.length > 0;

  return (
    <Card>
      <SectionHeader title="Scorecard" subtitle="Latest completed run" />

      {!hasPillarData && (
        <p className="text-zinc-500 text-sm mt-2">No completed runs yet. Run a test suite to populate the scorecard.</p>
      )}

      {hasPillarData && (
        <div className="grid grid-cols-3 gap-3 mt-4">
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
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-zinc-300">{shortPillar(p.pillar)}</span>
                  {p.pillar_is_p0 && <Badge color="red">P0</Badge>}
                </div>
                <div className="flex items-baseline gap-3">
                  <span className={`text-2xl font-bold tabular-nums ${passRateColor(rate)}`}>
                    {(rate * 100).toFixed(0)}%
                  </span>
                  <span className={`text-sm tabular-nums ${scoreColor(score)}`}>
                    avg {score.toFixed(1)}
                  </span>
                </div>
                <div className="text-[10px] mt-1 text-zinc-500">
                  {p.passed}/{p.total_tasks} passed
                  {!meetsRate && <span className="text-rose-400 ml-2">below {(Number(p.pass_rate_threshold) * 100).toFixed(0)}%</span>}
                  {!meetsScore && <span className="text-amber-400 ml-2">avg &lt; {Number(p.avg_score_threshold).toFixed(1)}</span>}
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
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

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

  return (
    <Card>
      <SectionHeader title="Task Grid" subtitle={`${tasks.length} tasks`} />

      {/* Filters */}
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
                <th className="py-2 w-12 text-center">Pass</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <>
                  <tr
                    key={t.id}
                    className="border-b border-zinc-800/40 hover:bg-zinc-800/30 cursor-pointer"
                    onClick={() => setExpandedTask(expandedTask === t.id ? null : t.id)}
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
                    <td className="py-2 text-center">
                      {t.latest_pass == null ? (
                        <span className="text-zinc-600">—</span>
                      ) : t.latest_pass ? (
                        <span className="text-emerald-400">✓</span>
                      ) : (
                        <span className="text-rose-400">✗</span>
                      )}
                    </td>
                  </tr>
                  {expandedTask === t.id && (
                    <tr key={`${t.id}-detail`} className="bg-zinc-900/50">
                      <td colSpan={7} className="p-3">
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
                            <p className="text-zinc-300">
                              {t.latest_run_at ? timeAgo(t.latest_run_at) : 'Never'}
                              {t.latest_judge_tier && (
                                <span className="text-zinc-500 ml-2">tier: {t.latest_judge_tier}</span>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
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

function LiveRunConsole() {
  const [runs, setRuns] = useState<CzRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sseEvents, setSseEvents] = useState<SseEvent[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [launchMode, setLaunchMode] = useState<string>('full');
  const [launching, setLaunching] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

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

  // SSE stream for active run
  useEffect(() => {
    if (!activeRunId) return;
    const es = new EventSource(`${CANONICAL_SCHEDULER_URL}/api/cz/runs/${activeRunId}/stream`);
    eventSourceRef.current = es;

    const addEvent = (event: string, data: Record<string, unknown>) => {
      setSseEvents((prev) => [...prev, { timestamp: new Date().toISOString(), event, data }]);
      if (consoleRef.current) {
        consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
      }
    };

    es.addEventListener('connected', (e) => addEvent('connected', JSON.parse(e.data)));
    es.addEventListener('task_started', (e) => addEvent('task_started', JSON.parse(e.data)));
    es.addEventListener('task_scored', (e) => addEvent('task_scored', JSON.parse(e.data)));
    es.addEventListener('pillar_complete', (e) => addEvent('pillar_complete', JSON.parse(e.data)));
    es.addEventListener('run_complete', (e) => {
      addEvent('run_complete', JSON.parse(e.data));
      es.close();
      fetchRuns();
    });

    es.onerror = () => {
      addEvent('error', { message: 'SSE connection lost' });
      es.close();
    };

    return () => { es.close(); };
  }, [activeRunId, fetchRuns]);

  // Launch a new run
  const launchRun = async () => {
    setLaunching(true);
    try {
      const data = await apiCall<{ run: CzRun }>('/api/cz/runs', {
        method: 'POST',
        body: JSON.stringify({ mode: launchMode }),
      });
      setSseEvents([]);
      setActiveRunId(data.run.id);
      await fetchRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLaunching(false);
    }
  };

  return (
    <Card>
      <SectionHeader title="Live Run Console" subtitle="Execute and monitor CZ test runs" />

      {/* Launch Controls */}
      <div className="flex items-center gap-3 mt-3">
        <select
          className="bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700"
          value={launchMode}
          onChange={(e) => setLaunchMode(e.target.value)}
        >
          <option value="full">Full (67 tasks)</option>
          <option value="critical">Critical (P0 only)</option>
          <option value="pillar">By Pillar</option>
          <option value="canary">Canary (by agent)</option>
          <option value="single">Single Task</option>
        </select>
        <GradientButton onClick={launchRun} disabled={launching}>
          {launching ? 'Launching...' : 'Run Now'}
        </GradientButton>
      </div>

      {/* Console Output */}
      {sseEvents.length > 0 && (
        <div
          ref={consoleRef}
          className="mt-3 bg-zinc-950 rounded-lg border border-zinc-800 p-3 max-h-60 overflow-y-auto font-mono text-[11px]"
        >
          {sseEvents.map((evt, i) => {
            const color =
              evt.event === 'task_scored'
                ? (evt.data as { pass?: boolean }).pass
                  ? 'text-emerald-400'
                  : 'text-rose-400'
                : evt.event === 'run_complete'
                  ? 'text-cyan'
                  : evt.event === 'error'
                    ? 'text-rose-400'
                    : 'text-zinc-400';
            return (
              <div key={i} className={`${color} leading-relaxed`}>
                <span className="text-zinc-600">{new Date(evt.timestamp).toLocaleTimeString()}</span>{' '}
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
              const passed = r.passed_count ?? r.passed ?? 0;
              const failed = r.failed_count ?? r.failed ?? 0;
              const total = r.task_count;
              const rate = total > 0 ? passed / total : 0;
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-3 text-xs border border-zinc-800/40 rounded p-2 hover:bg-zinc-800/20 cursor-pointer"
                  onClick={() => {
                    if (r.status === 'running') {
                      setSseEvents([]);
                      setActiveRunId(r.id);
                    }
                  }}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      r.status === 'completed'
                        ? 'bg-emerald-400'
                        : r.status === 'running'
                          ? 'bg-amber-400 animate-pulse'
                          : r.status === 'failed'
                            ? 'bg-rose-400'
                            : 'bg-zinc-600'
                    }`}
                  />
                  <span className="text-zinc-300 font-medium w-14">{r.mode}</span>
                  <span className="text-zinc-500">{r.trigger_type}</span>
                  <span className={`tabular-nums ${passRateColor(rate)}`}>
                    {passed}/{total}
                  </span>
                  {r.avg_judge_score != null && (
                    <span className={`tabular-nums ${scoreColor(Number(r.avg_judge_score))}`}>
                      avg {Number(r.avg_judge_score).toFixed(1)}
                    </span>
                  )}
                  <span className="text-zinc-600 ml-auto">{timeAgo(r.started_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const qs = new URLSearchParams({ days: String(days) });
        if (filterPillar) qs.set('pillar', filterPillar);
        const data = await apiCall<{ series: CzDriftPoint[] }>(`/api/cz/drift?${qs.toString()}`);
        if (!cancelled) setSeries(data.series);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [days, filterPillar]);

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
   Main Page
   ══════════════════════════════════════════════════════════════ */

export default function CzProtocol() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Customer Zero Protocol</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Dogfood test runner — 67 tasks across 9 pillars, 14 P0 critical tests, 3 launch gates.
        </p>
      </div>

      <Scorecard />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LiveRunConsole />
        <DriftChart />
      </div>

      <TaskGrid />
    </div>
  );
}
