import { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';
import type { Agent, Decision, ActivityEntry, Product, Financial, FounderDirective, Incident, AgentReflection, CompanyPulse, WorkAssignment } from './types';

/* ─── Generic fetch helper ─────────────────── */
function useQuery<T>(table: string, orderCol = 'created_at', ascending = false) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: rows } = await supabase
      .from(table)
      .select('*')
      .order(orderCol, { ascending });
    setData((rows as T[]) ?? []);
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
    const { data: rows } = await supabase
      .from('company_agents')
      .select('*, agent_profiles(avatar_url)')
      .order('role', { ascending: true });
    const agents = (rows ?? []).map((r: Record<string, unknown>) => {
      const profile = r.agent_profiles as { avatar_url: string | null } | null;
      const { agent_profiles: _, ...rest } = r;
      return { ...rest, avatar_url: profile?.avatar_url ?? null } as Agent;
    });
    setData(agents);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, refresh };
}

/* ─── Decisions ───────────────────────────── */
export function useDecisions() {
  const q = useQuery<Decision>('decisions', 'created_at', false);

  const updateDecision = async (id: string, status: 'approved' | 'rejected', resolvedBy: string) => {
    await (supabase
      .from('decisions') as ReturnType<typeof supabase.from>)
      .update({ status, resolved_by: resolvedBy, resolved_at: new Date().toISOString() })
      .eq('id', id);
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
      const { data: rows } = await supabase
        .from('activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      setData((rows as ActivityEntry[]) ?? []);
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
    const channel = supabase
      .channel('activity_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activity_log' },
        (payload) => onNew(payload.new as ActivityEntry),
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [onNew]);
}

/* ─── Company Pulse (singleton) ───────────── */
export function useCompanyPulse() {
  const [data, setData] = useState<CompanyPulse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: row } = await supabase
        .from('company_pulse')
        .select('*')
        .eq('id', 'current')
        .single();
      setData(row as CompanyPulse | null);
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
      const { data: directives } = await supabase
        .from('founder_directives')
        .select('*')
        .in('status', ['active', 'paused'])
        .order('priority', { ascending: true })
        .limit(5);

      const items = (directives as FounderDirective[]) ?? [];

      if (items.length > 0) {
        const ids = items.map((d) => d.id);
        const { data: assignments } = await supabase
          .from('work_assignments')
          .select('*')
          .in('directive_id', ids);

        const assignmentsByDirective = new Map<string, WorkAssignment[]>();
        for (const a of (assignments as WorkAssignment[]) ?? []) {
          const list = assignmentsByDirective.get(a.directive_id) ?? [];
          list.push(a);
          assignmentsByDirective.set(a.directive_id, list);
        }

        setData(items.map((d) => ({ ...d, assignments: assignmentsByDirective.get(d.id) ?? [] })));
      } else {
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

  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase
        .from('incidents')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(5);
      setData((rows as Incident[]) ?? []);
      setLoading(false);
    })();
  }, []);

  return { data, loading };
}

/* ─── Top Agent Reflections (recent, high quality) ── */
export function useTopReflections(limit = 4) {
  const [data, setData] = useState<AgentReflection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase
        .from('agent_reflections')
        .select('*')
        .gte('quality_score', 60)
        .order('created_at', { ascending: false })
        .limit(limit);
      setData((rows as AgentReflection[]) ?? []);
      setLoading(false);
    })();
  }, [limit]);

  return { data, loading };
}
