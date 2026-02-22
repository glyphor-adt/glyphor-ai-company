import { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';
import type { Agent, Decision, ActivityEntry, Product, Financial } from './types';

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
  return useQuery<Agent>('company_agents', 'role', true);
}

/* ─── Decisions ───────────────────────────── */
export function useDecisions() {
  const q = useQuery<Decision>('decisions', 'created_at', false);

  const updateDecision = async (id: string, status: 'approved' | 'rejected', decidedBy: string) => {
    await (supabase
      .from('decisions') as ReturnType<typeof supabase.from>)
      .update({ status, decided_by: decidedBy, decided_at: new Date().toISOString() })
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
