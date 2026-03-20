import { useEffect, useState, useCallback } from 'react';
import { apiCall } from '../lib/firebase';
import { Card, GradientButton, SectionHeader, Skeleton, timeAgo, PageTabs } from '../components/ui';
import {
  MdConstruction, MdRocketLaunch, MdCelebration, MdFitnessCenter,
  MdTrackChanges, MdWarning, MdHelpOutline, MdExpandMore, MdClose, MdArrowForward,
} from 'react-icons/md';
import type { IconType } from 'react-icons';
import Graph from './Graph';

/* ── Types ─────────────────────────────────────── */

interface KBSection {
  id: string;
  section: string;
  title: string;
  content: string;
  audience: string;
  last_edited_by: string;
  version: number;
  is_active: boolean;
  updated_at: string;
  layer?: number;
  owner_agent_id?: string | null;
  is_stale?: boolean;
  auto_expire?: boolean;
  last_verified_at?: string | null;
  review_cadence?: string;
  days_since_verified?: number;
}

interface Bulletin {
  id: string;
  created_by: string;
  content: string;
  audience: string;
  priority: string;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

interface Pulse {
  id: string;
  mrr: number;
  mrr_change_pct: number;
  active_users: number;
  platform_status: string;
  company_mood: string;
  highlights: { agent: string; type: string; text: string }[];
  updated_at: string;
}

interface KGStats {
  total_nodes: number;
  total_edges: number;
  node_types: Record<string, number>;
}

/* ── Constants ─────────────────────────────────── */

const AUDIENCES = ['all', 'executives', 'engineering', 'finance', 'product', 'marketing', 'sales', 'customer_success', 'design', 'operations',
  'marketing,sales,executive', 'executive,finance,operations', 'executive,operations', 'engineering,operations',
  'marketing,sales,research,executive', 'marketing,sales'] as const;
const PRIORITIES = ['fyi', 'normal', 'important', 'urgent'] as const;

const PRIORITY_STYLE: Record<string, { dot: string; text: string; bg: string; border: string }> = {
  urgent:    { dot: 'bg-prism-critical',  text: 'text-prism-critical',  bg: 'bg-prism-critical/10',  border: 'border-prism-critical/30' },
  important: { dot: 'bg-prism-high',      text: 'text-prism-high',      bg: 'bg-prism-high/10',      border: 'border-prism-high/30' },
  normal:    { dot: 'bg-prism-fill-3',    text: 'text-prism-sky',       bg: 'bg-prism-fill-3/10',    border: 'border-prism-fill-3/30' },
  fyi:       { dot: 'bg-prism-moderate',  text: 'text-prism-moderate',  bg: 'bg-prism-moderate/10',  border: 'border-prism-moderate/30' },
};

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  healthy:  { label: 'Healthy',  color: 'text-prism-teal',     bg: 'bg-prism-fill-2/15' },
  degraded: { label: 'Degraded', color: 'text-prism-elevated',  bg: 'bg-prism-elevated/15' },
  outage:   { label: 'Outage',   color: 'text-prism-critical',  bg: 'bg-prism-critical/15' },
};

const MOOD_ICON: Record<string, IconType> = {
  building: MdConstruction, shipping: MdRocketLaunch, celebrating: MdCelebration, grinding: MdFitnessCenter,
  focused: MdTrackChanges, cautious: MdWarning, uncertain: MdHelpOutline,
};

/* ── Page ──────────────────────────────────────── */

type Tab = 'base' | 'graph';

export default function Knowledge() {
  const [tab, setTab] = useState<Tab>('base');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-txt-primary">Knowledge</h1>
        <p className="mt-1 text-sm text-txt-muted">
          Company knowledge base, founder bulletins, and organizational intelligence
        </p>
      </div>
      <PageTabs
        tabs={[
          { key: 'base' as Tab, label: 'Knowledge Base' },
          { key: 'graph' as Tab, label: 'Graph Explorer' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'graph' ? <Graph /> : <KnowledgeBase />}
    </div>
  );
}

function KnowledgeBase() {
  const [sections, setSections] = useState<KBSection[]>([]);
  const [bulletins, setBulletins] = useState<Bulletin[]>([]);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [kgStats, setKgStats] = useState<KGStats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [kbData, bulData, pulseData, nodesData, edgesData] = await Promise.all([
      apiCall<KBSection[]>('/api/knowledge/status'),
      apiCall<Bulletin[]>('/api/founder-bulletins?is_active=true'),
      apiCall<Pulse>('/api/company-vitals'),
      apiCall<{ node_type: string }[]>('/api/kg-nodes?fields=node_type'),
      apiCall<{ count: number }>('/api/kg-edges?count=true'),
    ]);

    setSections(kbData ?? []);
    setBulletins(bulData ?? []);
    setPulse(pulseData ?? null);

    // Compute KG stats
    const nodes = (nodesData ?? []) as { node_type: string }[];
    const typeCounts: Record<string, number> = {};
    for (const n of nodes) {
      typeCounts[n.node_type] = (typeCounts[n.node_type] ?? 0) + 1;
    }
    setKgStats({
      total_nodes: nodes.length,
      total_edges: (edgesData as any)?.count ?? 0,
      node_types: typeCounts,
    });

    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Real-time
  // Real-time not available after Firebase migration
  useEffect(() => {}, [refresh]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ─── Health Summary ──────────── */}
      <HealthSummary sections={sections} bulletins={bulletins} pulse={pulse} kgStats={kgStats} />

      {/* ─── Company Vitals ────────── */}
      <PulseWidget pulse={pulse} onRefresh={refresh} />

      {/* ─── Founder Bulletins ────────── */}
      <BulletinSection bulletins={bulletins} onRefresh={refresh} />

      {/* ─── Knowledge Base Editor ────── */}
      <KBEditor sections={sections} onRefresh={refresh} />

      {/* ─── Knowledge Graph Summary ──── */}
      <KGSummary stats={kgStats} />
    </div>
  );
}

/* ── Health Summary ───────────────────────────── */

function HealthSummary({
  sections, bulletins, pulse, kgStats,
}: {
  sections: KBSection[];
  bulletins: Bulletin[];
  pulse: Pulse | null;
  kgStats: KGStats | null;
}) {
  const layers = [
    { name: 'Knowledge Base', status: sections.length > 0, detail: `${sections.length} sections` },
    { name: 'Founder Bulletins', status: true, detail: `${bulletins.length} active` },
    { name: 'Company Heartbeat', status: !!pulse, detail: pulse ? `Updated ${timeAgo(pulse.updated_at)}` : 'Missing' },
    { name: 'Knowledge Graph', status: (kgStats?.total_nodes ?? 0) > 0, detail: `${kgStats?.total_nodes ?? 0} nodes, ${kgStats?.total_edges ?? 0} edges` },
  ];

  const healthyCount = layers.filter(l => l.status).length;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-txt-primary">Knowledge Health</h2>
        <span className={`rounded-lg px-2.5 py-0.5 text-[11px] font-semibold ${
          healthyCount === layers.length
            ? 'text-white bg-gradient-to-r from-teal-400 via-teal-500 to-teal-600'
            : healthyCount >= 3
            ? 'text-white bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600'
            : 'text-white bg-gradient-to-r from-red-400 via-red-500 to-red-600'
        }`}>
          {healthyCount}/{layers.length} layers active
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {layers.map(l => (
          <div key={l.name} className="glass-surface rounded-xl px-3 py-2.5" style={{ borderTopColor: l.status ? '#34D399' : '#EF4444', borderTopWidth: '2px' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`h-2 w-2 rounded-full ${l.status ? 'bg-prism-fill-2' : 'bg-prism-critical'}`} />
              <span className="text-[12px] font-medium text-txt-primary">{l.name}</span>
            </div>
            <p className="text-[11px] text-txt-muted">{l.detail}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── Company Heartbeat Widget ─────────────────── */

function PulseWidget({ pulse, onRefresh }: { pulse: Pulse | null; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ mrr: 0, active_users: 0, platform_status: 'healthy', company_mood: 'building' });

  useEffect(() => {
    if (pulse) {
      setForm({
        mrr: pulse.mrr,
        active_users: pulse.active_users,
        platform_status: pulse.platform_status,
        company_mood: pulse.company_mood,
      });
    }
  }, [pulse]);

  async function handleSave() {
    setSaving(true);
    try {
      await apiCall('/api/company-vitals/current', {
        method: 'PATCH',
        body: JSON.stringify({
          mrr: form.mrr,
          active_users: form.active_users,
          platform_status: form.platform_status,
          company_mood: form.company_mood,
          updated_at: new Date().toISOString(),
        }),
      });
      setEditing(false);
      onRefresh();
    } catch (err) {
      alert(`Save failed: ${(err as Error).message}`);
    }
    setSaving(false);
  }

  if (!pulse) {
    return (
      <Card>
        <SectionHeader title="Company Vitals" />
        <p className="text-sm text-txt-faint">No vitals data available. Run the migration to seed initial values.</p>
      </Card>
    );
  }

  const st = STATUS_STYLE[pulse.platform_status] ?? STATUS_STYLE.healthy;
  const MoodIcon = MOOD_ICON[pulse.company_mood] ?? MdHelpOutline;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-txt-primary">Company Vitals</h2>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-txt-faint">Updated {timeAgo(pulse.updated_at)}</span>
          <button
            onClick={() => setEditing(!editing)}
            className="rounded-md border border-primary/20 px-2.5 py-1 text-[11px] font-medium text-txt-muted hover:text-txt-primary transition-colors"
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-medium text-txt-muted mb-1 block">MRR ($)</label>
              <input
                type="number"
                value={form.mrr}
                onChange={e => setForm(f => ({ ...f, mrr: Number(e.target.value) }))}
                className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-txt-muted mb-1 block">Active Users</label>
              <input
                type="number"
                value={form.active_users}
                onChange={e => setForm(f => ({ ...f, active_users: Number(e.target.value) }))}
                className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-txt-muted mb-1 block">Platform Status</label>
              <select
                value={form.platform_status}
                onChange={e => setForm(f => ({ ...f, platform_status: e.target.value }))}
                className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none"
              >
                {Object.keys(STATUS_STYLE).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-txt-muted mb-1 block">Company Mood</label>
              <select
                value={form.company_mood}
                onChange={e => setForm(f => ({ ...f, company_mood: e.target.value }))}
                className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none"
              >
                {Object.keys(MOOD_ICON).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <GradientButton
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </GradientButton>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MetricCard label="MRR" value={`$${(pulse.mrr ?? 0).toLocaleString()}`} sub={`${(pulse.mrr_change_pct ?? 0) >= 0 ? '+' : ''}${(pulse.mrr_change_pct ?? 0)}% MoM`} positive={(pulse.mrr_change_pct ?? 0) >= 0} />
            <MetricCard label="Active Users" value={String(pulse.active_users ?? 0)} />
            <div className="glass-surface rounded-xl px-3 py-2.5" style={{ borderTopColor: '#F59E0B', borderTopWidth: '2px' }}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#F59E0B' }}>Platform Status</p>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold ${st.bg} ${st.color}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${
                  pulse.platform_status === 'healthy' ? 'bg-prism-fill-2' :
                  pulse.platform_status === 'degraded' ? 'bg-prism-elevated animate-pulse' : 'bg-prism-critical animate-pulse'
                }`} />
                {st.label}
              </span>
            </div>
            <div className="glass-surface rounded-xl px-3 py-2.5" style={{ borderTopColor: '#8B5CF6', borderTopWidth: '2px' }}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#8B5CF6' }}>Company Mood</p>
              <p className="text-lg"><MoodIcon className="inline-block text-lg mr-1" /> <span className="text-[12px] font-medium text-txt-primary capitalize">{pulse.company_mood}</span></p>
            </div>
          </div>

          {/* Highlights */}
          {pulse.highlights?.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Highlights</p>
              {pulse.highlights.map((h, i) => (
                <div key={i} className="flex items-start gap-2 text-[12px]">
                  <span className={`mt-0.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                    h.type === 'positive' ? 'bg-prism-fill-2' :
                    h.type === 'alert' ? 'bg-prism-critical' : 'bg-prism-moderate'
                  }`} />
                  <span className="text-txt-secondary">{h.text}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function MetricCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  const colors: Record<string, string> = { MRR: '#34D399', 'Active Users': '#3B82F6' };
  const color = colors[label] ?? '#0891B2';
  return (
    <div className="glass-surface rounded-xl px-3 py-2.5" style={{ borderTopColor: color, borderTopWidth: '2px' }}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color }}>{label}</p>
      <p className="mt-1 text-lg font-semibold text-txt-primary">{value}</p>
      {sub && (
        <p className={`text-[11px] ${positive ? 'text-prism-teal' : 'text-prism-critical'}`}>{sub}</p>
      )}
    </div>
  );
}

/* ── Founder Bulletins ────────────────────────── */

function BulletinSection({ bulletins, onRefresh }: { bulletins: Bulletin[]; onRefresh: () => void }) {
  const [showForm, setShowForm] = useState(false);

  async function deactivate(id: string) {
    await apiCall(`/api/founder-bulletins/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: false }),
    });
    onRefresh();
  }

  return (
    <>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-txt-primary">Founder Bulletins</h2>
          <GradientButton size="sm" onClick={() => setShowForm(true)}>
            + New Bulletin
          </GradientButton>
        </div>

        {bulletins.length === 0 ? (
          <p className="text-sm text-txt-faint py-4 text-center">
            No active bulletins. Post one to broadcast a message to all agents.
          </p>
        ) : (
          <div className="space-y-2">
            {bulletins.map(b => {
              const ps = PRIORITY_STYLE[b.priority] ?? PRIORITY_STYLE.normal;
              return (
                <div key={b.id} className={`rounded-lg border px-3 py-2.5 ${ps.border} ${ps.bg}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`h-2 w-2 rounded-full ${ps.dot}`} />
                        <span className={`text-[10px] font-semibold uppercase tracking-wider ${ps.text}`}>
                          {b.priority}
                        </span>
                        <span className="text-[10px] text-txt-faint">·</span>
                        <span className="text-[10px] text-txt-faint capitalize">{b.audience}</span>
                        {b.expires_at && (
                          <>
                            <span className="text-[10px] text-txt-faint">·</span>
                            <span className="text-[10px] text-txt-faint">Expires {timeAgo(b.expires_at)}</span>
                          </>
                        )}
                      </div>
                      <p className="text-[13px] text-txt-primary leading-relaxed">{b.content}</p>
                      <p className="mt-1 text-[10px] text-txt-faint">
                        by {b.created_by} · {timeAgo(b.created_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => deactivate(b.id)}
                      className="text-txt-faint hover:text-prism-critical transition-colors flex-shrink-0"
                      title="Deactivate bulletin"
                    >
                      <MdClose className="text-[14px]" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {showForm && (
        <NewBulletinModal
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); onRefresh(); }}
        />
      )}
    </>
  );
}

/* ── New Bulletin Modal ───────────────────────── */

function NewBulletinModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [content, setContent] = useState('');
  const [audience, setAudience] = useState<string>('all');
  const [priority, setPriority] = useState<string>('normal');
  const [expiresIn, setExpiresIn] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!content.trim()) return;
    setSaving(true);

    let expires_at: string | null = null;
    if (expiresIn) {
      const hours = Number(expiresIn);
      if (hours > 0) {
        expires_at = new Date(Date.now() + hours * 3600_000).toISOString();
      }
    }

    await apiCall('/api/founder-bulletins', {
      method: 'POST',
      body: JSON.stringify({
        created_by: 'kristina',
        content: content.trim(),
        audience,
        priority,
        expires_at,
      }),
    });

    setSaving(false);
    onCreated();
  }

  return (
    <div className="modal-shell" onClick={onClose}>
      <div className="modal-panel max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-txt-primary">New Bulletin</h2>
          <button onClick={onClose} className="text-txt-muted hover:text-txt-primary transition-colors text-lg">×</button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="text-[11px] font-medium text-txt-muted mb-1 block">Message</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={3}
              placeholder="Broadcast message to agents..."
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary placeholder:text-txt-faint focus:border-cyan focus:outline-none resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-[11px] font-medium text-txt-muted mb-1 block">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value)}
                className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none"
              >
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-txt-muted mb-1 block">Audience</label>
              <select
                value={audience}
                onChange={e => setAudience(e.target.value)}
                className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none"
              >
                {AUDIENCES.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-txt-muted mb-1 block">Expires in (hours)</label>
              <input
                type="number"
                value={expiresIn}
                onChange={e => setExpiresIn(e.target.value)}
                placeholder="None"
                className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary placeholder:text-txt-faint focus:border-cyan focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-txt-muted hover:text-txt-primary transition-colors">
            Cancel
          </button>
          <GradientButton
            variant="primary"
            size="md"
            onClick={handleCreate}
            disabled={saving || !content.trim()}
          >
            {saving ? 'Posting…' : 'Post Bulletin'}
          </GradientButton>
        </div>
      </div>
    </div>
  );
}

/* ── Knowledge Base Editor ────────────────────── */

function KBEditor({ sections, onRefresh }: { sections: KBSection[]; onRefresh: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editAudience, setEditAudience] = useState('all');
  const [saving, setSaving] = useState(false);

  function startEdit(section: KBSection) {
    setEditingId(section.id);
    setEditContent(section.content);
    setEditAudience(section.audience);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditContent('');
  }

  async function handleSave(section: KBSection) {
    setSaving(true);
    await apiCall(`/api/company-knowledge-base/${section.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        content: editContent,
        audience: editAudience,
        version: section.version + 1,
        last_edited_by: 'kristina',
        updated_at: new Date().toISOString(),
      }),
    });
    setSaving(false);
    setEditingId(null);
    onRefresh();
  }

  return (
    <Card>
      <SectionHeader title="Knowledge Base" action={
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-txt-faint">
            L1: {sections.filter(s => s.layer === 1).length} · L2: {sections.filter(s => s.layer === 2).length} · L3: {sections.filter(s => s.layer === 3).length}
          </span>
          {sections.some(s => s.is_stale) && (
            <span className="rounded-full bg-prism-critical/10 border border-prism-critical/30 px-2 py-0.5 text-[10px] font-medium text-prism-critical">
              {sections.filter(s => s.is_stale).length} stale
            </span>
          )}
          <span className="text-[11px] text-txt-faint">{sections.length} sections</span>
        </div>
      } />

      <div className="space-y-3">
        {sections.map(s => {
          const isEditing = editingId === s.id;
          const layerLabel = s.layer === 1 ? 'Doctrine' : s.layer === 2 ? 'Role' : 'Reference';
          const layerColor = s.layer === 1
            ? 'text-white bg-gradient-to-r from-violet-500 via-violet-600 to-violet-700'
            : s.layer === 2
              ? 'text-white bg-gradient-to-r from-cyan-400 via-cyan-500 to-cyan-600'
              : 'text-white bg-gradient-to-r from-gray-400 via-gray-500 to-gray-600';
          return (
            <div key={s.id} className={`rounded-lg theme-glass-panel ${s.is_stale ? 'ring-1 ring-prism-critical/40' : ''}`}>
              {/* Section Header */}
              <button
                onClick={() => isEditing ? cancelEdit() : startEdit(s)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`rounded-lg px-1.5 py-0.5 text-[9px] font-bold uppercase flex-shrink-0 ${layerColor}`}>
                    {layerLabel}
                  </span>
                  <span className="text-[13px] font-semibold text-txt-primary truncate">{s.title}</span>
                  {s.is_stale && (
                    <span className="rounded-full bg-prism-critical/10 px-1.5 py-0.5 text-[9px] font-semibold text-prism-critical flex-shrink-0">
                      STALE
                    </span>
                  )}
                  <span className="rounded-full theme-glass-panel-soft px-2 py-0.5 text-[10px] text-txt-faint capitalize flex-shrink-0">
                    {s.audience}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {s.owner_agent_id && (
                    <span className="text-[10px] text-txt-faint">owner: {s.owner_agent_id}</span>
                  )}
                  <span className="text-[10px] text-txt-faint">v{s.version}</span>
                  <span className="text-[10px] text-txt-faint">·</span>
                  <span className="text-[10px] text-txt-faint">
                    {s.last_verified_at ? `verified ${timeAgo(s.last_verified_at)}` : 'unverified'}
                  </span>
                  <MdExpandMore className={`text-[14px] transition-transform duration-200 text-txt-faint ${isEditing ? '' : '-rotate-90'}`} />
                </div>
              </button>

              {/* Expanded Editor */}
              {isEditing && (
                <div className="border-t border-primary/20 px-4 py-3 space-y-3">
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    rows={Math.min(20, Math.max(6, editContent.split('\n').length + 2))}
                    className="w-full rounded-lg border border-border bg-base px-3 py-2 text-[13px] text-txt-primary font-mono leading-relaxed focus:border-cyan focus:outline-none resize-y"
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <label className="text-[11px] font-medium text-txt-muted">Audience:</label>
                      <select
                        value={editAudience}
                        onChange={e => setEditAudience(e.target.value)}
                        className="rounded-md border border-border bg-base px-2 py-1 text-[12px] text-txt-primary focus:border-cyan focus:outline-none"
                      >
                        {AUDIENCES.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={cancelEdit}
                        className="rounded-md border border-border px-3 py-1.5 text-[11px] font-medium text-txt-muted hover:text-txt-primary transition-colors"
                      >
                        Cancel
                      </button>
                      <GradientButton
                        size="sm"
                        onClick={() => handleSave(s)}
                        disabled={saving}
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </GradientButton>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ── Knowledge Graph Summary ──────────────────── */

function KGSummary({ stats }: { stats: KGStats | null }) {
  if (!stats) return null;

  const typeColors: Record<string, string> = {
    product: 'bg-cyan/20 text-cyan border-cyan/30',
    concept: 'bg-prism-violet/20 text-prism-violet border-prism-violet/30',
    metric: 'bg-prism-elevated/20 text-prism-elevated border-prism-elevated/30',
    risk: 'bg-prism-critical/20 text-prism-critical border-prism-critical/30',
    opportunity: 'bg-prism-fill-2/20 text-prism-teal border-prism-fill-2/30',
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-txt-primary">Knowledge Graph</h2>
        <a
          href="/graph"
          className="text-[11px] font-medium text-cyan hover:underline"
        >
          <span className="inline-flex items-center gap-1">Open Full Graph <MdArrowForward /></span>
        </a>
      </div>

      <div className="flex items-center gap-6 mb-4">
        <div>
          <p className="text-2xl font-bold text-txt-primary">{stats.total_nodes}</p>
          <p className="text-[11px] text-txt-muted">Nodes</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-txt-primary">{stats.total_edges}</p>
          <p className="text-[11px] text-txt-muted">Edges</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(stats.node_types).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
          <span
            key={type}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              typeColors[type] ?? 'bg-prism-moderate/20 text-prism-moderate border-prism-moderate/30'
            }`}
          >
            {type} <span className="font-bold">{count}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}
