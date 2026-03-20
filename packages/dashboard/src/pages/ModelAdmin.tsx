import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../lib/firebase';
import { Card, SectionHeader, PageTabs } from '../components/ui';

// ── Types ────────────────────────────────────────────────────

interface ModelRegistryRow {
  id: string;
  slug: string;
  provider: string;
  tier: string;
  display_name: string;
  input_cost_per_m: number;
  output_cost_per_m: number;
  context_window: number;
  max_output: number | null;
  supports_tools: boolean;
  supports_vision: boolean;
  supports_thinking: boolean;
  is_preview: boolean;
  is_active: boolean;
  deprecated_at: string | null;
  shutdown_at: string | null;
  notes: string | null;
  updated_at: string;
}

interface RoutingConfigRow {
  id: string;
  route_name: string;
  model_slug: string;
  description: string | null;
  priority: number;
  is_active: boolean;
  updated_at: string;
  updated_by: string | null;
}

type Tab = 'routing' | 'registry' | 'deprecations';

// ── Helpers ──────────────────────────────────────────────────

const TIER_COLORS: Record<string, string> = {
  economy: 'text-white bg-gradient-to-r from-green-400 via-green-500 to-green-600',
  workhorse: 'text-white bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700',
  pro: 'text-white bg-gradient-to-r from-purple-500 via-purple-600 to-purple-700',
  specialist: 'text-white bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600',
};

const PROVIDER_COLORS: Record<string, string> = {
  gemini: 'text-white bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700',
  openai: 'text-white bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-600',
  anthropic: 'text-white bg-gradient-to-r from-orange-400 via-orange-500 to-orange-600',
};

function Badge({ label, colorClass }: { label: string; colorClass: string }) {
  return <span className={`inline-block rounded-lg px-2 py-0.5 text-xs font-medium ${colorClass}`}>{label}</span>;
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatCost(n: number): string {
  return n < 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(2)}`;
}

// ── Component ────────────────────────────────────────────────

export default function ModelAdmin() {
  const [tab, setTab] = useState<Tab>('routing');
  const [models, setModels] = useState<ModelRegistryRow[]>([]);
  const [routes, setRoutes] = useState<RoutingConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([
        apiCall<ModelRegistryRow[]>('/api/model-registry?order=tier,slug'),
        apiCall<RoutingConfigRow[]>('/api/routing-config?order=priority.desc'),
      ]);
      setModels(m ?? []);
      setRoutes(r ?? []);
    } catch (e) {
      console.error('ModelAdmin fetch error:', e);
      setError('Failed to load model data');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const activeModels = models.filter(m => m.is_active);
  const activeModelSlugs = activeModels.map(m => m.slug);

  // ── Swap model on a route ──────────────────────────────────
  const handleSwap = async (routeName: string, newSlug: string) => {
    setSaving(routeName);
    setError('');
    try {
      await apiCall(`/api/routing-config?route_name=${encodeURIComponent(routeName)}`, {
        method: 'PATCH',
        body: JSON.stringify({ model_slug: newSlug, updated_at: new Date().toISOString(), updated_by: 'dashboard' }),
      });
      await fetchData();
    } catch (e) {
      console.error('Swap error:', e);
      setError(`Failed to update route "${routeName}"`);
    }
    setSaving(null);
  };

  // ── Deprecation data ───────────────────────────────────────
  const deprecations = models.filter(m => m.shutdown_at);
  const activeRouteSlugs = new Set(routes.filter(r => r.is_active).map(r => r.model_slug));

  if (loading) return <div className="p-8 text-center opacity-50">Loading model registry…</div>;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <SectionHeader title="Model Routing" subtitle="Hot-swap model assignments without code deploys." />

      {error && <div className="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-400">{error}</div>}

      <PageTabs
        tabs={[
          { key: 'routing', label: 'Routing' },
          { key: 'registry', label: 'Registry' },
          { key: 'deprecations', label: `Deprecations${deprecations.length ? ` (${deprecations.length})` : ''}` },
        ]}
        active={tab}
        onChange={(key) => setTab(key as Tab)}
      />

      {/* ── Tab: Routing ──────────────────────── */}
      {tab === 'routing' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider opacity-60">
                  <th className="pb-2 pr-4">Route</th>
                  <th className="pb-2 pr-4">Current Model</th>
                  <th className="pb-2 pr-4">Swap To</th>
                  <th className="pb-2 pr-4">Priority</th>
                  <th className="pb-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {routes.map(r => {
                  const model = models.find(m => m.slug === r.model_slug);
                  return (
                    <tr key={r.route_name} className="border-b border-white/5">
                      <td className="py-2 pr-4 font-mono text-xs">{r.route_name}</td>
                      <td className="py-2 pr-4">
                        <span className="font-medium">{model?.display_name ?? r.model_slug}</span>
                        {model && (
                          <span className="ml-2 text-xs opacity-50">
                            {formatCost(model.input_cost_per_m)}/{formatCost(model.output_cost_per_m)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <select
                          className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs"
                          value={r.model_slug}
                          disabled={saving === r.route_name}
                          onChange={e => handleSwap(r.route_name, e.target.value)}
                        >
                          {activeModelSlugs.map(slug => (
                            <option key={slug} value={slug}>{slug}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-4 text-center font-mono text-xs opacity-60">{r.priority}</td>
                      <td className="py-2 text-xs opacity-60">{r.description}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs opacity-40">Changes propagate within 5 minutes via route cache TTL.</p>
        </Card>
      )}

      {/* ── Tab: Registry ─────────────────────── */}
      {tab === 'registry' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider opacity-60">
                  <th className="pb-2 pr-4">Model</th>
                  <th className="pb-2 pr-4">Provider</th>
                  <th className="pb-2 pr-4">Tier</th>
                  <th className="pb-2 pr-4 text-right">Input/1M</th>
                  <th className="pb-2 pr-4 text-right">Output/1M</th>
                  <th className="pb-2 pr-4 text-right">Context</th>
                  <th className="pb-2 pr-4">Capabilities</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {models.filter(m => m.is_active).map(m => (
                  <tr key={m.slug} className="border-b border-white/5">
                    <td className="py-2 pr-4">
                      <span className="font-medium">{m.display_name}</span>
                      <span className="ml-2 font-mono text-xs opacity-40">{m.slug}</span>
                    </td>
                    <td className="py-2 pr-4"><Badge label={m.provider} colorClass={PROVIDER_COLORS[m.provider] ?? ''} /></td>
                    <td className="py-2 pr-4"><Badge label={m.tier} colorClass={TIER_COLORS[m.tier] ?? ''} /></td>
                    <td className="py-2 pr-4 text-right font-mono text-xs">{formatCost(m.input_cost_per_m)}</td>
                    <td className="py-2 pr-4 text-right font-mono text-xs">{formatCost(m.output_cost_per_m)}</td>
                    <td className="py-2 pr-4 text-right font-mono text-xs">{(m.context_window / 1000).toFixed(0)}K</td>
                    <td className="py-2 pr-4 space-x-1">
                      {m.supports_tools && <span className="text-xs opacity-50">🔧</span>}
                      {m.supports_vision && <span className="text-xs opacity-50">👁</span>}
                      {m.supports_thinking && <span className="text-xs opacity-50">🧠</span>}
                    </td>
                    <td className="py-2">
                      {m.is_preview && <Badge label="preview" colorClass="text-white bg-gradient-to-r from-yellow-400 via-yellow-500 to-yellow-600" />}
                      {!m.is_preview && <Badge label="stable" colorClass="text-white bg-gradient-to-r from-green-400 via-green-500 to-green-600" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Tab: Deprecations ─────────────────── */}
      {tab === 'deprecations' && (
        <Card>
          {deprecations.length === 0 ? (
            <p className="py-8 text-center opacity-40">No models with upcoming deprecation dates.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider opacity-60">
                    <th className="pb-2 pr-4">Model</th>
                    <th className="pb-2 pr-4">Shutdown Date</th>
                    <th className="pb-2 pr-4">Days Left</th>
                    <th className="pb-2 pr-4">Used In Routes</th>
                    <th className="pb-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {deprecations.map(m => {
                    const days = m.shutdown_at ? daysUntil(m.shutdown_at) : null;
                    const usedRoutes = routes.filter(r => r.model_slug === m.slug && r.is_active);
                    return (
                      <tr key={m.slug} className="border-b border-white/5">
                        <td className="py-2 pr-4 font-medium">{m.display_name}</td>
                        <td className="py-2 pr-4 font-mono text-xs">{m.shutdown_at?.split('T')[0] ?? '—'}</td>
                        <td className="py-2 pr-4">
                          {days !== null && (
                            <Badge
                              label={`${days}d`}
                              colorClass={days < 30 ? 'text-white bg-gradient-to-r from-red-400 via-red-500 to-red-600' : 'text-white bg-gradient-to-r from-yellow-400 via-yellow-500 to-yellow-600'}
                            />
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {usedRoutes.length > 0 ? (
                            <span className="text-red-400 font-medium">
                              {usedRoutes.map(r => r.route_name).join(', ')}
                            </span>
                          ) : (
                            <span className="opacity-40">None</span>
                          )}
                        </td>
                        <td className="py-2 text-xs opacity-60">{m.notes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
