import { useEffect, useState, useCallback } from 'react';
import { apiCall } from './firebase';
import type { Agent, Decision, ActivityEntry, Product, Financial, FounderDirective, Incident, AgentReflection, CompanyPulse, WorkAssignment, DashboardChangeRequest } from './types';
import { filterCanonicalKeepRoster } from './liveRoster';

/* ─── Generic fetch helper ─────────────────── */
function useQuery<T>(table: string, orderCol = 'created_at', ascending = false) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const dir = ascending ? 'asc' : 'desc';
      const rows = await apiCall<T[]>(`/api/${table}?order=${orderCol}.${dir}`);
      setData(rows ?? []);
    } catch {
      setData([]);
    }
    setLoading(false);
  }, [table, orderCol, ascending]);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, refresh };
}

/* ─── Agents ──────────────────────────────── */
export function useAgents() {
  const [data, setData] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const agents = await apiCall<Agent[]>('/api/agents');
      setData(filterCanonicalKeepRoster(agents ?? []));
    } catch {
      setData([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, refresh };
}

/* ─── Decisions ───────────────────────────── */
export function useDecisions() {
  const q = useQuery<Decision>('decisions', 'created_at', false);

  const updateDecision = async (id: string, status: 'approved' | 'rejected', resolvedBy: string) => {
    await apiCall(`/api/decisions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, resolved_by: resolvedBy, resolved_at: new Date().toISOString() }),
    });
    q.refresh();
  };

  return { ...q, updateDecision };
}

/* ─── Activity ────────────────────────────── */
export function useActivity(limit = 30) {
  const [data, setData] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const rows = await apiCall<ActivityEntry[]>(`/api/activity?limit=${limit}`);
        setData(rows ?? []);
      } catch {
        setData([]);
      }
      setLoading(false);
    })();
  }, [limit]);

  return { data, loading };
}

/* ─── Products ────────────────────────────── */
export function useProducts() {
  return useQuery<Product>('products', 'name', true);
}

/* ─── Financials ──────────────────────────── */
export function useFinancials() {
  return useQuery<Financial>('financials', 'period', false);
}

/* ─── Real-time subscription for activity ── */
export function useRealtimeActivity(onNew: (entry: ActivityEntry) => void) {
  useEffect(() => {
    // Real-time subscriptions not available after Firebase migration.
    // Consider polling or server-sent events as an alternative.
  }, [onNew]);
}

/* ─── Company Vitals (singleton) ───────────── */
export function useCompanyPulse() {
  const [data, setData] = useState<CompanyPulse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const row = await apiCall<CompanyPulse>('/api/company-vitals');
        setData(row ?? null);
      } catch {
        setData(null);
      }
      setLoading(false);
    })();
  }, []);

  return { data, loading };
}

/* ─── Active Founder Directives ───────────── */
export function useActiveDirectives() {
  const [data, setData] = useState<(FounderDirective & { assignments: WorkAssignment[] })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const items = await apiCall<(FounderDirective & { assignments: WorkAssignment[] })[]>('/api/directives/active');
        setData(items ?? []);
      } catch {
        setData([]);
      }
      setLoading(false);
    })();
  }, []);

  return { data, loading };
}

/* ─── Open Incidents ──────────────────────── */
export function useOpenIncidents() {
  const [data, setData] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const rows = await apiCall<Incident[]>('/api/incidents?status=open&order=created_at.desc&limit=5');
      setData(rows ?? []);
    } catch {
      setData([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const resolveIncident = async (id: string) => {
    await apiCall(`/api/incidents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'resolved', resolved_at: new Date().toISOString() }),
    });
    setData((prev) => prev.filter((inc) => inc.id !== id));
  };

  return { data, loading, refresh, resolveIncident };
}

/* ─── Top Agent Reflections (recent, high quality) ── */
export function useTopReflections(limit = 4) {
  const [data, setData] = useState<AgentReflection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const rows = await apiCall<AgentReflection[]>(`/api/agent-reflections?min_quality=60&limit=${limit}`);
        setData(rows ?? []);
      } catch {
        setData([]);
      }
      setLoading(false);
    })();
  }, [limit]);

  return { data, loading };
}

/* ─── Dashboard Change Requests ───────────── */
export function useChangeRequests() {
  const [data, setData] = useState<DashboardChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiCall<DashboardChangeRequest[]>('/api/dashboard-change-requests');
      setData(rows ?? []);
    } catch {
      setData([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const submitRequest = async (req: {
    submitted_by: string;
    title: string;
    description: string;
    request_type: DashboardChangeRequest['request_type'];
    priority: DashboardChangeRequest['priority'];
    affected_area: string | null;
  }) => {
    await apiCall('/api/dashboard-change-requests', {
      method: 'POST',
      body: JSON.stringify(req),
    });
    refresh();
  };

  return { data, loading, refresh, submitRequest };
}
