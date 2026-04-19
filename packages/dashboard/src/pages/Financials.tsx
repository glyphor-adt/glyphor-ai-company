import { useEffect, useState, useCallback, useMemo } from 'react';
import { apiCall } from '../lib/firebase';
import { GLYPHOR_PALETTE } from '../lib/types';
import {
  Card,
  GradientButton,
  SectionHeader,
  Skeleton,
} from '../components/ui';
import { SiGooglecloud, SiVercel, SiOpenai, SiAmazonwebservices, SiGithub, SiSlack, SiStripe, SiCloudflare, SiDigitalocean, SiAtlassian } from 'react-icons/si';
import { VscAzure } from 'react-icons/vsc';
import type { IconType } from 'react-icons';

const PROVIDER_ICONS: Record<string, { icon: IconType; color: string }> = {
  'google cloud': { icon: SiGooglecloud, color: '#4285F4' },
  'google': { icon: SiGooglecloud, color: '#4285F4' },
  'gcp': { icon: SiGooglecloud, color: '#4285F4' },
  'microsoft': { icon: VscAzure, color: '#00A4EF' },
  'azure': { icon: VscAzure, color: '#00A4EF' },
  'vercel': { icon: SiVercel, color: '#ffffff' },
  'openai': { icon: SiOpenai, color: '#10A37F' },
  'aws': { icon: SiAmazonwebservices, color: '#FF9900' },
  'github': { icon: SiGithub, color: '#ffffff' },
  'slack': { icon: SiSlack, color: '#E01E5A' },
  'stripe': { icon: SiStripe, color: '#635BFF' },
  'cloudflare': { icon: SiCloudflare, color: '#F48120' },
  'digitalocean': { icon: SiDigitalocean, color: '#0080FF' },
  'atlassian': { icon: SiAtlassian, color: '#0052CC' },
};

/** Set to true to show secondary/admin telemetry panels (product profitability, cost by product, top subscriptions). */
const SHOW_SECONDARY_PANELS = false;

function getProviderIcon(name: string): { icon: IconType; color: string } | null {
  const lower = name.toLowerCase();
  if (PROVIDER_ICONS[lower]) return PROVIDER_ICONS[lower];
  for (const [key, val] of Object.entries(PROVIDER_ICONS)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

// ─── Sync Status Types & Hook ─────────────────────────────────────
interface SyncStatus {
  id: string;
  status: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
}

const FINANCIAL_SYNCS = [
  { id: 'stripe', label: 'Stripe (Revenue)', endpoint: '/sync/stripe' },
  { id: 'mercury', label: 'Mercury (Banking)', endpoint: '/sync/mercury' },
  { id: 'gcp-billing', label: 'GCP Billing', endpoint: '/sync/gcp-billing' },
  { id: 'aws-billing', label: 'AWS Bedrock', endpoint: '/sync/aws-billing' },
  { id: 'azure-billing', label: 'Azure OpenAI', endpoint: '/sync/azure-billing' },
  { id: 'anthropic-billing', label: 'Anthropic (direct API)', endpoint: '/sync/anthropic-billing' },
  { id: 'openai-billing', label: 'OpenAI (direct API)', endpoint: '/sync/openai-billing' },
];

function useSyncStatus() {
  const [statuses, setStatuses] = useState<SyncStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const rows = await apiCall<SyncStatus[]>('/api/data-sync-status');
      setStatuses(rows ?? []);
    } catch { setStatuses([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { statuses, loading, refresh };
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  ScatterChart,
  Scatter,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

interface FinancialRow {
  id: string;
  date: string;
  product: string | null;
  metric: string;
  value: number;
  details: unknown;
}

interface GcpBillingRow {
  id: string;
  service: string;
  project: string | null;
  product: string | null;
  cost_usd: number;
  usage: { date?: string; currency?: string; raw_service?: string; project?: string };
  recorded_at: string;
}

interface ApiBillingRow {
  id: string;
  provider: string;
  service: string;
  cost_usd: number;
  usage: Record<string, unknown>;
  product: string | null;
  recorded_at: string;
}

interface AgentRunRow {
  id: string;
  agent_id?: string | null;
  routing_model?: string | null;
  routing_rule?: string | null;
  model_routing_reason?: string | null;
  subtask_complexity?: string | null;
  verification_tier?: string | null;
  [key: string]: unknown;
  reasoning_cost_usd?: number | null;
  cost?: number | null;
  started_at?: string | null;
}

interface AgentReflectionRow {
  id: string;
  run_id: string;
  agent_role: string;
  quality_score: number | null;
  created_at: string;
}

function useGcpBilling(days = 30) {
  const [data, setData] = useState<GcpBillingRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    try {
      const rows = await apiCall<GcpBillingRow[]>(`/api/gcp-billing?since=${since}`);
      setData(rows ?? []);
    } catch {
      setData([]);
    }
    setLoading(false);
  }, [days]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, refresh };
}

function useFinancialsRaw(days = 30) {
  const [data, setData] = useState<FinancialRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    try {
      const rows = await apiCall<FinancialRow[]>(`/api/financials?since=${since}&order=date.desc&limit=1000`);
      setData(rows ?? []);
    } catch {
      setData([]);
    }
    setLoading(false);
  }, [days]);

  useEffect(() => { refresh(); }, [refresh]);
  return { data, loading, refresh };
}

function useApiBilling(days = 30) {
  const [data, setData] = useState<ApiBillingRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    try {
      const rows = await apiCall<ApiBillingRow[]>(`/api/api-billing?since=${since}`);
      setData(rows ?? []);
    } catch {
      setData([]);
    }
    setLoading(false);
  }, [days]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, refresh };
}

function useAgentRunsForVerification(days = 30) {
  const [data, setData] = useState<AgentRunRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      try {
        const rows = await apiCall<AgentRunRow[]>(`/api/agent-runs?since=${since}&limit=1000`);
        setData(rows ?? []);
      } catch {
        setData([]);
      }
      setLoading(false);
    })();
  }, [days]);

  return { data, loading };
}

function useAgentReflections(days = 30) {
  const [data, setData] = useState<AgentReflectionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      try {
        const rows = await apiCall<AgentReflectionRow[]>(`/api/agent-reflections?since=${since}&limit=1000`);
        setData(rows ?? []);
      } catch {
        setData([]);
      }
      setLoading(false);
    })();
  }, [days]);

  return { data, loading };
}

export default function Financials() {
  const { data: raw, loading, refresh: refreshFinancials } = useFinancialsRaw(30);
  const { data: gcpBilling, loading: gcpLoading, refresh: refreshGcpBilling } = useGcpBilling(90);
  const { data: apiBilling, loading: apiLoading, refresh: refreshApiBilling } = useApiBilling(90);
  const { statuses: syncStatuses, loading: syncLoading, refresh: refreshSyncStatus } = useSyncStatus();
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const [aiBillingView, setAiBillingView] = useState<'daily' | 'monthly'>('daily');

  const triggerSync = useCallback(async (endpoint: string, id: string) => {
    setSyncingIds((prev) => new Set(prev).add(id));
    try {
      await apiCall(endpoint, { method: 'POST' });
    } catch { /* sync status will show the error */ }
    setSyncingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    await Promise.all([refreshSyncStatus(), refreshFinancials(), refreshGcpBilling(), refreshApiBilling()]);
  }, [refreshSyncStatus, refreshFinancials, refreshGcpBilling, refreshApiBilling]);

  const triggerAllSyncs = useCallback(async () => {
    const ids = FINANCIAL_SYNCS.map((s) => s.id);
    setSyncingIds(new Set(ids));
    await Promise.allSettled(FINANCIAL_SYNCS.map((s) => apiCall(s.endpoint, { method: 'POST' })));
    setSyncingIds(new Set());
    await Promise.all([refreshSyncStatus(), refreshFinancials(), refreshGcpBilling(), refreshApiBilling()]);
  }, [refreshSyncStatus, refreshFinancials, refreshGcpBilling, refreshApiBilling]);

  // Pivot EAV rows into daily snapshots
  const mrrData = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const row of raw) {
      if (row.metric === 'mrr' && !row.product) {
        byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.value);
      }
    }
    return Array.from(byDate.entries())
      .map(([date, value]) => ({ date: formatDate(date), mrr: value }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [raw]);

  const costData = useMemo(() => {
    const byDate = new Map<string, { infra: number; api: number }>();
    for (const row of raw) {
      if (row.metric === 'infra_cost' || row.metric === 'api_cost') {
        const entry = byDate.get(row.date) ?? { infra: 0, api: 0 };
        if (row.metric === 'infra_cost') entry.infra += row.value;
        else entry.api += row.value;
        byDate.set(row.date, entry);
      }
    }
    return Array.from(byDate.entries())
      .map(([date, { infra, api }]) => ({ date: formatDate(date), infrastructure: infra, api }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [raw]);

  const marginData = useMemo(() => {
    const byDate = new Map<string, { revenue: number; cost: number }>();
    for (const row of raw) {
      if (row.metric === 'mrr' && !row.product) {
        const entry = byDate.get(row.date) ?? { revenue: 0, cost: 0 };
        entry.revenue += row.value;
        byDate.set(row.date, entry);
      }
      if (row.metric === 'infra_cost' || row.metric === 'api_cost') {
        const entry = byDate.get(row.date) ?? { revenue: 0, cost: 0 };
        entry.cost += row.value;
        byDate.set(row.date, entry);
      }
    }
    return Array.from(byDate.entries())
      .map(([date, { revenue, cost }]) => ({
        date: formatDate(date),
        margin: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [raw]);

  // Cash flow data from Mercury
  const cashFlowData = useMemo(() => {
    const byDate = new Map<string, { inflow: number; outflow: number }>();
    for (const row of raw) {
      if (row.metric === 'cash_inflow' || row.metric === 'cash_outflow') {
        const entry = byDate.get(row.date) ?? { inflow: 0, outflow: 0 };
        if (row.metric === 'cash_inflow') entry.inflow += row.value;
        else entry.outflow += row.value;
        byDate.set(row.date, entry);
      }
    }
    return Array.from(byDate.entries())
      .map(([date, { inflow, outflow }]) => ({
        date: formatDate(date),
        inflow,
        outflow: -outflow,
        net: inflow - outflow,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [raw]);

  // Summary stats
  const latestMRR = mrrData.length > 0 ? mrrData[mrrData.length - 1].mrr : 0;
  const latestCost = costData.length > 0
    ? costData[costData.length - 1].infrastructure + costData[costData.length - 1].api
    : 0;
  const latestMargin = marginData.length > 0 ? marginData[marginData.length - 1].margin : 0;

  // Current month prefix for filtering GCP data (e.g. "2026-02")
  const currentMonthPrefix = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const currentMonthLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleString('default', { month: 'long' });
  }, []);

  // Filter GCP billing to current month for totals
  const gcpBillingCurrentMonth = useMemo(() => {
    return gcpBilling.filter((row) => {
      const date = row.usage?.date ?? row.recorded_at.split('T')[0];
      return date.startsWith(currentMonthPrefix);
    });
  }, [gcpBilling, currentMonthPrefix]);

  // GCP cost by service — current month only (pie chart & table)
  const gcpByService = useMemo(() => {
    const byService = new Map<string, number>();
    for (const row of gcpBillingCurrentMonth) {
      byService.set(row.service, (byService.get(row.service) ?? 0) + row.cost_usd);
    }
    return Array.from(byService.entries())
      .map(([service, cost]) => ({ service, cost: parseFloat(cost.toFixed(2)) }))
      .sort((a, b) => b.cost - a.cost);
  }, [gcpBillingCurrentMonth]);

  // Filtered version for the pie chart — drop zero & near-zero cost items
  const gcpByServiceForPie = useMemo(() => {
    return gcpByService.filter((s) => s.cost >= 0.01).slice(0, 8);
  }, [gcpByService]);

  // GCP daily cost trend (stacked by top services)
  const gcpDailyTrend = useMemo(() => {
    const topServices = gcpByService.slice(0, 6).map((s) => s.service);
    const byDate = new Map<string, Record<string, number>>();
    for (const row of gcpBilling) {
      const date = row.usage?.date ?? row.recorded_at.split('T')[0];
      const entry = byDate.get(date) ?? {};
      const key = topServices.includes(row.service) ? row.service : 'other';
      entry[key] = (entry[key] ?? 0) + row.cost_usd;
      byDate.set(date, entry);
    }
    return Array.from(byDate.entries())
      .map(([date, services]) => ({ date: formatDate(date), ...services }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [gcpBilling, gcpByService]);

  const gcpTopServices = useMemo(() => {
    const top = gcpByService.slice(0, 6).map((s) => s.service);
    if (gcpByService.length > 6) top.push('other');
    return top;
  }, [gcpByService]);

  const gcpTotalCost = gcpByService.reduce((sum, s) => sum + s.cost, 0);

  // GCP cost by product — current month only (pie chart)
  const gcpByProduct = useMemo(() => {
    const byProduct = new Map<string, number>();
    for (const row of gcpBillingCurrentMonth) {
      const label = row.product ?? 'unassigned';
      byProduct.set(label, (byProduct.get(label) ?? 0) + row.cost_usd);
    }
    return Array.from(byProduct.entries())
      .map(([product, cost]) => ({ product, cost: parseFloat(cost.toFixed(2)) }))
      .filter((p) => p.cost >= 0.01)
      .sort((a, b) => b.cost - a.cost);
  }, [gcpBillingCurrentMonth]);

  // GCP cost by project — current month (table + pie)
  const gcpByProject = useMemo(() => {
    const byProject = new Map<string, number>();
    for (const row of gcpBillingCurrentMonth) {
      const label = row.project ?? 'unknown';
      byProject.set(label, (byProject.get(label) ?? 0) + row.cost_usd);
    }
    return Array.from(byProject.entries())
      .map(([project, cost]) => ({ project, product: PROJECT_TO_PRODUCT_LABEL[project] ?? null, cost: parseFloat(cost.toFixed(2)) }))
      .filter((p) => p.cost >= 0.01)
      .sort((a, b) => b.cost - a.cost);
  }, [gcpBillingCurrentMonth]);

  // GCP daily trend by project (stacked bar)
  const gcpDailyByProject = useMemo(() => {
    const projects = gcpByProject.map((p) => p.project);
    const byDate = new Map<string, Record<string, number>>();
    for (const row of gcpBilling) {
      const date = row.usage?.date ?? row.recorded_at.split('T')[0];
      const proj = row.project ?? 'unknown';
      if (!projects.includes(proj)) continue;
      const entry = byDate.get(date) ?? {};
      entry[proj] = (entry[proj] ?? 0) + row.cost_usd;
      byDate.set(date, entry);
    }
    return Array.from(byDate.entries())
      .map(([date, projs]) => ({ date: formatDate(date), ...projs }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [gcpBilling, gcpByProject]);

  // Per-project service breakdown — current month
  const gcpProjectServiceBreakdown = useMemo(() => {
    const result = new Map<string, Map<string, number>>();
    for (const row of gcpBillingCurrentMonth) {
      const proj = row.project ?? 'unknown';
      if (!result.has(proj)) result.set(proj, new Map());
      const svcMap = result.get(proj)!;
      svcMap.set(row.service, (svcMap.get(row.service) ?? 0) + row.cost_usd);
    }
    return result;
  }, [gcpBillingCurrentMonth]);

  // Mercury stats
  const latestBalance = raw.filter((r) => r.metric === 'cash_balance').sort((a, b) => b.date.localeCompare(a.date))[0]?.value ?? 0;
  const latestBurnRate = raw.filter((r) => r.metric === 'burn_rate').sort((a, b) => b.date.localeCompare(a.date))[0]?.value ?? 0;
  const runwayMonths = latestBurnRate > 0 ? latestBalance / latestBurnRate : 0;

  // Per-product MRR
  const productMRR = useMemo(() => {
    const byProduct = new Map<string, number>();
    for (const row of raw) {
      if (row.metric === 'mrr' && row.product) {
        byProduct.set(row.product, (byProduct.get(row.product) ?? 0) + row.value);
      }
    }
    return Array.from(byProduct.entries()).map(([name, mrr]) => ({ name, mrr }));
  }, [raw]);

  // ── Per-product financials ────────────────────────────────────────
  const productFinancials = useMemo(() => {
    const result: Record<string, { mrr: number; costs: number; apiCosts: number; users: number }> = {};
    for (const p of PRODUCTS) result[p] = { mrr: 0, costs: 0, apiCosts: 0, users: 0 };

    for (const row of raw) {
      if (!row.product || !result[row.product]) {
        if (row.product && !result[row.product]) result[row.product] = { mrr: 0, costs: 0, apiCosts: 0, users: 0 };
        else continue;
      }
      // Use only the latest date per metric per product
      if (row.metric === 'mrr') result[row.product].mrr = Math.max(result[row.product].mrr, row.value);
      if (row.metric === 'infra_cost') result[row.product].costs += row.value;
      if (row.metric === 'api_cost') result[row.product].apiCosts += row.value;
      if (row.metric === 'active_users') result[row.product].users = Math.max(result[row.product].users, row.value);
    }
    return result;
  }, [raw]);

  // Per-product MRR trend for comparison chart
  const productMRRTrend = useMemo(() => {
    const allDates = new Set<string>();
    const byDateProduct = new Map<string, Record<string, number>>();
    for (const row of raw) {
      if (row.metric === 'mrr' && row.product) {
        allDates.add(row.date);
        const entry = byDateProduct.get(row.date) ?? {};
        entry[row.product] = (entry[row.product] ?? 0) + row.value;
        byDateProduct.set(row.date, entry);
      }
    }
    return Array.from(allDates).sort().map((date) => ({
      date: formatDate(date),
      ...(byDateProduct.get(date) ?? {}),
    }));
  }, [raw]);

  // Per-product cost breakdown (infra + api)
  // api_billing providers already tracked in financials.api_cost — only add providers NOT in financials
  const productCostBreakdown = useMemo(() => {
    const financialsApiProviders = new Set<string>();
    for (const row of raw) {
      if (row.metric === 'api_cost' && row.details) {
        const src = (row.details as Record<string, unknown>)?.source;
        if (typeof src === 'string') financialsApiProviders.add(src);
      }
    }
    const products = new Set<string>();
    for (const row of raw) {
      if ((row.metric === 'infra_cost' || row.metric === 'api_cost') && row.product) {
        products.add(row.product);
      }
    }
    // Only include api_billing rows from providers NOT already in financials.api_cost
    const extraApiBilling = apiBilling.filter((r) => !financialsApiProviders.has(r.provider));
    for (const row of extraApiBilling) {
      if (row.product) products.add(row.product);
    }
    return Array.from(products).map((name) => {
      const f = productFinancials[name] ?? { mrr: 0, costs: 0, apiCosts: 0, users: 0 };
      const apiBillingCost = extraApiBilling.filter((r) => r.product === name).reduce((s, r) => s + r.cost_usd, 0);
      return {
        name: PRODUCT_LABELS[name] ?? name,
        infrastructure: f.costs,
        api: f.apiCosts + apiBillingCost,
      };
    }).filter((p) => p.infrastructure > 0 || p.api > 0);
  }, [raw, apiBilling, productFinancials]);

  // API billing by provider
  const apiBillingByProvider = useMemo(() => {
    const byProvider = new Map<string, { cost: number; rows: number }>();
    for (const row of apiBilling) {
      const entry = byProvider.get(row.provider) ?? { cost: 0, rows: 0 };
      entry.cost += row.cost_usd;
      entry.rows++;
      byProvider.set(row.provider, entry);
    }
    return Array.from(byProvider.entries()).map(([provider, data]) => ({ provider, ...data }));
  }, [apiBilling]);

  // Vendor subscriptions from Mercury — deduplicate by vendor name, keep latest sync date
  const subscriptions = useMemo(() => {
    const byVendor = new Map<string, { name: string; monthly: number; lastPayment: string; count: number; syncDate: string }>();
    for (const row of raw) {
      if (row.metric === 'vendor_subscription' && row.product) {
        const details = row.details as Record<string, unknown> | null;
        const existing = byVendor.get(row.product);
        if (!existing || row.date > existing.syncDate) {
          byVendor.set(row.product, {
            name: row.product,
            monthly: row.value,
            lastPayment: (details?.last_payment as string) ?? row.date,
            count: (details?.payment_count as number) ?? 0,
            syncDate: row.date,
          });
        }
      }
    }
    return Array.from(byVendor.values())
      .sort((a, b) => b.monthly - a.monthly)
      .map(({ syncDate: _s, ...rest }) => rest);
  }, [raw]);

  const totalSubscriptions = subscriptions.reduce((sum, s) => sum + s.monthly, 0);

  const financialTrend = useMemo(() => {
    const byDate = new Map<string, { revenue: number; costs: number; margin: number }>();
    for (const row of mrrData) {
      const entry = byDate.get(row.date) ?? { revenue: 0, costs: 0, margin: 0 };
      entry.revenue = row.mrr;
      byDate.set(row.date, entry);
    }
    for (const row of costData) {
      const entry = byDate.get(row.date) ?? { revenue: 0, costs: 0, margin: 0 };
      entry.costs = row.infrastructure + row.api;
      byDate.set(row.date, entry);
    }
    for (const row of marginData) {
      const entry = byDate.get(row.date) ?? { revenue: 0, costs: 0, margin: 0 };
      entry.margin = row.margin;
      byDate.set(row.date, entry);
    }
    return Array.from(byDate.entries())
      .map(([date, metrics]) => ({ date, ...metrics }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [mrrData, costData, marginData]);

  const spendMix = useMemo(() => {
    const apiTotal = apiBillingByProvider.reduce((sum, provider) => sum + provider.cost, 0);
    return [
      { name: 'Infrastructure', value: gcpTotalCost },
      { name: 'AI / API', value: apiTotal },
      { name: 'Subscriptions', value: totalSubscriptions },
    ].filter((item) => item.value > 0);
  }, [apiBillingByProvider, gcpTotalCost, totalSubscriptions]);

  const productSnapshot = useMemo(() => {
    return PRODUCTS.map((product) => {
      const f = productFinancials[product] ?? { mrr: 0, costs: 0, apiCosts: 0, users: 0 };
      const totalCost = f.costs + f.apiCosts;
      const margin = f.mrr > 0 ? ((f.mrr - totalCost) / f.mrr) * 100 : 0;
      return {
        key: product,
        name: PRODUCT_LABELS[product] ?? product,
        mrr: f.mrr,
        totalCost,
        margin,
      };
    });
  }, [productFinancials]);

  const marginDelta = latestMRR > 0 ? (((latestMRR - latestCost) / latestMRR) * 100) - latestMargin : 0;

  const aiProviderMetrics = useMemo(() => {
    const providerDateCost = new Map<string, Map<string, number>>();
    const ensure = (provider: string) => {
      if (!providerDateCost.has(provider)) providerDateCost.set(provider, new Map<string, number>());
      return providerDateCost.get(provider)!;
    };

    for (const row of apiBilling) {
      const provider = String(row.provider ?? '').toLowerCase();
      if (provider !== 'openai' && provider !== 'anthropic') continue;
      const date = (row.recorded_at ?? '').split('T')[0];
      if (!date) continue;
      const byDate = ensure(provider);
      byDate.set(date, (byDate.get(date) ?? 0) + (Number(row.cost_usd) || 0));
    }

    for (const row of gcpBilling) {
      const service = String(row.service ?? '').toLowerCase();
      const rawService = String(row.usage?.raw_service ?? '').toLowerCase();
      const isGeminiService = service.includes('gemini') || rawService.includes('gemini');
      const isVertexAiService = service.includes('vertex') || rawService.includes('vertex');
      if (!isGeminiService && !isVertexAiService) continue;
      const date = row.usage?.date ?? (row.recorded_at ?? '').split('T')[0];
      if (!date) continue;
      const byDate = ensure('gemini');
      byDate.set(date, (byDate.get(date) ?? 0) + (Number(row.cost_usd) || 0));
    }

    const today = new Date().toISOString().split('T')[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prev2MonthDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const prev2MonthKey = `${prev2MonthDate.getFullYear()}-${String(prev2MonthDate.getMonth() + 1).padStart(2, '0')}`;

    const providers = ['openai', 'gemini', 'anthropic'];
    return providers.map((provider) => {
      const byDate = providerDateCost.get(provider) ?? new Map<string, number>();
      let total7d = 0;
      let total30d = 0;
      const monthTotals = new Map<string, number>();
      for (const [date, cost] of byDate.entries()) {
        const d = new Date(date);
        if (d >= sevenDaysAgo) total7d += cost;
        if (d >= thirtyDaysAgo) total30d += cost;
        const monthKey = date.slice(0, 7);
        monthTotals.set(monthKey, (monthTotals.get(monthKey) ?? 0) + cost);
      }
      const thisMonth = monthTotals.get(currentMonthKey) ?? 0;
      const lastMonth = monthTotals.get(lastMonthKey) ?? 0;
      const prev2Month = monthTotals.get(prev2MonthKey) ?? 0;
      return {
        provider,
        today: byDate.get(today) ?? 0,
        avg7d: total7d / 7,
        total30d,
        thisMonth,
        lastMonth,
        avg3mo: (thisMonth + lastMonth + prev2Month) / 3,
      };
    });
  }, [apiBilling, gcpBilling]);

  const todayAiCost = aiProviderMetrics.reduce((sum, row) => sum + row.today, 0);

  return (
    <div className="outer-cards-transparent space-y-5">
      <div className="glass-surface rounded-2xl border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-txt-primary">Financials</h1>
            <p className="mt-1 text-sm text-txt-muted">A tighter readout focused on runway, margin, and spend concentration.</p>
          </div>
          <div className="flex items-center gap-2">
            <GradientButton variant="neutral" onClick={() => setShowSyncPanel((v) => !v)}>
              {showSyncPanel ? 'Hide Sources' : 'Source Sync Status'}
            </GradientButton>
            <GradientButton
              variant="primary"
              onClick={triggerAllSyncs}
              disabled={syncingIds.size > 0}
            >
              {syncingIds.size > 0 ? 'Syncing…' : 'Refresh All'}
            </GradientButton>
          </div>
        </div>
      </div>

      {showSyncPanel && (
        <Card className="h-full">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Source Sync Status</p>
          </div>
          {syncLoading ? <Skeleton className="h-16" /> : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {FINANCIAL_SYNCS.map((sync) => {
                const s = syncStatuses.find((st) => st.id === sync.id);
                const isOk = s?.status === 'ok';
                const isFailing = s?.status === 'failing';
                const isSyncing = syncingIds.has(sync.id);
                return (
                  <div key={sync.id} className="glass-surface flex items-center justify-between rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className={`h-2 w-2 flex-shrink-0 rounded-full ${isOk ? 'bg-green-500' : isFailing ? 'bg-red-500' : 'bg-yellow-500'}`} />
                        <p className="truncate text-xs font-medium text-txt-primary">{sync.label}</p>
                      </div>
                      <p className="mt-0.5 text-[10px] text-txt-faint">
                        {s?.last_success_at ? timeAgo(s.last_success_at) : 'never synced'}
                        {isFailing && s?.consecutive_failures ? ` · ${s.consecutive_failures} failures` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => triggerSync(sync.endpoint, sync.id)}
                      disabled={isSyncing}
                      className="ml-2 flex-shrink-0 rounded px-2 py-0.5 text-[10px] font-medium text-accent transition hover:bg-accent/10 disabled:opacity-50"
                    >
                      {isSyncing ? '…' : '↻'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryCard label="Monthly Revenue" value={`$${fmt(latestMRR)}`} loading={loading} sub="Stripe MRR snapshot" color="#00E0FF" />
        <SummaryCard label="Bank Balance" value={`$${fmt(latestBalance)}`} loading={loading} sub="Latest Mercury balance" color="#C084FC" />
        <SummaryCard label="Gross Margin" value={`${latestMargin.toFixed(1)}%`} loading={loading} sub={`${marginDelta >= 0 ? '+' : ''}${marginDelta.toFixed(1)} pts from trend baseline`} color="#7DD3FC" />
        <SummaryCard label="Burn Rate" value={latestBurnRate > 0 ? `$${fmt(latestBurnRate)}` : '—'} loading={loading} sub="Monthly cash outflow" color="#A855F7" />
        <SummaryCard label="AI Billing Today" value={`$${todayAiCost.toFixed(2)}`} loading={apiLoading || gcpLoading} sub="OpenAI + Gemini + Anthropic" color="#3730A3" />
        <SummaryCard label="Runway" value={runwayMonths > 0 ? `${runwayMonths.toFixed(1)} mo` : '—'} loading={loading} sub={runwayMonths > 0 ? 'Based on current burn' : 'Awaiting burn data'} color="#581C87" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="h-full xl:col-span-2">
          <SectionHeader title="Revenue vs Cost Trend" />
          {loading ? (
            <Skeleton className="h-64" />
          ) : financialTrend.length === 0 ? (
            <EmptyChart message="No revenue or cost trend data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={financialTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${fmt(Number(v))}`} />
                <Tooltip
                  cursor={{ fill: 'transparent' }}
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-txt-secondary)' }}
                  formatter={(value: number, name: string) => {
                    if (name === 'margin') return [`${value.toFixed(1)}%`, 'Margin'];
                    return [`$${fmt(value)}`, name === 'revenue' ? 'Revenue' : 'Costs'];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="revenue" stroke="#22D3EE" strokeWidth={2.5} dot={false} name="Revenue" />
                <Line type="monotone" dataKey="costs" stroke="#FB7185" strokeWidth={2.5} dot={false} name="Costs" />
                <Line type="monotone" dataKey="margin" stroke="#A78BFA" strokeWidth={2} dot={false} yAxisId={1} name="Margin" />
                <YAxis yAxisId={1} orientation="right" tickFormatter={(v) => `${Number(v).toFixed(0)}%`} domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--color-txt-faint)' }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="h-full">
          <SectionHeader title={`${currentMonthLabel} Spend Mix`} />
          {apiLoading || gcpLoading ? (
            <Skeleton className="h-64" />
          ) : spendMix.length === 0 ? (
            <EmptyChart message="No spend mix data yet" />
          ) : (
            <div className="space-y-3">
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie data={spendMix} dataKey="value" nameKey="name" outerRadius={80} innerRadius={46} paddingAngle={2}>
                    {spendMix.map((slice, i) => (
                      <Cell key={slice.name} fill={API_COLORS[i % API_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    cursor={{ fill: 'transparent' }}
                    contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 text-xs">
                {spendMix.map((slice, i) => {
                  const total = spendMix.reduce((sum, s) => sum + s.value, 0);
                  const pct = total > 0 ? (slice.value / total) * 100 : 0;
                  return (
                    <div key={slice.name} className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
                      <span className="flex items-center gap-2 text-txt-secondary">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: API_COLORS[i % API_COLORS.length] }} />
                        {slice.name}
                      </span>
                      <span className="font-mono text-txt-primary">${slice.value.toFixed(2)} · {pct.toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card className="h-full !p-4">
        <div className="mb-2 flex items-center justify-between">
          <SectionHeader title="Daily AI Billing" />
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border bg-raised p-0.5 text-[10px]">
              <button
                onClick={() => setAiBillingView('daily')}
                className={`rounded px-2 py-0.5 transition ${aiBillingView === 'daily' ? 'bg-cyan/15 text-cyan' : 'text-txt-muted hover:text-txt-secondary'}`}
              >
                Daily
              </button>
              <button
                onClick={() => setAiBillingView('monthly')}
                className={`rounded px-2 py-0.5 transition ${aiBillingView === 'monthly' ? 'bg-cyan/15 text-cyan' : 'text-txt-muted hover:text-txt-secondary'}`}
              >
                Monthly
              </button>
            </div>
            <span className="text-[11px] text-txt-faint">Sources: api_billing + gemini-api</span>
          </div>
        </div>
        {apiLoading || gcpLoading ? (
          <Skeleton className="h-36" />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                  <th className="px-3 py-2 text-left font-medium text-txt-muted">Provider</th>
                  <th className="px-3 py-2 text-right font-medium text-txt-muted">{aiBillingView === 'daily' ? 'Today' : 'This Month'}</th>
                  <th className="px-3 py-2 text-right font-medium text-txt-muted">{aiBillingView === 'daily' ? '7d Avg / Day' : 'Last Month'}</th>
                  <th className="px-3 py-2 text-right font-medium text-txt-muted">{aiBillingView === 'daily' ? '30d Total' : '3mo Avg / Month'}</th>
                </tr>
              </thead>
              <tbody>
                {aiProviderMetrics.map((row) => (
                  <tr key={row.provider} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-3 py-2 font-medium capitalize text-txt-primary">{row.provider}</td>
                    {aiBillingView === 'daily' ? (
                      <>
                        <td className="px-3 py-2 text-right font-mono text-txt-secondary">${row.today.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono text-txt-secondary">${row.avg7d.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono text-txt-secondary">${row.total30d.toFixed(2)}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-right font-mono text-txt-secondary">${row.thisMonth.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono text-txt-secondary">${row.lastMonth.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono text-txt-secondary">${row.avg3mo.toFixed(2)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Product Profitability + Top Subscriptions — secondary/admin: depends on mature product attribution */}
      {SHOW_SECONDARY_PANELS && <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="h-full xl:col-span-2">
          <SectionHeader title="Product Profitability Snapshot" />
          {loading ? (
            <Skeleton className="h-64" />
          ) : productSnapshot.every((p) => p.mrr === 0 && p.totalCost === 0) ? (
            <EmptyChart message="No product-level financial data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={productSnapshot}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${fmt(Number(v))}`} />
                <Tooltip
                  cursor={{ fill: 'transparent' }}
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number, name: string) => {
                    if (name === 'margin') return [`${value.toFixed(1)}%`, 'Margin'];
                    return [`$${value.toFixed(2)}`, name === 'mrr' ? 'Revenue' : 'Cost'];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="mrr" fill="#22D3EE" name="Revenue" radius={[6, 6, 0, 0]} />
                <Bar dataKey="totalCost" fill="#FB7185" name="Cost" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="h-full">
          <SectionHeader title="Top Subscriptions" />
          {loading ? (
            <Skeleton className="h-64" />
          ) : subscriptions.length === 0 ? (
            <EmptyChart message="No subscription data yet" />
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-txt-faint">Total recurring vendor spend: <span className="font-mono text-txt-primary">${totalSubscriptions.toFixed(2)}/mo</span></p>
              {subscriptions.slice(0, 7).map((sub) => {
                const providerMeta = getProviderIcon(sub.name);
                return (
                <div key={sub.name} className="glass-surface flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <div className="flex items-center gap-3">
                    {providerMeta ? (
                      <providerMeta.icon className="h-5 w-5 flex-shrink-0" style={{ color: providerMeta.color }} />
                    ) : (
                      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[10px] font-bold text-txt-muted">
                        {sub.name[0]}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-txt-primary">{sub.name}</p>
                      <p className="text-[11px] text-txt-faint">Last payment {formatDate(sub.lastPayment)} · {sub.count} payments</p>
                    </div>
                  </div>
                  <p className="font-mono text-sm text-txt-secondary">${sub.monthly.toFixed(2)}</p>
                </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>}

      {/* Cost Structure by Product — secondary/admin: depends on mature product attribution */}
      {SHOW_SECONDARY_PANELS && <Card className="h-full !p-4">
        <SectionHeader title="Cost Structure by Product" />
        {loading ? (
          <Skeleton className="h-52" />
        ) : productCostBreakdown.length === 0 ? (
          <EmptyChart message="No product cost data yet" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={productCostBreakdown}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${fmt(Number(v))}`} />
              <Tooltip
                cursor={{ fill: 'transparent' }}
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                formatter={(value: number, name: string) => [`$${value.toFixed(2)}`, name === 'infrastructure' ? 'Infrastructure' : 'API / AI']}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="infrastructure" fill="#60A5FA" stackId="costs" name="Infrastructure" />
              <Bar dataKey="api" fill="#C084FC" stackId="costs" name="API / AI" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>}
    </div>
  );
}

const PRODUCTS = ['web-build', 'pulse', 'reve'] as const;
const PRODUCT_COLORS: Record<string, string> = { 'web-build': '#2563EB', pulse: '#7C3AED', reve: '#0891B2', glyphor: '#6366F1', unassigned: '#94A3B8' };
const PRODUCT_LABELS: Record<string, string> = { 'web-build': 'Web Build', pulse: 'Pulse', reve: 'Reve', glyphor: 'Glyphor', unassigned: 'Unassigned' };
const PROJECT_TO_PRODUCT_LABEL: Record<string, string> = { 'ai-glyphor-company': 'Glyphor', 'glyphor-pulse': 'Pulse', 'gen-lang-client-0834143721': 'Web Build' };
const GCP_COLORS = [...GLYPHOR_PALETTE];
const GCP_SERVICE_COLORS: Record<string, string> = {
  'gemini-api': '#2563EB', sql: '#6366F1', run: '#00A3C4',
  'memorystore-for-redis': '#7C3AED', 'artifact-registry': '#A855F7',
  compute: '#0891B2', storage: '#C084FC', networking: '#2563EB',
};
const API_COLORS = ['#7C3AED', '#2563EB', '#0891B2', '#6366F1', '#A855F7'];
const VERIF_COLORS: Record<string, string> = { none: '#2563EB', self_critique: '#00A3C4', cross_model: '#6366F1', conditional: '#7C3AED', unknown: '#94A3B8' };
const VERIF_LABELS: Record<string, string> = { none: 'None', self_critique: 'Self-critique', cross_model: 'Cross-model', conditional: 'Conditional', unknown: 'Unknown' };
const COMPLEXITY_COLORS: Record<string, string> = { trivial: '#00A3C4', standard: '#2563EB', complex: '#6366F1', frontier: '#7C3AED', unknown: '#94A3B8' };
const COMPLEXITY_LABELS: Record<string, string> = { trivial: 'Trivial', standard: 'Standard', complex: 'Complex', frontier: 'Frontier', unknown: 'Unknown' };

function SummaryCard({ label, value, loading, sub, color }: { label: string; value: string; loading: boolean; sub?: string; color?: string }) {
  if (loading) return <Skeleton className="h-[76px]" />;
  return (
    <div
      className="glass-surface flex h-[76px] flex-col justify-between rounded-xl px-3.5 py-3"
      style={color ? { borderTopColor: color, borderTopWidth: '2px' } : undefined}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={color ? { color } : undefined}>{label}</p>
      <div>
        <p className="font-mono text-lg font-semibold leading-none dark:text-white text-txt-primary">{value}</p>
        {sub && <p className="mt-1 line-clamp-1 text-[10px] dark:text-white/45 text-txt-muted">{sub}</p>}
      </div>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-64 items-center justify-center">
      <p className="text-sm text-txt-faint">{message}</p>
    </div>
  );
}

function formatDate(d: string) {
  const parts = d.split('-');
  return `${parts[1]}/${parts[2]}`;
}

function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);
}
