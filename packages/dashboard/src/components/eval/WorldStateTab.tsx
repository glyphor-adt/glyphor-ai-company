import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../../lib/firebase';

/* ── Types ─────────────────────────────────────────────────── */

interface WorldStateEntry {
  id: string;
  domain: string;
  key: string;
  entity_id: string | null;
  written_by_agent: string | null;
  confidence: number | null;
  updated_at: string;
  valid_until: string | null;
  age_hours: number;
  freshness: 'fresh' | 'stale' | 'expired';
}

interface PredictionAccuracy {
  agent_id: string;
  total_predictions: number;
  prediction_accuracy: number | null;
  avg_self_score: number | null;
  avg_external_score: number | null;
  calibration_bias: number | null;
}

interface WorldModelCorrection {
  id: string;
  correction_type: string;
  field_name: string;
  corrected_value: { description?: string; confidence?: number } | null;
  evidence_eval_score: number | null;
  source: string;
  applied_at: string;
}

interface WorldStateTabProps {
  agentId: string;
}

/* ── Component ─────────────────────────────────────────────── */

export default function WorldStateTab({ agentId }: WorldStateTabProps) {
  const [entries, setEntries] = useState<WorldStateEntry[]>([]);
  const [predictionData, setPredictionData] = useState<PredictionAccuracy | null>(null);
  const [corrections, setCorrections] = useState<WorldModelCorrection[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [worldData, predData, corrData] = await Promise.all([
        apiCall<{ entries: WorldStateEntry[] }>('/api/eval/world-state'),
        apiCall<PredictionAccuracy | null>(`/api/eval/agent/${encodeURIComponent(agentId)}/prediction-accuracy`),
        apiCall<WorldModelCorrection[]>(`/api/eval/agent/${encodeURIComponent(agentId)}/world-model-corrections`),
      ]);
      const relevant = (worldData.entries ?? []).filter(
        e => e.written_by_agent === agentId || e.domain === 'agent_output',
      );
      setEntries(relevant);
      setPredictionData(predData);
      setCorrections(corrData ?? []);
    } catch {
      setEntries([]);
      setPredictionData(null);
      setCorrections([]);
    }
    setLoading(false);
  }, [agentId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return <div className="h-[200px] animate-pulse rounded-lg bg-raised/40" />;
  }

  return (
    <div className="space-y-6">
      {/* Prediction accuracy section */}
      {predictionData && (
        <PredictionAccuracyPanel data={predictionData} />
      )}

      {/* World model corrections timeline */}
      {corrections.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-txt-faint uppercase tracking-widest mb-3">
            World Model Corrections
          </p>
          <div className="space-y-2">
            {corrections.map(c => (
              <div key={c.id} className="rounded-lg border border-border bg-raised/40 p-3">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-lg ${
                    c.correction_type === 'weakness_added'
                      ? 'text-white bg-gradient-to-r from-red-400 via-red-500 to-red-600'
                      : 'text-white bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600'
                  }`}>
                    {c.correction_type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-txt-secondary">{c.field_name.replace(/_/g, ' ')}</span>
                </div>
                {c.corrected_value?.description && (
                  <p className="text-[11px] text-txt-muted mt-1">{c.corrected_value.description}</p>
                )}
                <p className="text-[10px] text-txt-faint mt-1">
                  {new Date(c.applied_at).toLocaleDateString()} · via {c.source}
                  {c.evidence_eval_score != null && ` · eval score: ${(c.evidence_eval_score * 100).toFixed(0)}%`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* World state entries */}
      {entries.length > 0 ? (
        <div>
          <p className="text-[10px] font-semibold text-txt-faint uppercase tracking-widest mb-3">
            World State Entries
          </p>
          <div className="space-y-2">
            {entries.map(entry => (
              <WorldStateRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-raised/40 p-4 text-xs text-txt-muted text-center">
          No world state entries for this agent.
        </div>
      )}
    </div>
  );
}

/* ── Prediction Accuracy Panel ─────────────────────────────── */

function PredictionAccuracyPanel({ data }: { data: PredictionAccuracy }) {
  const bias = data.calibration_bias;
  const biasLabel =
    bias == null ? 'unknown' :
    bias > 0.1 ? 'overconfident' :
    bias < -0.1 ? 'underconfident' :
    'calibrated';
  const biasColor =
    biasLabel === 'calibrated' ? '#00E0FF' :
    biasLabel === 'overconfident' ? '#EF4444' :
    biasLabel === 'underconfident' ? '#F59E0B' : '#666';

  return (
    <div className="rounded-lg border border-border bg-raised/40 p-4">
      <p className="text-[10px] font-semibold text-txt-faint uppercase tracking-widest mb-3">
        Prediction Accuracy
      </p>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-[10px] text-txt-faint">Accuracy</p>
          <p className="text-lg font-mono text-[#00E0FF]">
            {data.prediction_accuracy != null
              ? `${(data.prediction_accuracy * 100).toFixed(0)}%`
              : '—'}
          </p>
          <p className="text-[10px] text-txt-faint">{data.total_predictions} predictions</p>
        </div>
        <div>
          <p className="text-[10px] text-txt-faint">Calibration</p>
          <p className="text-lg font-mono" style={{ color: biasColor }}>
            {bias != null ? `${bias > 0 ? '+' : ''}${(bias * 100).toFixed(0)}pts` : '—'}
          </p>
          <p className="text-[10px]" style={{ color: biasColor }}>{biasLabel}</p>
        </div>
        <div>
          <p className="text-[10px] text-txt-faint">Self vs External</p>
          <p className="text-sm font-mono text-txt-secondary">
            {data.avg_self_score != null ? `${(data.avg_self_score * 100).toFixed(0)}` : '—'}
            {' / '}
            {data.avg_external_score != null ? `${(data.avg_external_score * 100).toFixed(0)}` : '—'}
          </p>
          <p className="text-[10px] text-txt-faint">self / external</p>
        </div>
      </div>
    </div>
  );
}

/* ── World State Row ───────────────────────────────────────── */

function freshnessBadge(freshness: string) {
  const styles: Record<string, string> = {
    fresh: 'text-white bg-gradient-to-r from-cyan-400 via-cyan-500 to-cyan-600',
    stale: 'text-white bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600',
    expired: 'text-white bg-gradient-to-r from-red-400 via-red-500 to-red-600',
  };
  return (
    <span className={`inline-block rounded-lg px-2 py-0.5 text-[10px] font-medium ${styles[freshness] ?? styles.fresh}`}>
      {freshness}
    </span>
  );
}

function WorldStateRow({ entry }: { entry: WorldStateEntry }) {
  return (
    <div className="rounded-lg border border-border bg-raised/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-txt-secondary">{entry.key}</span>
            {freshnessBadge(entry.freshness)}
          </div>
          <span className="text-[10px] text-txt-faint mt-0.5 block">
            {entry.domain}{entry.entity_id ? ` / ${entry.entity_id}` : ''}
          </span>
        </div>
        {entry.confidence !== null && (
          <span className="text-[10px] text-txt-faint shrink-0">
            conf: {(entry.confidence * 100).toFixed(0)}%
          </span>
        )}
      </div>

      <p className="text-[10px] text-txt-faint mt-2">
        Updated {Math.round(entry.age_hours)}h ago
        {entry.written_by_agent && ` by ${entry.written_by_agent}`}
        {entry.valid_until && ` · expires ${new Date(entry.valid_until).toLocaleDateString()}`}
      </p>
    </div>
  );
}
