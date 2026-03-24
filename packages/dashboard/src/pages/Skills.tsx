import { useState, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  MdAttachMoney, MdSettings, MdCampaign, MdExplore, MdHandshake,
  MdTrackChanges, MdPalette, MdStars, MdBarChart, MdTrendingUp,
  MdAdd, MdClose, MdUploadFile, MdGavel, MdBadge, MdManageSearch,
} from 'react-icons/md';
import { apiCall } from '../lib/firebase';
import { DISPLAY_NAME_MAP } from '../lib/types';
import {
  AgentAvatar,
  ButtonOutlineSecondary,
  Card,
  GradientButton,
  ModalCloseButton,
  SectionHeader,
  Skeleton,
} from '../components/ui';
import { GlowingTextareaFrame, glowingTextareaInnerClassName } from '../components/ui/glowing-textarea-frame';

/* ── Types ── */
interface SkillRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  tools_granted: string[];
  version: number;
  agent_count: number;
}

interface AgentSkillRow {
  agent_role: string;
  skill_id: string;
  proficiency: string;
  times_used: number;
  successes: number;
  failures: number;
  skill: {
    slug: string;
    name: string;
    category: string;
  };
}

interface SkillUploadResponse {
  success: boolean;
  parsed?: {
    slug: string;
    name: string;
    category: string;
    version: number;
    holders: string[];
    tools_granted_count: number;
  };
  sync?: {
    holders: {
      reconcile: boolean;
      requested: string[];
      deleted: number;
      inserted: number;
    };
    task_mappings: {
      replaced: boolean;
      requested: number;
      deleted: number;
      inserted: number;
    };
  };
}

interface SyncHistoryRow {
  id?: string;
  agent_role: string;
  action: string;
  detail: string;
  created_at: string;
}

interface UploadTaskMapping {
  task_regex: string;
  priority: number;
}

function parseTaskMappings(raw: string): UploadTaskMapping[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const mappings: UploadTaskMapping[] = [];
  for (const line of lines) {
    const parts = line.split('|').map((part) => part.trim());
    const task_regex = parts[0];
    if (!task_regex) continue;
    const priority = Number.parseInt(parts[1] ?? '10', 10);
    mappings.push({
      task_regex,
      priority: Number.isFinite(priority) ? priority : 10,
    });
  }

  return mappings;
}

const CATEGORY_META: Record<string, { label: string; color: string; badge: string; icon: ReactNode }> = {
  finance:            { label: 'Finance',           color: '#0369A1', badge: 'badge-sky',     icon: <MdAttachMoney className="inline h-4 w-4" /> },
  engineering:        { label: 'Engineering',       color: '#2563EB', badge: 'badge-blue',    icon: <MdSettings className="inline h-4 w-4" /> },
  marketing:          { label: 'Marketing',         color: '#7C3AED', badge: 'badge-violet',  icon: <MdCampaign className="inline h-4 w-4" /> },
  product:            { label: 'Product',           color: '#0891B2', badge: 'badge-cyan',    icon: <MdExplore className="inline h-4 w-4" /> },
  sales:              { label: 'Sales',             color: '#1D4ED8', badge: 'badge-blue',    icon: <MdTrackChanges className="inline h-4 w-4" /> },
  design:             { label: 'Design',            color: '#DB2777', badge: 'badge-pink',    icon: <MdPalette className="inline h-4 w-4" /> },
  leadership:         { label: 'Leadership',        color: '#7C3AED', badge: 'badge-violet',  icon: <MdStars className="inline h-4 w-4" /> },
  operations:         { label: 'Operations',        color: '#EA580C', badge: 'badge-orange',  icon: <MdBarChart className="inline h-4 w-4" /> },
  analytics:          { label: 'Analytics',         color: '#059669', badge: 'badge-emerald', icon: <MdTrendingUp className="inline h-4 w-4" /> },
  legal:              { label: 'Legal',             color: '#4F46E5', badge: 'badge-indigo',  icon: <MdGavel className="inline h-4 w-4" /> },
  hr:                 { label: 'HR',                color: '#0F766E', badge: 'badge-teal',    icon: <MdBadge className="inline h-4 w-4" /> },
  'human-resources':  { label: 'HR',                color: '#0F766E', badge: 'badge-teal',    icon: <MdBadge className="inline h-4 w-4" /> },
  human_resources:    { label: 'HR',                color: '#0F766E', badge: 'badge-teal',    icon: <MdBadge className="inline h-4 w-4" /> },
  research:           { label: 'Research',          color: '#6D28D9', badge: 'badge-violet',  icon: <MdManageSearch className="inline h-4 w-4" /> },
};

const ACTION_BTN_CLS = 'flex h-10 w-40 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-all';

const PROFICIENCY_COLOR: Record<string, string> = {
  learning:  'badge-gray',
  competent: 'badge-sky',
  expert:    'badge-cyan',
  master:    'badge-amber',
};

export default function Skills() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [topAgents, setTopAgents] = useState<AgentSkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [syncHistory, setSyncHistory] = useState<SyncHistoryRow[]>([]);

  const loadSkills = async () => {
    setLoading(true);

    // Load skills, usage, and recent sync events.
    const [skillsData, agentSkillsData, syncHistoryData] = await Promise.all([
      apiCall<SkillRow[]>('/api/skills').catch(() => []),
      apiCall<AgentSkillRow[]>('/api/agent-skills').catch(() => []),
      apiCall<SyncHistoryRow[]>('/api/activity_log?action=skills.sync_from_file&order=created_at.desc&limit=8').catch(() => []),
    ]);

    // Load skills for join
    const skillMap = new Map((skillsData ?? []).map((s: SkillRow) => [s.id, s]));

    // Compute agent count per skill
    const countMap = new Map<string, number>();
    for (const as of ((agentSkillsData ?? []) as AgentSkillRow[])) {
      countMap.set(as.skill_id, (countMap.get(as.skill_id) ?? 0) + 1);
    }

    const enrichedSkills: SkillRow[] = (skillsData ?? []).map((s: SkillRow) => ({
      ...s,
      agent_count: countMap.get(s.id) ?? 0,
    }));

    setSkills(enrichedSkills);

    // Top agents by usage
    const topByUsage = (agentSkillsData ?? [])
      .filter((as: AgentSkillRow) => as.times_used > 0)
      .sort((a: AgentSkillRow, b: AgentSkillRow) => b.times_used - a.times_used)
      .slice(0, 8)
      .map((as: AgentSkillRow) => {
        const skill = skillMap.get((as as unknown as { skill_id: string }).skill_id);
        return {
          ...as,
          skill: skill ? { slug: skill.slug, name: skill.name, category: skill.category } : { slug: '', name: 'Unknown', category: '' },
        };
      });

    setTopAgents(topByUsage);
    setSyncHistory(syncHistoryData ?? []);
    setLoading(false);
  };

  useEffect(() => { loadSkills(); }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-3 gap-4"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  // Group skills by category
  const categories = [...new Set(skills.map((s) => s.category))];
  const filtered = filter ? skills.filter((s) => s.category === filter) : skills;

  // Stats
  const totalSkills = skills.length;
  const totalAssignments = skills.reduce((s, sk) => s + sk.agent_count, 0);
  const categoryCounts = categories.map((c) => ({
    category: c,
    count: skills.filter((s) => s.category === c).length,
  }));

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="glass-surface rounded-xl px-4 py-3 text-center inner-card-lift" style={{ borderTopColor: '#0891B2', borderTopWidth: '2px' }}>
          <p className="text-2xl font-bold text-txt-primary">{totalSkills}</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#0891B2' }}>Total Skills</p>
        </div>
        <div className="glass-surface rounded-xl px-4 py-3 text-center inner-card-lift" style={{ borderTopColor: '#8B5CF6', borderTopWidth: '2px' }}>
          <p className="text-2xl font-bold text-txt-primary">{categories.length}</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#8B5CF6' }}>Categories</p>
        </div>
        <div className="glass-surface rounded-xl px-4 py-3 text-center inner-card-lift" style={{ borderTopColor: '#F59E0B', borderTopWidth: '2px' }}>
          <p className="text-2xl font-bold text-txt-primary">{totalAssignments}</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#F59E0B' }}>Agent Assignments</p>
        </div>
      </div>

      {/* Category filter row (full width, wraps) — separate from action buttons */}
      <div className="flex w-full flex-col gap-0">
        <div className="flex w-full flex-wrap gap-2">
          <button
            onClick={() => setFilter(null)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
              !filter
                ? 'bg-cyan/15 text-cyan border border-cyan/30'
                : 'bg-raised text-txt-muted border border-border hover:text-txt-secondary'
            }`}
          >
            All ({totalSkills})
          </button>
          {categoryCounts.map(({ category, count }) => {
            const meta = CATEGORY_META[category];
            return (
              <button
                key={category}
                onClick={() => setFilter(filter === category ? null : category)}
                className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  filter === category
                    ? 'border text-white'
                    : 'bg-raised text-txt-muted border border-border hover:text-txt-secondary'
                }`}
                style={filter === category ? { backgroundColor: `${meta?.color ?? '#666'}25`, borderColor: `${meta?.color ?? '#666'}50`, color: meta?.color } : undefined}
              >
                {meta?.icon} {meta?.label ?? category} ({count})
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex w-full flex-wrap items-center justify-end gap-2">
          <GradientButton variant="purple" size="sm" onClick={() => setShowUpload(true)}>
            <MdUploadFile className="h-4 w-4" /> Upload Skill File
          </GradientButton>
          <GradientButton size="sm" onClick={() => setShowCreate(true)}>
            <MdAdd className="h-4 w-4" /> New Skill
          </GradientButton>
        </div>
      </div>

      {/* Skills grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((skill) => {
          const meta = CATEGORY_META[skill.category];
          return (
            <Link
              key={skill.slug}
              to={`/skills/${skill.slug}`}
              className="group"
            >
              <Card className="h-full transition-all hover:border-cyan/30 hover:shadow-[0_0_15px_rgba(34,211,238,0.08)]">
                <div className="flex items-start justify-between mb-2">
                  <span
                    className={`badge badge-sm badge-up ${meta?.badge ?? 'badge-gray'}`}
                  >
                    {meta?.icon} {meta?.label ?? skill.category}
                  </span>
                  <span className="text-[10px] text-txt-faint">v{skill.version}</span>
                </div>
                <h3 className="text-sm font-semibold text-txt-primary group-hover:text-cyan transition-colors">
                  {skill.name}
                </h3>
                <p className="mt-1 text-[12px] text-txt-muted line-clamp-2">{skill.description}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] text-txt-faint">
                    {skill.agent_count} agent{skill.agent_count !== 1 ? 's' : ''}
                  </span>
                  <div className="flex gap-1">
                    {(skill.tools_granted ?? []).slice(0, 3).map((t) => (
                      <span key={t} className="rounded bg-raised px-1.5 py-0.5 font-mono text-[9px] text-txt-faint">
                        {t}
                      </span>
                    ))}
                    {(skill.tools_granted ?? []).length > 3 && (
                      <span className="text-[9px] text-txt-faint">+{skill.tools_granted.length - 3}</span>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Top Skill Users */}
      {topAgents.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">
            Top Skill Users
          </h3>
          <div className="space-y-2">
            {topAgents.map((as, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2">
                <AgentAvatar role={as.agent_role} size={28} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-txt-primary">{DISPLAY_NAME_MAP[as.agent_role] ?? as.agent_role}</p>
                  <p className="text-[11px] text-txt-faint">{as.skill.name}</p>
                </div>
                <span className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase ${PROFICIENCY_COLOR[as.proficiency] ?? PROFICIENCY_COLOR.learning}`}>
                  {as.proficiency}
                </span>
                <span className="text-[11px] text-txt-muted font-mono">{as.times_used}×</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {syncHistory.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">
            Skill Sync History
          </h3>
          <div className="space-y-2">
            {syncHistory.map((event, i) => (
              <div key={`${event.created_at}-${i}`} className="rounded-lg border border-border/50 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-txt-primary">{event.detail}</p>
                  <span className="text-[11px] text-txt-faint">{new Date(event.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-[11px] text-txt-faint">By {event.agent_role}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Create Skill Modal */}
      {showCreate && (
        <CreateSkillModal
          categories={Object.keys(CATEGORY_META)}
          onCreated={() => { setShowCreate(false); loadSkills(); }}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* Upload Skill Modal */}
      {showUpload && (
        <UploadSkillModal
          onSynced={() => { loadSkills(); }}
          onClose={() => setShowUpload(false)}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   CREATE SKILL MODAL
   ════════════════════════════════════════════════════════════ */
const INPUT_CLS =
  'w-full rounded-lg theme-glass-input-strong px-3 py-2 text-sm text-txt-primary placeholder:text-txt-faint outline-none transition-all focus:border-border-hover dark:text-txt-secondary';

function CreateSkillModal({
  categories,
  onCreated,
  onClose,
}: {
  categories: string[];
  onCreated: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState(categories[0] ?? 'engineering');
  const [description, setDescription] = useState('');
  const [methodology, setMethodology] = useState('');
  const [toolsText, setToolsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const handleCreate = async () => {
    if (!name.trim() || !description.trim() || !methodology.trim()) {
      setError('Name, description, and methodology are required.');
      return;
    }
    setSaving(true);
    setError('');

    const tools = toolsText
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    try {
      await apiCall('/api/skills', {
        method: 'POST',
        body: JSON.stringify({
          slug,
          name: name.trim(),
          category,
          description: description.trim(),
          methodology: methodology.trim(),
          tools_granted: tools,
        }),
      });
    } catch (err) {
      setError((err as Error).message ?? 'Failed to create skill.');
      setSaving(false);
      return;
    }

    onCreated();
  };

  return (
    <div className="modal-shell" onClick={onClose}>
      <div
        className="modal-panel max-w-lg"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-txt-primary">New Skill</h2>
          <ModalCloseButton onClick={onClose} aria-label="Close">
            <MdClose className="text-xl" />
          </ModalCloseButton>
        </div>

        <div className="space-y-4 px-5 py-5">
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Name</span>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Data Pipeline Monitoring" className={INPUT_CLS} autoFocus />
            {slug && <p className="text-[11px] text-txt-faint">slug: {slug}</p>}
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Category</span>
            <select value={category} onChange={e => setCategory(e.target.value)} className={INPUT_CLS}>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Description</span>
            <GlowingTextareaFrame>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                placeholder="Brief description of what this skill enables"
                className={`${glowingTextareaInnerClassName} min-h-[3.5rem]`}
              />
            </GlowingTextareaFrame>
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Methodology</span>
            <GlowingTextareaFrame>
              <textarea
                value={methodology}
                onChange={e => setMethodology(e.target.value)}
                rows={6}
                placeholder={"1. First step…\n2. Second step…\n3. Third step…"}
                className={`${glowingTextareaInnerClassName} min-h-[9rem] font-mono text-[12px] leading-relaxed`}
              />
            </GlowingTextareaFrame>
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Tools Granted</span>
            <input type="text" value={toolsText} onChange={e => setToolsText(e.target.value)} placeholder="comma-separated, e.g. query_logs, check_system_health" className={INPUT_CLS} />
          </label>

          {error && <p className="text-sm text-prism-critical">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
          <ButtonOutlineSecondary onClick={onClose}>Cancel</ButtonOutlineSecondary>
          <GradientButton
            variant="primary"
            size="md"
            onClick={handleCreate}
            disabled={saving || !name.trim()}
          >
            {saving ? 'Creating…' : 'Create Skill'}
          </GradientButton>
        </div>
      </div>
    </div>
  );
}

function UploadSkillModal({
  onSynced,
  onClose,
}: {
  onSynced: () => void;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [reconcileHolders, setReconcileHolders] = useState(true);
  const [defaultProficiency, setDefaultProficiency] = useState<'learning' | 'competent' | 'expert' | 'master'>('learning');
  const [replaceTaskMappings, setReplaceTaskMappings] = useState(false);
  const [taskMappingsRaw, setTaskMappingsRaw] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SkillUploadResponse | null>(null);

  const handleSync = async () => {
    if (!file) {
      setError('Choose a skill markdown file first.');
      return;
    }

    setSyncing(true);
    setError('');
    setResult(null);

    const taskMappings = parseTaskMappings(taskMappingsRaw);

    if (replaceTaskMappings && taskMappingsRaw.trim().length > 0 && taskMappings.length === 0) {
      setError('Task mappings format is invalid. Use one mapping per line: regex | priority');
      setSyncing(false);
      return;
    }

    try {
      const content = await file.text();
      const response = await apiCall<SkillUploadResponse>('/api/skills/sync-from-file', {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          content,
          reconcile_holders: reconcileHolders,
          default_proficiency: defaultProficiency,
          replace_task_mappings: replaceTaskMappings,
          task_mappings: taskMappings,
        }),
      });
      setResult(response);
      onSynced();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to sync skill file.');
      setSyncing(false);
      return;
    }

    setSyncing(false);
  };

  return (
    <div className="modal-shell" onClick={onClose}>
      <div className="modal-panel max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-txt-primary">Upload Skill File</h2>
          <ModalCloseButton onClick={onClose} aria-label="Close">
            <MdClose className="text-xl" />
          </ModalCloseButton>
        </div>

        <div className="space-y-4 px-5 py-5">
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Skill Markdown File</span>
            <input
              type="file"
              accept=".md,.markdown,text/markdown,text/plain"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className={`${INPUT_CLS} file:mr-3 file:rounded file:border-0 file:bg-cyan/15 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-cyan`}
            />
            <p className="text-[11px] text-txt-faint">Expected format: YAML frontmatter + markdown body (same format as skills/*.md).</p>
          </label>

          <label className="flex items-center gap-2 text-sm text-txt-secondary">
            <input
              type="checkbox"
              checked={reconcileHolders}
              onChange={(e) => setReconcileHolders(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-raised"
            />
            Reconcile agent holders from frontmatter
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Default Proficiency For New Holders</span>
            <select
              value={defaultProficiency}
              onChange={(e) => setDefaultProficiency(e.target.value as 'learning' | 'competent' | 'expert' | 'master')}
              className={INPUT_CLS}
            >
              <option value="learning">learning</option>
              <option value="competent">competent</option>
              <option value="expert">expert</option>
              <option value="master">master</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm text-txt-secondary">
            <input
              type="checkbox"
              checked={replaceTaskMappings}
              onChange={(e) => setReplaceTaskMappings(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-raised"
            />
            Replace task-skill mappings for this slug
          </label>

          {replaceTaskMappings && (
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Task Mappings</span>
              <GlowingTextareaFrame>
                <textarea
                  value={taskMappingsRaw}
                  onChange={(e) => setTaskMappingsRaw(e.target.value)}
                  rows={4}
                  placeholder={'(?i)(blog|content|article) | 10\n(?i)(campaign|promo|launch) | 16'}
                  className={`${glowingTextareaInnerClassName} min-h-[7rem] font-mono text-[12px] leading-relaxed`}
                />
              </GlowingTextareaFrame>
              <p className="text-[11px] text-txt-faint">One mapping per line: regex | priority. If blank, existing mappings for this skill are cleared.</p>
            </label>
          )}

          {result?.parsed && (
            <div className="rounded-lg border border-border bg-raised/50 p-3 text-xs text-txt-secondary">
              <p>
                Parsed: <span className="font-semibold text-txt-primary">{result.parsed.slug}</span> (v{result.parsed.version})
              </p>
              <p>
                Holders inserted: {result.sync?.holders.inserted ?? 0} | removed: {result.sync?.holders.deleted ?? 0}
              </p>
              <p>
                Mappings inserted: {result.sync?.task_mappings.inserted ?? 0} | removed: {result.sync?.task_mappings.deleted ?? 0}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-prism-critical">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
          <ButtonOutlineSecondary onClick={onClose}>Cancel</ButtonOutlineSecondary>
          <GradientButton
            variant="primary"
            size="md"
            onClick={handleSync}
            disabled={syncing || !file}
          >
            {syncing ? 'Syncing…' : 'Upload & Sync'}
          </GradientButton>
        </div>
      </div>
    </div>
  );
}
