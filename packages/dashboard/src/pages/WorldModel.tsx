import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { DISPLAY_NAME_MAP } from '../lib/types';
import {
  Card,
  SectionHeader,
  AgentAvatar,
  Skeleton,
  timeAgo,
} from '../components/ui';
import { MdPsychology } from 'react-icons/md';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';

// ─── Types ──────────────────────────────────────────────────────

interface WorldModelRow {
  id: string;
  agent_role: string;
  updated_at: string;
  strengths: { dimension: string; evidence: string; confidence: number }[];
  weaknesses: { dimension: string; evidence: string; confidence: number }[];
  blindspots: string[];
  failure_patterns: { pattern: string; occurrences: number; lastSeen: string }[];
  task_type_scores: Record<string, { avgScore: number; count: number; trend: string }>;
  prediction_accuracy: number;
  improvement_goals: { dimension: string; currentScore: number; targetScore: number; strategy: string; progress: number }[];
}

interface RubricRow {
  id: string;
  role: string;
  task_type: string;
  version: number;
  dimensions: { name: string; weight: number }[];
  passing_score: number;
  excellence_score: number;
}

// ─── Hooks ──────────────────────────────────────────────────────

function useWorldModels() {
  const [data, setData] = useState<WorldModelRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: rows } = await supabase
      .from('agent_world_model')
      .select('*')
      .order('agent_role');
    setData((rows as WorldModelRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { data, loading, refresh };
}

function useRubrics() {
  const [data, setData] = useState<RubricRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase
        .from('role_rubrics')
        .select('*')
        .order('role');
      setData((rows as RubricRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  return { data, loading };
}

// ─── Helpers ────────────────────────────────────────────────────

const TREND_ICONS: Record<string, string> = {
  improving: '↑',
  declining: '↓',
  stable: '→',
};

function scoreColor(score: number): string {
  if (score >= 4.2) return 'text-green-400';
  if (score >= 3.0) return 'text-yellow-400';
  return 'text-red-400';
}

function progressBar(current: number, target: number): string {
  const pct = Math.min(100, Math.round((current / target) * 100));
  return `${pct}%`;
}

// ─── Components ─────────────────────────────────────────────────

function AgentWorldCard({ model }: { model: WorldModelRow }) {
  const [expanded, setExpanded] = useState(false);
  const displayName = DISPLAY_NAME_MAP[model.agent_role] ?? model.agent_role;

  // Prepare radar chart data from task_type_scores
  const radarData = Object.entries(model.task_type_scores).map(([type, score]) => ({
    taskType: type.replace(/_/g, ' '),
    score: score.avgScore,
    fullMark: 5,
  }));

  // Prepare bar chart data from improvement goals
  const goalData = model.improvement_goals.map(g => ({
    name: g.dimension,
    current: g.currentScore,
    target: g.targetScore,
  }));

  return (
    <Card className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AgentAvatar role={model.agent_role} size={36} />
          <div>
            <h3 className="font-semibold text-txt-primary">{displayName}</h3>
            <p className="text-xs text-txt-faint">{model.agent_role} · updated {timeAgo(model.updated_at)}</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-txt-muted">Prediction Accuracy</div>
          <div className={`text-lg font-bold ${scoreColor(model.prediction_accuracy * 5)}`}>
            {(model.prediction_accuracy * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Strengths & Weaknesses */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <h4 className="text-xs font-medium text-green-400 mb-1">Strengths</h4>
          {model.strengths.length === 0 ? (
            <p className="text-xs text-txt-faint">No strengths recorded yet</p>
          ) : (
            <ul className="space-y-1">
              {model.strengths.slice(0, 3).map((s, i) => (
                <li key={i} className="text-xs text-txt-secondary">
                  <span className="text-green-400">✓</span> {s.dimension}
                  <span className="text-txt-faint ml-1">({(s.confidence * 100).toFixed(0)}%)</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-xs font-medium text-amber-400 mb-1">Weaknesses</h4>
          {model.weaknesses.length === 0 ? (
            <p className="text-xs text-txt-faint">No weaknesses recorded yet</p>
          ) : (
            <ul className="space-y-1">
              {model.weaknesses.slice(0, 3).map((w, i) => (
                <li key={i} className="text-xs text-txt-secondary">
                  <span className="text-amber-400">⚠</span> {w.dimension}
                  <span className="text-txt-faint ml-1">({(w.confidence * 100).toFixed(0)}%)</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Task Type Scores */}
      {radarData.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-txt-muted mb-2">Task Performance</h4>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(model.task_type_scores).map(([type, score]) => (
              <div key={type} className="flex items-center justify-between text-xs">
                <span className="text-txt-muted truncate">{type.replace(/_/g, ' ')}</span>
                <span className={`font-mono ${scoreColor(score.avgScore)}`}>
                  {score.avgScore.toFixed(1)} {TREND_ICONS[score.trend] ?? ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expand / Collapse for detailed view */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-txt-faint hover:text-txt-secondary transition-colors"
      >
        {expanded ? '▲ Show less' : '▼ Show more'}
      </button>

      {expanded && (
        <div className="space-y-4 pt-2 border-t border-border">
          {/* Radar Chart */}
          {radarData.length >= 3 && (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid stroke="var(--color-border)" />
                  <PolarAngleAxis dataKey="taskType" tick={{ fill: 'var(--color-txt-muted)', fontSize: 10 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 5]} tick={{ fill: 'var(--color-txt-faint)', fontSize: 9 }} />
                  <Radar name="Score" dataKey="score" stroke="#818cf8" fill="#818cf8" fillOpacity={0.3} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Improvement Goals */}
          {goalData.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-txt-muted mb-2">Improvement Goals</h4>
              {model.improvement_goals.map((g, i) => (
                <div key={i} className="mb-2">
                  <div className="flex justify-between text-xs text-txt-secondary">
                    <span>{g.dimension}</span>
                    <span>{g.currentScore.toFixed(1)} → {g.targetScore.toFixed(1)}</span>
                  </div>
                  <div className="w-full bg-raised rounded-full h-1.5 mt-1">
                    <div
                      className="bg-indigo-500 h-1.5 rounded-full"
                      style={{ width: progressBar(g.currentScore, g.targetScore) }}
                    />
                  </div>
                  <p className="text-[10px] text-txt-faint mt-0.5">{g.strategy}</p>
                </div>
              ))}
            </div>
          )}

          {/* Failure Patterns */}
          {model.failure_patterns.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-red-400 mb-1">Failure Patterns</h4>
              {model.failure_patterns.map((fp, i) => (
                <div key={i} className="text-xs text-txt-muted mb-1">
                  <span className="text-red-400">⚠</span> {fp.pattern}
                  <span className="text-txt-faint ml-1">({fp.occurrences}x, last: {timeAgo(fp.lastSeen)})</span>
                </div>
              ))}
            </div>
          )}

          {/* Blindspots */}
          {model.blindspots.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-orange-400 mb-1">Blindspots</h4>
              {model.blindspots.map((b, i) => (
                <p key={i} className="text-xs text-txt-muted">• {b}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function RubricOverview({ rubrics }: { rubrics: RubricRow[] }) {
  if (rubrics.length === 0) return null;

  // Group rubrics by role
  const byRole = rubrics.reduce<Record<string, RubricRow[]>>((acc, r) => {
    (acc[r.role] ??= []).push(r);
    return acc;
  }, {});

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-txt-primary mb-3">Role Rubrics</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {Object.entries(byRole).map(([role, roleRubrics]) => (
          <div key={role} className="bg-raised rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <AgentAvatar role={role} size={24} />
              <span className="text-xs font-medium text-txt-primary">{DISPLAY_NAME_MAP[role] ?? role}</span>
            </div>
            {roleRubrics.map(r => (
              <div key={r.id} className="mb-2">
                <span className="text-xs text-txt-muted">{r.task_type.replace(/_/g, ' ')}</span>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {r.dimensions.map((d, i) => (
                    <span key={i} className="text-[10px] bg-raised text-txt-muted px-1.5 py-0.5 rounded">
                      {d.name} ({(d.weight * 100).toFixed(0)}%)
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Page ───────────────────────────────────────────────────────

export default function WorldModel() {
  const { data: models, loading: modelsLoading } = useWorldModels();
  const { data: rubrics, loading: rubricsLoading } = useRubrics();

  // Summary stats
  const totalAgents = models.length;
  const avgAccuracy = totalAgents > 0
    ? models.reduce((s, m) => s + m.prediction_accuracy, 0) / totalAgents
    : 0;
  const totalGoals = models.reduce((s, m) => s + m.improvement_goals.length, 0);
  const totalFailurePatterns = models.reduce((s, m) => s + m.failure_patterns.length, 0);

  // Performance distribution for bar chart
  const performanceData = models.map(m => {
    const scores = Object.values(m.task_type_scores);
    const avg = scores.length > 0
      ? scores.reduce((s, sc) => s + sc.avgScore, 0) / scores.length
      : 0;
    return {
      name: (DISPLAY_NAME_MAP[m.agent_role] ?? m.agent_role).split(' ').pop(),
      score: Number(avg.toFixed(2)),
      role: m.agent_role,
    };
  }).sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-6 p-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-txt-primary">{totalAgents}</div>
          <div className="text-xs text-txt-faint">Active World Models</div>
        </Card>
        <Card className="p-4 text-center">
          <div className={`text-2xl font-bold ${scoreColor(avgAccuracy * 5)}`}>
            {(avgAccuracy * 100).toFixed(0)}%
          </div>
          <div className="text-xs text-txt-faint">Avg Prediction Accuracy</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-indigo-400">{totalGoals}</div>
          <div className="text-xs text-txt-faint">Improvement Goals</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-red-400">{totalFailurePatterns}</div>
          <div className="text-xs text-txt-faint">Known Failure Patterns</div>
        </Card>
      </div>

      {/* Performance Distribution */}
      {performanceData.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-txt-primary mb-3">Performance Leaderboard</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={performanceData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis type="number" domain={[0, 5]} tick={{ fill: 'var(--color-txt-muted)', fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={80} tick={{ fill: 'var(--color-txt-secondary)', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8 }}
                  labelStyle={{ color: 'var(--color-txt-primary)' }}
                  formatter={(value: number) => [`${value.toFixed(2)} / 5.0`, 'Avg Score']}
                />
                <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                  {performanceData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.score >= 4.2 ? '#4ade80' : entry.score >= 3.0 ? '#fbbf24' : '#f87171'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Loading states */}
      {(modelsLoading || rubricsLoading) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      )}

      {/* Rubric Overview */}
      {!rubricsLoading && <RubricOverview rubrics={rubrics} />}

      {/* Agent World Model Cards */}
      {!modelsLoading && models.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-txt-primary mb-3">Individual Agent Models</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {models.map(m => (
              <AgentWorldCard key={m.id} model={m} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!modelsLoading && models.length === 0 && (
        <Card className="p-8 text-center">
          <MdPsychology className="text-4xl text-txt-muted mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-txt-primary mb-1">No World Models Yet</h3>
          <p className="text-sm text-txt-faint">
            World models are created automatically as agents run and receive evaluations.
            Once orchestrators start grading task agent outputs, self-models will appear here.
          </p>
        </Card>
      )}
    </div>
  );
}
