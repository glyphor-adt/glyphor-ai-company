import { useState, useRef, useEffect, useCallback, type ReactNode, type DragEvent, type MouseEvent as RMouseEvent, type ComponentType } from 'react';
import {
  MdElectricBolt, MdAccountBalance, MdPerson, MdDashboard,
  MdManageSearch, MdSettings, MdInsights, MdBrush,
  MdBiotech, MdCampaign, MdHeadsetMic, MdStar, MdClose, MdFileDownload, MdArrowForward,
} from 'react-icons/md';
import { SCHEDULER_URL } from '../lib/firebase';
import { getModelsByProvider, PROVIDER_LABELS } from '../lib/models';

/* ═══════════════════════════════════════════════════
   Agent Template Palette
   ═══════════════════════════════════════════════════ */

interface Template {
  id: string;
  label: string;
  tier: 'orchestrator' | 'specialist';
  color: string;
  icon: ComponentType<{ className?: string }>;
  defaultTitle: string;
  defaultDept: string;
}

const TEMPLATES: Template[] = [
  { id: 'chief-of-staff', label: 'Chief of Staff', tier: 'orchestrator', color: '#7C3AED', icon: MdElectricBolt,  defaultTitle: 'Chief of Staff', defaultDept: 'Executive Office' },
  { id: 'cxo',            label: 'CxO',            tier: 'orchestrator', color: '#2563EB', icon: MdAccountBalance, defaultTitle: '',               defaultDept: '' },
  { id: 'vp',             label: 'VP',             tier: 'orchestrator', color: '#0E7490', icon: MdPerson,         defaultTitle: '',               defaultDept: '' },
  { id: 'director',       label: 'Director',       tier: 'orchestrator', color: '#0891B2', icon: MdDashboard,      defaultTitle: '',               defaultDept: '' },
  { id: 'ops',            label: 'Ops',            tier: 'specialist',   color: '#EA580C', icon: MdManageSearch,   defaultTitle: 'Operations Agent', defaultDept: 'Operations' },
  { id: 'engineer',       label: 'Engineer',       tier: 'specialist',   color: '#2563EB', icon: MdSettings,       defaultTitle: 'Engineer',       defaultDept: 'Engineering' },
  { id: 'analyst',        label: 'Analyst',        tier: 'specialist',   color: '#0369A1', icon: MdInsights,       defaultTitle: 'Analyst',        defaultDept: '' },
  { id: 'designer',       label: 'Designer',       tier: 'specialist',   color: '#DB2777', icon: MdBrush,          defaultTitle: 'Designer',       defaultDept: 'Design' },
  { id: 'researcher',     label: 'Researcher',     tier: 'specialist',   color: '#0891B2', icon: MdBiotech,        defaultTitle: 'Researcher',     defaultDept: '' },
  { id: 'marketer',       label: 'Marketer',       tier: 'specialist',   color: '#7C3AED', icon: MdCampaign,       defaultTitle: 'Marketer',       defaultDept: 'Marketing' },
  { id: 'support',        label: 'Support',        tier: 'specialist',   color: '#0E7490', icon: MdHeadsetMic,     defaultTitle: 'Support Agent',  defaultDept: 'Operations' },
  { id: 'specialist',     label: 'Specialist',     tier: 'specialist',   color: '#64748B', icon: MdStar,           defaultTitle: 'Specialist',     defaultDept: '' },
];

/* ═══════════════════════════════════════════════════
   Canvas Types
   ═══════════════════════════════════════════════════ */

interface CanvasNode {
  id: string;
  templateId: string;
  x: number;
  y: number;
  name: string;
  title: string;
  department: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTurns: number;
  budgetMonthly: number;
}

interface CanvasEdge {
  id: string;
  from: string;   // reporter node id
  to: string;     // manager node id
}

const NODE_W = 175;
const NODE_H = 74;
const INPUT_CLS = 'w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40';

let _uid = 0;
const uid = () => `n${Date.now()}-${++_uid}`;

/* ═══════════════════════════════════════════════════
   WorkforceBuilder Page
   ═══════════════════════════════════════════════════ */

export default function WorkforceBuilder() {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployMsg, setDeployMsg] = useState('');

  const canvasRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const dragRef = useRef<{ id: string; sx: number; sy: number; nx: number; ny: number } | null>(null);

  const selected = nodes.find(n => n.id === selectedId) ?? null;

  /* ── Window-level drag tracking ── */
  useEffect(() => {
    const onMove = (e: globalThis.MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setNodes(prev => prev.map(n =>
        n.id === d.id
          ? { ...n, x: Math.max(0, d.nx + e.clientX - d.sx), y: Math.max(0, d.ny + e.clientY - d.sy) }
          : n,
      ));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  /* ── Keyboard shortcuts ── */
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setNodes(prev => prev.filter(n => n.id !== selectedId));
    setEdges(prev => prev.filter(e => e.from !== selectedId && e.to !== selectedId));
    setSelectedId(null);
  }, [selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelectedId(null); setConnectFrom(null); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, deleteSelected]);

  /* ── Palette → Canvas drop ── */
  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const tid = e.dataTransfer.getData('template-id');
    const t = TEMPLATES.find(x => x.id === tid);
    if (!t || !canvasRef.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    const node: CanvasNode = {
      id: uid(),
      templateId: t.id,
      x: Math.max(0, e.clientX - r.left + canvasRef.current.scrollLeft - NODE_W / 2),
      y: Math.max(0, e.clientY - r.top + canvasRef.current.scrollTop - NODE_H / 2),
      name: '',
      title: t.defaultTitle,
      department: t.defaultDept,
      model: 'gpt-5-mini-2025-08-07',
      systemPrompt: '',
      temperature: 0.3,
      maxTurns: 10,
      budgetMonthly: t.tier === 'orchestrator' ? 15 : 8,
    };
    setNodes(prev => [...prev, node]);
    setSelectedId(node.id);
    setConnectFrom(null);
  }, []);

  /* ── Node interaction ── */
  const onNodeDown = useCallback((e: RMouseEvent, nodeId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    // Complete a pending connection
    if (connectFrom && connectFrom !== nodeId) {
      setEdges(prev => {
        if (prev.some(ed => ed.from === connectFrom && ed.to === nodeId)) return prev;
        return [...prev, { id: `e${Date.now()}`, from: connectFrom, to: nodeId }];
      });
      setConnectFrom(null);
      setSelectedId(nodeId);
      return;
    }
    if (connectFrom === nodeId) { setConnectFrom(null); return; }

    // Shift+click → start connecting
    if (e.shiftKey) {
      setConnectFrom(nodeId);
      setSelectedId(nodeId);
      return;
    }

    // Normal click → select + start drag
    setSelectedId(nodeId);
    const node = nodesRef.current.find(n => n.id === nodeId);
    if (node) dragRef.current = { id: nodeId, sx: e.clientX, sy: e.clientY, nx: node.x, ny: node.y };
  }, [connectFrom]);

  /* ── Update & delete ── */
  const updateNode = useCallback((patch: Partial<CanvasNode>) => {
    if (!selectedId) return;
    setNodes(prev => prev.map(n => n.id === selectedId ? { ...n, ...patch } : n));
  }, [selectedId]);

  const removeEdge = useCallback((eid: string) => {
    setEdges(prev => prev.filter(e => e.id !== eid));
  }, []);

  /* ── Export JSON ── */
  const exportJSON = useCallback(() => {
    const data = {
      version: 1,
      created: new Date().toISOString(),
      agents: nodes.map(n => {
        const t = TEMPLATES.find(x => x.id === n.templateId);
        const mgr = edges.find(e => e.from === n.id);
        const mgrNode = mgr ? nodes.find(nn => nn.id === mgr.to) : null;
        return {
          name: n.name || t?.label || n.templateId,
          title: n.title,
          department: n.department,
          template: n.templateId,
          reports_to: mgrNode ? (mgrNode.name || mgrNode.title || null) : null,
          model: n.model,
          temperature: n.temperature,
          max_turns: n.maxTurns,
          budget_monthly: n.budgetMonthly,
          system_prompt: n.systemPrompt || null,
        };
      }),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workforce-blueprint.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges]);

  /* ── Deploy all agents ── */
  const deployAll = useCallback(async () => {
    const unnamed = nodes.find(n => !n.name.trim());
    if (unnamed) {
      setSelectedId(unnamed.id);
      setDeployMsg('All agents need a name before deploying.');
      return;
    }
    setDeploying(true);
    setDeployMsg('');
    let created = 0;
    try {
      for (const n of nodes) {
        const mgr = edges.find(e => e.from === n.id);
        const mgrNode = mgr ? nodes.find(nn => nn.id === mgr.to) : null;
        const reportsTo = mgrNode?.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || undefined;
        const res = await fetch(`${SCHEDULER_URL}/agents/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: n.name, title: n.title, department: n.department,
            reports_to: reportsTo, model: n.model, temperature: n.temperature,
            max_turns: n.maxTurns, budget_monthly: n.budgetMonthly,
            system_prompt: n.systemPrompt || undefined,
          }),
        });
        if (res.ok) created++;
      }
      setDeployMsg(`Deployed ${created}/${nodes.length} agents successfully.`);
    } catch {
      setDeployMsg(`Deployed ${created}/${nodes.length}. Some failed — check scheduler logs.`);
    } finally {
      setDeploying(false);
    }
  }, [nodes, edges]);

  /* ── Canvas extents ── */
  const canvasW = nodes.length ? Math.max(900, ...nodes.map(n => n.x + NODE_W + 100)) : 900;
  const canvasH = nodes.length ? Math.max(600, ...nodes.map(n => n.y + NODE_H + 100)) : 600;

  /* ═══════════ Render ═══════════ */
  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-txt-primary">Workforce Builder</h1>
          <p className="mt-0.5 text-sm text-txt-muted">
            Design your agent hierarchy — drag roles from the palette, connect reporting lines, configure each agent, and save changes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportJSON} disabled={!nodes.length} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-txt-secondary transition-colors hover:border-cyan hover:text-cyan disabled:opacity-40">
            <span className="flex items-center gap-1"><MdFileDownload /> Export JSON</span>
          </button>
          <button onClick={deployAll} disabled={deploying || !nodes.length} className="rounded-lg bg-cyan px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40">
            {deploying ? 'Deploying...' : 'Deploy All'}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="mb-3 flex items-center gap-3">
        <span className="rounded-full border border-border bg-raised px-3 py-1 text-[12px] text-txt-muted">
          {nodes.length} agent{nodes.length !== 1 ? 's' : ''} · {edges.length} relationship{edges.length !== 1 ? 's' : ''}
          <span className="mx-1.5 text-txt-faint">·</span>
          <span className="text-txt-faint">drag from palette · connect nodes · click to configure</span>
        </span>
        {connectFrom && (
          <span className="rounded-full border border-tier-yellow/40 bg-tier-yellow/10 px-3 py-1 text-[12px] font-medium text-tier-yellow animate-pulse">
            Click a node to set as manager…
          </span>
        )}
        {deployMsg && (
          <span className={`rounded-full border px-3 py-1 text-[12px] font-medium ${
            deployMsg.includes('failed') || deployMsg.includes('need')
              ? 'border-prism-critical/40 bg-prism-critical/10 text-prism-critical'
              : 'border-tier-green/40 bg-tier-green/10 text-tier-green'
          }`}>{deployMsg}</span>
        )}
      </div>

      {/* ── Main layout ── */}
      <div className="flex flex-1 overflow-hidden rounded-xl border border-border">
        {/* Palette */}
        <div className="w-[220px] shrink-0 border-r border-border bg-raised/50 overflow-y-auto p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Agent Templates</p>
          <p className="mb-3 text-[11px] text-txt-faint">Drag onto canvas</p>
          <div className="space-y-1.5">
            {TEMPLATES.map(t => (
              <div
                key={t.id}
                draggable
                onDragStart={e => { e.dataTransfer.setData('template-id', t.id); e.dataTransfer.effectAllowed = 'copy'; }}
                className="flex cursor-grab items-center gap-2.5 rounded-lg border border-border bg-base px-3 py-2 text-sm transition-all hover:border-cyan/40 active:cursor-grabbing active:scale-[0.97]"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded" style={{ background: `${t.color}20`, color: t.color }}><t.icon className="h-3.5 w-3.5" /></span>
                <span className="font-medium text-txt-primary">{t.label}</span>
                <span className="ml-auto text-[10px] text-txt-faint">{t.tier === 'orchestrator' ? 'orchestrator' : 'specialist'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div
          className="relative flex-1 overflow-auto"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(100,116,139,0.12) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        >
          <div
            ref={canvasRef}
            className={`relative ${connectFrom ? 'cursor-crosshair' : ''}`}
            style={{ minWidth: canvasW, minHeight: canvasH }}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
            onDrop={onDrop}
            onClick={() => { setSelectedId(null); setConnectFrom(null); }}
          >
            {/* SVG edge layer */}
            <svg className="pointer-events-none absolute inset-0" style={{ width: canvasW, height: canvasH, overflow: 'visible' }}>
              {edges.map(edge => {
                const fn = nodes.find(n => n.id === edge.from);
                const tn = nodes.find(n => n.id === edge.to);
                if (!fn || !tn) return null;
                const x1 = fn.x + NODE_W / 2;
                const y1 = fn.y + NODE_H / 2;
                const x2 = tn.x + NODE_W / 2;
                const y2 = tn.y + NODE_H / 2;
                const my = (y1 + y2) / 2;
                const active = selectedId === edge.from || selectedId === edge.to;
                return (
                  <path
                    key={edge.id}
                    d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`}
                    fill="none"
                    stroke={active ? 'rgba(34,211,238,0.6)' : 'rgba(100,116,139,0.35)'}
                    strokeWidth={active ? 2 : 1.5}
                    strokeDasharray={active ? 'none' : '6 3'}
                  />
                );
              })}
            </svg>

            {/* Nodes */}
            {nodes.map(node => {
              const t = TEMPLATES.find(x => x.id === node.templateId);
              const isSel = node.id === selectedId;
              const isConn = node.id === connectFrom;
              const color = t?.color ?? '#64748b';
              return (
                <div
                  key={node.id}
                  onMouseDown={e => onNodeDown(e, node.id)}
                  className={`absolute select-none rounded-xl border-2 bg-base px-4 py-2.5 transition-shadow ${
                    connectFrom && !isConn ? 'cursor-pointer hover:border-cyan/60' : 'cursor-grab active:cursor-grabbing'
                  } ${
                    isSel
                      ? 'border-cyan shadow-lg'
                      : isConn
                      ? 'border-tier-yellow shadow-lg'
                      : 'border-border hover:border-border-hover shadow-md'
                  }`}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: NODE_W,
                    height: NODE_H,
                    ...(isSel ? { boxShadow: `0 0 24px ${color}35, 0 4px 12px rgba(0,0,0,0.2)` } : {}),
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `${color}20`, color }}>
                      {t ? <t.icon className="h-4 w-4" /> : <MdStar className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-txt-primary">{node.name || t?.label || 'Untitled'}</p>
                      <p className="truncate text-[11px] text-txt-faint">{node.title || t?.label}</p>
                    </div>
                  </div>
                  <span className={`absolute bottom-2 left-4 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                    t?.tier === 'orchestrator' ? 'bg-cyan/10 text-cyan' : 'bg-prism-moderate/15 text-prism-moderate'
                  }`}>{t?.tier ?? 'specialist'}</span>
                </div>
              );
            })}

            {/* Empty state */}
            {!nodes.length && (
              <div className="flex h-full min-h-[400px] items-center justify-center">
                <div className="space-y-2 text-center">
                  <p className="text-lg text-txt-faint">Drag agent templates onto the canvas</p>
                  <p className="text-sm text-txt-faint/60">Build your organizational hierarchy visually</p>
                </div>
              </div>
            )}
          </div>

          {/* ── Config Panel (right overlay) ── */}
          {selected && (
            <div
              className="absolute right-0 top-0 h-full w-[310px] overflow-y-auto border-l border-border bg-base/95 backdrop-blur-sm shadow-prism-lg"
              onClick={e => e.stopPropagation()}
            >
              <div className="space-y-3 px-4 py-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg" style={{ color: TEMPLATES.find(x => x.id === selected.templateId)?.color }}>{(() => { const T = TEMPLATES.find(x => x.id === selected.templateId); return T ? <T.icon className="h-5 w-5" /> : <MdStar className="h-5 w-5" />; })()}</span>
                    <h3 className="text-sm font-semibold text-txt-primary">Configure Agent</h3>
                  </div>
                  <button onClick={() => setSelectedId(null)} className="grid h-6 w-6 place-items-center rounded text-txt-faint hover:bg-raised hover:text-txt-primary transition-colors"><MdClose /></button>
                </div>

                {/* Fields */}
                <Fld label="Name">
                  <input type="text" value={selected.name} onChange={e => updateNode({ name: e.target.value })} placeholder="Agent name…" className={INPUT_CLS} autoFocus />
                </Fld>
                <Fld label="Title">
                  <input type="text" value={selected.title} onChange={e => updateNode({ title: e.target.value })} placeholder="e.g. CTO, VP Engineering" className={INPUT_CLS} />
                </Fld>
                <Fld label="Department">
                  <input type="text" value={selected.department} onChange={e => updateNode({ department: e.target.value })} placeholder="e.g. Engineering" className={INPUT_CLS} />
                </Fld>
                <Fld label="Model">
                  <select value={selected.model} onChange={e => updateNode({ model: e.target.value })} className={INPUT_CLS}>
                    {(['gemini', 'openai', 'anthropic'] as const).map(provider => (
                      <optgroup key={provider} label={PROVIDER_LABELS[provider]}>
                        {getModelsByProvider()[provider].map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </Fld>
                <div className="grid grid-cols-2 gap-3">
                  <Fld label="Temperature">
                    <input type="number" step="0.1" min="0" max="2" value={selected.temperature} onChange={e => updateNode({ temperature: parseFloat(e.target.value) || 0 })} className={INPUT_CLS} />
                  </Fld>
                  <Fld label="Monthly ($)">
                    <input type="number" step="1" min="0" value={selected.budgetMonthly} onChange={e => updateNode({ budgetMonthly: parseFloat(e.target.value) || 0 })} className={INPUT_CLS} />
                  </Fld>
                </div>
                <Fld label="System Prompt">
                  <textarea value={selected.systemPrompt} onChange={e => updateNode({ systemPrompt: e.target.value })} rows={5} placeholder="Agent instructions…" className={`${INPUT_CLS} font-mono text-[12px] leading-relaxed`} />
                </Fld>

                {/* Relationships */}
                <div className="border-t border-border pt-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Relationships</p>
                  {edges.filter(e => e.from === selectedId || e.to === selectedId).map(edge => {
                    const isReporter = edge.from === selectedId;
                    const other = nodes.find(n => n.id === (isReporter ? edge.to : edge.from));
                    const ot = other ? TEMPLATES.find(x => x.id === other.templateId) : null;
                    return (
                      <div key={edge.id} className="flex items-center justify-between py-1.5">
                        <span className="text-[12px] text-txt-secondary">
                          <span className="text-txt-faint">{isReporter ? 'Reports to' : 'Manages'}:</span>{' '}
                          {other?.name || ot?.label || '—'}
                        </span>
                        <button onClick={() => removeEdge(edge.id)} className="text-[11px] text-prism-critical hover:text-prism-critical/80 transition-colors">×</button>
                      </div>
                    );
                  })}
                  {!edges.some(e => e.from === selectedId || e.to === selectedId) && (
                    <p className="py-1 text-[12px] text-txt-faint">No connections yet</p>
                  )}
                  <button
                    onClick={() => setConnectFrom(connectFrom === selectedId ? null : selectedId)}
                    className={`mt-2 w-full rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      connectFrom === selectedId
                        ? 'border-tier-yellow/40 bg-tier-yellow/10 text-tier-yellow'
                        : 'border-border text-txt-muted hover:border-cyan hover:text-cyan'
                    }`}
                  >
                    {connectFrom === selectedId ? 'Cancel — click target node' : <span className="flex items-center gap-1">Connect to Manager <MdArrowForward /></span>}
                  </button>
                </div>

                {/* Actions */}
                <div className="border-t border-border pt-3">
                  <button
                    onClick={deleteSelected}
                    className="w-full rounded-lg border border-prism-critical/30 bg-prism-critical/10 px-3 py-2 text-xs font-medium text-prism-critical hover:bg-prism-critical/20 transition-colors"
                  >
                    Remove Agent
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Field label wrapper ── */
function Fld({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-txt-muted">{label}</span>
      {children}
    </label>
  );
}
