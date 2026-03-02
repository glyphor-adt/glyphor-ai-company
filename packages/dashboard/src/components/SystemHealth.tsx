import { useEffect, useState } from 'react';
import { apiCall } from '../lib/firebase';
import { Card, SectionHeader, Skeleton, timeAgo } from './ui';

interface SyncStatus {
  id: string;
  source_name: string;
  status: 'ok' | 'stale' | 'failing';
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
}

interface Incident {
  id: string;
  title: string;
  severity: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

export function SystemHealth() {
  const [syncs, setSyncs] = useState<SyncStatus[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [syncData, incidentData] = await Promise.all([
        apiCall<SyncStatus[]>('/api/data-sync-status'),
        apiCall<Incident[]>('/api/incidents?limit=5'),
      ]);
      setSyncs(syncData ?? []);
      setIncidents(incidentData ?? []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <Skeleton className="h-48" />;

  const allHealthy = syncs.every((s) => s.status === 'ok');
  const openIncidents = incidents.filter((i) => i.status === 'open');

  return (
    <Card>
      <SectionHeader title="System Health" />

      {/* Overall Status */}
      <div className="mb-4 flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            openIncidents.length > 0
              ? 'bg-prism-critical'
              : allHealthy
              ? 'bg-tier-green'
              : 'bg-tier-yellow'
          }`}
        />
        <span className="text-sm font-medium text-txt-secondary">
          {openIncidents.length > 0
            ? `${openIncidents.length} open incident${openIncidents.length > 1 ? 's' : ''}`
            : allHealthy
            ? 'All systems operational'
            : 'Data sync issues detected'}
        </span>
      </div>

      {/* Data Syncs */}
      <div className="space-y-2">
        {syncs.map((sync) => (
          <div
            key={sync.id}
            className="flex items-center justify-between rounded-lg border border-border bg-raised px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  sync.status === 'ok'
                    ? 'bg-tier-green'
                    : sync.status === 'stale'
                    ? 'bg-tier-yellow'
                    : 'bg-prism-critical'
                }`}
              />
              <span className="text-[13px] font-medium text-txt-secondary">
                {sync.source_name}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {sync.consecutive_failures > 0 && (
                <span className="text-[10px] text-prism-critical">
                  {sync.consecutive_failures} failures
                </span>
              )}
              <span className="text-[11px] text-txt-faint">
                Synced {timeAgo(sync.last_success_at)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Open Incidents */}
      {openIncidents.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">
            Open Incidents
          </p>
          {openIncidents.map((inc) => (
            <div
              key={inc.id}
              className="flex items-center justify-between rounded-lg border border-prism-critical/20 bg-prism-critical/5 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-prism-critical">{inc.title}</span>
                <span className="rounded-full border border-prism-critical/30 bg-prism-critical/15 px-1.5 py-0.5 text-[10px] text-prism-critical">
                  {inc.severity}
                </span>
              </div>
              <span className="text-[10px] text-txt-faint">{timeAgo(inc.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
