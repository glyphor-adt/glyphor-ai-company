import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Card, SectionHeader, Skeleton } from '../components/ui';
import {
  MdBusiness, MdLightbulb, MdBalance, MdBarChart, MdWarning,
  MdRocketLaunch, MdMenuBook, MdTrackChanges, MdAssignment,
  MdSettings, MdPerson, MdDescription, MdArrowForward,
} from 'react-icons/md';
import type { IconType } from 'react-icons';

/* ── Types ─────────────────────────────────────── */

interface KgNode {
  id: string;
  node_type: string;
  title: string;
  summary: string | null;
  department: string | null;
  tags: string[];
  confidence: number;
  created_by: string | null;
  created_at: string;
}

interface KgEdge {
  id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  strength: number;
  evidence: string | null;
}

type NodeType =
  | 'entity' | 'concept' | 'decision' | 'metric' | 'risk'
  | 'opportunity' | 'learning' | 'goal' | 'project' | 'process' | 'person'
  | 'tool' | 'pattern' | 'fact' | 'observation' | 'organization'
  | 'team' | 'hypothesis' | 'event' | 'product' | 'document' | 'incident';

type EdgeType =
  | 'causes' | 'caused' | 'precedes' | 'relates_to' | 'related_to' | 'part_of'
  | 'depends_on' | 'created_by' | 'assigned_to' | 'measured_by' | 'mitigates'
  | 'enables' | 'belongs_to' | 'owns' | 'monitors' | 'affects' | 'affected'
  | 'supports' | 'contradicts' | 'resulted_in' | 'contributed_to' | 'blocks' | 'refines';

/* ── Constants ─────────────────────────────────── */

const NODE_COLORS: Record<NodeType, string> = {
  entity: '#0891B2',
  concept: '#A78BFA',
  decision: '#FB923C',
  metric: '#34D399',
  risk: '#F87171',
  opportunity: '#FBBF24',
  learning: '#60A5FA',
  goal: '#818CF8',
  project: '#2DD4BF',
  process: '#E879F9',
  person: '#F472B6',
  tool: '#06B6D4',
  pattern: '#C084FC',
  fact: '#94A3B8',
  observation: '#67E8F9',
  organization: '#F59E0B',
  team: '#FB7185',
  hypothesis: '#D946EF',
  event: '#38BDF8',
  product: '#4ADE80',
  document: '#A1A1AA',
  incident: '#EF4444',
};

const NODE_ICONS: Record<NodeType, IconType> = {
  entity: MdBusiness,
  concept: MdLightbulb,
  decision: MdBalance,
  metric: MdBarChart,
  risk: MdWarning,
  opportunity: MdRocketLaunch,
  learning: MdMenuBook,
  goal: MdTrackChanges,
  project: MdAssignment,
  process: MdSettings,
  person: MdPerson,
  tool: MdSettings,
  pattern: MdLightbulb,
  fact: MdDescription,
  observation: MdMenuBook,
  organization: MdBusiness,
  team: MdPerson,
  hypothesis: MdLightbulb,
  event: MdRocketLaunch,
  product: MdAssignment,
  document: MdDescription,
  incident: MdWarning,
};

const EDGE_STYLES: Record<EdgeType, { color: string; dashed: boolean }> = {
  causes: { color: '#F87171', dashed: false },
  caused: { color: '#F87171', dashed: false },
  precedes: { color: '#60A5FA', dashed: false },
  relates_to: { color: '#6B7280', dashed: true },
  related_to: { color: '#6B7280', dashed: true },
  part_of: { color: '#A78BFA', dashed: false },
  depends_on: { color: '#FB923C', dashed: true },
  created_by: { color: '#34D399', dashed: true },
  assigned_to: { color: '#F472B6', dashed: true },
  measured_by: { color: '#FBBF24', dashed: true },
  mitigates: { color: '#2DD4BF', dashed: false },
  enables: { color: '#818CF8', dashed: false },
  belongs_to: { color: '#A78BFA', dashed: false },
  owns: { color: '#F59E0B', dashed: false },
  monitors: { color: '#38BDF8', dashed: true },
  affects: { color: '#FB923C', dashed: false },
  affected: { color: '#FB923C', dashed: false },
  supports: { color: '#34D399', dashed: false },
  contradicts: { color: '#EF4444', dashed: false },
  resulted_in: { color: '#818CF8', dashed: true },
  contributed_to: { color: '#34D399', dashed: true },
  blocks: { color: '#EF4444', dashed: false },
  refines: { color: '#C084FC', dashed: true },
};

/* ── Force Graph Simulation ────────────────────── */

interface SimNode extends KgNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

function useForceSimulation(
  nodes: KgNode[],
  edges: KgEdge[],
  width: number,
  height: number,
) {
  const simNodes = useRef<SimNode[]>([]);
  const frameRef = useRef<number>(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // Use a much larger virtual canvas for layout — zoom/pan lets users explore
    const layoutW = Math.max(width, nodes.length * 8);
    const layoutH = Math.max(height, nodes.length * 8);

    const existing = new Map(simNodes.current.map((n) => [n.id, n]));
    simNodes.current = nodes.map((n) => {
      const prev = existing.get(n.id);
      if (prev) return { ...n, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy, radius: prev.radius };
      return {
        ...n,
        x: layoutW / 2 + (Math.random() - 0.5) * layoutW * 0.8,
        y: layoutH / 2 + (Math.random() - 0.5) * layoutH * 0.8,
        vx: 0,
        vy: 0,
        radius: 20,
      };
    });

    const edgeIndex = new Map<string, string[]>();
    edges.forEach((e) => {
      edgeIndex.set(e.source_id, [...(edgeIndex.get(e.source_id) ?? []), e.target_id]);
      edgeIndex.set(e.target_id, [...(edgeIndex.get(e.target_id) ?? []), e.source_id]);
    });

    simNodes.current.forEach((n) => {
      const connections = edgeIndex.get(n.id)?.length ?? 0;
      n.radius = Math.max(14, Math.min(28, 14 + connections * 2));
    });

    let iterations = 0;
    const maxIterations = 400;

    function simulate() {
      const sn = simNodes.current;
      const alpha = Math.max(0.001, 1 - iterations / maxIterations);
      // Scale repulsion with node count so graphs spread proportionally
      const repulsion = 1200 + sn.length * 2;
      const attraction = 0.008;
      const damping = 0.82;

      // Repulsion between all nodes
      for (let i = 0; i < sn.length; i++) {
        for (let j = i + 1; j < sn.length; j++) {
          const dx = sn[j].x - sn[i].x;
          const dy = sn[j].y - sn[i].y;
          const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const force = (repulsion * alpha) / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          sn[i].vx -= fx;
          sn[i].vy -= fy;
          sn[j].vx += fx;
          sn[j].vy += fy;
        }
      }

      // Attraction along edges — stronger to form visible clusters
      const nodeMap = new Map(sn.map((n) => [n.id, n]));
      edges.forEach((e) => {
        const s = nodeMap.get(e.source_id);
        const t = nodeMap.get(e.target_id);
        if (!s || !t) return;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const targetDist = 80;
        const force = (dist - targetDist) * attraction * alpha;
        const fx = (dx / Math.max(1, dist)) * force;
        const fy = (dy / Math.max(1, dist)) * force;
        s.vx += fx;
        s.vy += fy;
        t.vx -= fx;
        t.vy -= fy;
      });

      // Center gravity — stronger to keep everything visible
      sn.forEach((n) => {
        n.vx += (layoutW / 2 - n.x) * 0.003 * alpha;
        n.vy += (layoutH / 2 - n.y) * 0.003 * alpha;
      });

      // Apply velocity — no hard boundary so zoom/pan works
      sn.forEach((n) => {
        n.vx *= damping;
        n.vy *= damping;
        n.x += n.vx;
        n.y += n.vy;
      });

      iterations++;
      setTick((t) => t + 1);

      if (iterations < maxIterations) {
        frameRef.current = requestAnimationFrame(simulate);
      }
    }

    frameRef.current = requestAnimationFrame(simulate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [nodes, edges, width, height]);

  return { simNodes: simNodes.current, tick };
}

/* ── Canvas Graph Component ────────────────────── */

function GraphCanvas({
  nodes,
  edges,
  onSelectNode,
  selectedNodeId,
  highlightedNodeIds,
  filterNodeTypes,
  searchQuery,
}: {
  nodes: KgNode[];
  edges: KgEdge[];
  onSelectNode: (node: KgNode | null) => void;
  selectedNodeId: string | null;
  highlightedNodeIds: Set<string>;
  filterNodeTypes: Set<NodeType>;
  searchQuery: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });

  // Zoom/pan state
  const transform = useRef({ x: 0, y: 0, scale: 1 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  // Filter nodes — memoize so simulation doesn't restart every render
  const filteredNodes = useMemo(() => nodes.filter((n) => {
    if (filterNodeTypes.size > 0 && !filterNodeTypes.has(n.node_type as NodeType)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return n.title.toLowerCase().includes(q) || n.summary?.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q));
    }
    return true;
  }), [nodes, filterNodeTypes, searchQuery]);
  const filteredEdges = useMemo(() => {
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
    return edges.filter((e) => filteredNodeIds.has(e.source_id) && filteredNodeIds.has(e.target_id));
  }, [filteredNodes, edges]);

  const { simNodes, tick } = useForceSimulation(filteredNodes, filteredEdges, dims.width, dims.height);

  // Auto-fit on first meaningful layout
  const hasFit = useRef(false);
  useEffect(() => {
    if (hasFit.current || simNodes.length === 0 || tick < 50) return;
    hasFit.current = true;
    const xs = simNodes.map((n) => n.x);
    const ys = simNodes.map((n) => n.y);
    const minX = Math.min(...xs) - 40;
    const maxX = Math.max(...xs) + 40;
    const minY = Math.min(...ys) - 40;
    const maxY = Math.max(...ys) + 40;
    const graphW = maxX - minX;
    const graphH = maxY - minY;
    const scale = Math.min(dims.width / graphW, dims.height / graphH, 1.5) * 0.9;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    transform.current = {
      x: dims.width / 2 - cx * scale,
      y: dims.height / 2 - cy * scale,
      scale,
    };
  }, [tick, simNodes, dims]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDims({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Zoom handler
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const t = transform.current;
      const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newScale = Math.max(0.1, Math.min(5, t.scale * zoomFactor));
      // Zoom toward mouse position
      t.x = mx - (mx - t.x) * (newScale / t.scale);
      t.y = my - (my - t.y) * (newScale / t.scale);
      t.scale = newScale;
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      isPanning.current = true;
      panStart.current = { x: e.clientX - transform.current.x, y: e.clientY - transform.current.y };
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) {
      transform.current.x = e.clientX - panStart.current.x;
      transform.current.y = e.clientY - panStart.current.y;
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.width * dpr;
    canvas.height = dims.height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = `${dims.width}px`;
    canvas.style.height = `${dims.height}px`;

    ctx.clearRect(0, 0, dims.width, dims.height);

    // Apply zoom/pan transform
    const t = transform.current;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.scale, t.scale);

    const rootStyles = getComputedStyle(document.documentElement);
    const labelColor = rootStyles.getPropertyValue('--color-txt-primary').trim();
    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

    // Draw edges
    filteredEdges.forEach((e) => {
      const s = nodeMap.get(e.source_id);
      const t = nodeMap.get(e.target_id);
      if (!s || !t) return;

      const style = EDGE_STYLES[e.edge_type as EdgeType] ?? { color: '#6B7280', dashed: true };
      const isHighlighted =
        highlightedNodeIds.has(e.source_id) && highlightedNodeIds.has(e.target_id);

      ctx.beginPath();
      ctx.strokeStyle = isHighlighted ? style.color : `${style.color}40`;
      ctx.lineWidth = isHighlighted ? 2 : 1;
      if (style.dashed) ctx.setLineDash([4, 4]);
      else ctx.setLineDash([]);
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Arrow
      const angle = Math.atan2(t.y - s.y, t.x - s.x);
      const arrowDist = t.radius + 4;
      const ax = t.x - Math.cos(angle) * arrowDist;
      const ay = t.y - Math.sin(angle) * arrowDist;
      ctx.beginPath();
      ctx.fillStyle = isHighlighted ? style.color : `${style.color}40`;
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - 6 * Math.cos(angle - 0.4), ay - 6 * Math.sin(angle - 0.4));
      ctx.lineTo(ax - 6 * Math.cos(angle + 0.4), ay - 6 * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fill();
    });

    // Draw nodes
    simNodes.forEach((n) => {
      const color = NODE_COLORS[n.node_type as NodeType] ?? '#6B7280';
      const isSelected = n.id === selectedNodeId;
      const isHighlighted = highlightedNodeIds.size === 0 || highlightedNodeIds.has(n.id);
      const alpha = isHighlighted ? 1 : 0.2;

      // Glow for selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 6, 0, Math.PI * 2);
        ctx.fillStyle = `${color}30`;
        ctx.fill();
      }

      // Circle
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? color : `${color}${Math.round(alpha * 0.3 * 255).toString(16).padStart(2, '0')}`;
      ctx.fill();
      ctx.strokeStyle = `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.stroke();

      // Label
      ctx.globalAlpha = alpha;
      ctx.fillStyle = labelColor;
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const label = n.title.length > 18 ? n.title.substring(0, 16) + '…' : n.title;
      ctx.fillText(label, n.x, n.y + n.radius + 4);
      ctx.globalAlpha = 1;
    });

    ctx.restore(); // pop zoom/pan transform
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, dims, selectedNodeId, highlightedNodeIds, filteredEdges, simNodes]);

  // Click handler
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const t = transform.current;
      // Convert screen coords to graph coords via inverse transform
      const x = (e.clientX - rect.left - t.x) / t.scale;
      const y = (e.clientY - rect.top - t.y) / t.scale;

      const clicked = simNodes.find((n) => {
        const dx = n.x - x;
        const dy = n.y - y;
        return dx * dx + dy * dy <= (n.radius + 4) * (n.radius + 4);
      });

      onSelectNode(clicked ?? null);
    },
    [simNodes, onSelectNode],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="cursor-grab active:cursor-grabbing"
      />
      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        <button
          onClick={() => { const t = transform.current; t.scale = Math.min(5, t.scale * 1.3); }}
          className="rounded border border-border bg-base px-2 py-1 text-xs text-txt-muted hover:text-txt-primary"
        >+</button>
        <button
          onClick={() => { const t = transform.current; t.scale = Math.max(0.1, t.scale / 1.3); }}
          className="rounded border border-border bg-base px-2 py-1 text-xs text-txt-muted hover:text-txt-primary"
        >−</button>
        <button
          onClick={() => {
            hasFit.current = false;
            transform.current = { x: 0, y: 0, scale: 1 };
          }}
          className="rounded border border-border bg-base px-2 py-1 text-[9px] text-txt-muted hover:text-txt-primary"
        >Fit</button>
      </div>
    </div>
  );
}

/* ── Node Detail Panel ─────────────────────────── */

function NodeDetail({
  node,
  edges,
  allNodes,
  onClose,
  onNavigateNode,
}: {
  node: KgNode;
  edges: KgEdge[];
  allNodes: KgNode[];
  onClose: () => void;
  onNavigateNode: (id: string) => void;
}) {
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
  const Icon = NODE_ICONS[node.node_type as NodeType] ?? MdDescription;
  const color = NODE_COLORS[node.node_type as NodeType] ?? '#6B7280';

  // Connected edges
  const outgoing = edges.filter((e) => e.source_id === node.id);
  const incoming = edges.filter((e) => e.target_id === node.id);

  return (
    <div className="absolute right-0 top-0 h-full w-[340px] border-l border-border bg-raised overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Icon className="text-xl" style={{ color }} />
            <div>
              <h3 className="text-sm font-semibold text-txt-primary">{node.title}</h3>
              <span
                className="inline-block mt-0.5 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                style={{ borderColor: `${color}40`, backgroundColor: `${color}15`, color }}
              >
                {node.node_type}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-txt-muted hover:text-txt-primary text-lg leading-none">
            ×
          </button>
        </div>

        {/* Summary */}
        {node.summary && (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-1">Summary</p>
            <p className="text-[12px] text-txt-secondary leading-relaxed">{node.summary}</p>
          </div>
        )}

        {/* Meta */}
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          {node.department && (
            <div>
              <span className="text-txt-faint">Department</span>
              <p className="text-txt-secondary font-medium">{node.department}</p>
            </div>
          )}
          <div>
            <span className="text-txt-faint">Confidence</span>
            <p className="text-txt-secondary font-medium">{Math.round(node.confidence * 100)}%</p>
          </div>
          {node.created_by && (
            <div>
              <span className="text-txt-faint">Created by</span>
              <p className="text-txt-secondary font-medium">{node.created_by}</p>
            </div>
          )}
        </div>

        {/* Tags */}
        {node.tags.length > 0 && (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-1">Tags</p>
            <div className="flex flex-wrap gap-1">
              {node.tags.map((t) => (
                <span key={t} className="rounded-full border border-border bg-base px-2 py-0.5 text-[10px] text-txt-muted">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Outgoing edges */}
        {outgoing.length > 0 && (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-1">
              Outgoing ({outgoing.length})
            </p>
            <div className="space-y-1">
              {outgoing.map((e) => {
                const target = nodeMap.get(e.target_id);
                return (
                  <button
                    key={e.id}
                    onClick={() => onNavigateNode(e.target_id)}
                    className="flex w-full items-center gap-2 rounded-lg border border-border bg-base px-2.5 py-1.5 text-left text-[11px] hover:border-cyan/30 transition-colors"
                  >
                    <span className="text-txt-faint">{e.edge_type.replace(/_/g, ' ')}</span>
                    <MdArrowForward className="text-txt-faint" />
                    <span className="text-txt-secondary font-medium truncate">{target?.title ?? e.target_id.slice(0, 8)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Incoming edges */}
        {incoming.length > 0 && (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-1">
              Incoming ({incoming.length})
            </p>
            <div className="space-y-1">
              {incoming.map((e) => {
                const source = nodeMap.get(e.source_id);
                return (
                  <button
                    key={e.id}
                    onClick={() => onNavigateNode(e.source_id)}
                    className="flex w-full items-center gap-2 rounded-lg border border-border bg-base px-2.5 py-1.5 text-left text-[11px] hover:border-cyan/30 transition-colors"
                  >
                    <span className="text-txt-secondary font-medium truncate">{source?.title ?? e.source_id.slice(0, 8)}</span>
                    <MdArrowForward className="text-txt-faint" />
                    <span className="text-txt-faint">{e.edge_type.replace(/_/g, ' ')}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Stats Bar ─────────────────────────────────── */

function StatsBar({ nodes, edges, totalNodes }: { nodes: KgNode[]; edges: KgEdge[]; totalNodes?: number }) {
  const typeCounts = new Map<string, number>();
  nodes.forEach((n) => typeCounts.set(n.node_type, (typeCounts.get(n.node_type) ?? 0) + 1));

  return (
    <div className="flex items-center gap-4 text-[11px]">
      <span className="text-txt-muted">
        <span className="font-semibold text-txt-primary">{nodes.length}</span>{totalNodes != null && totalNodes !== nodes.length ? `/${totalNodes}` : ''} nodes
      </span>
      <span className="text-txt-muted">
        <span className="font-semibold text-txt-primary">{edges.length}</span> edges
      </span>
      <span className="text-txt-faint">|</span>
      {Array.from(typeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([type, count]) => (
          <span key={type} className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: NODE_COLORS[type as NodeType] ?? '#6B7280' }}
            />
            <span className="text-txt-muted">{type}</span>
            <span className="text-txt-faint">{count}</span>
          </span>
        ))}
    </div>
  );
}

/* ── Page Component ────────────────────────────── */

export default function Graph() {
  const [nodes, setNodes] = useState<KgNode[]>([]);
  const [edges, setEdges] = useState<KgEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<KgNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterNodeTypes, setFilterNodeTypes] = useState<Set<NodeType>>(new Set());
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(new Set());

  // Load data
  useEffect(() => {
    async function load() {
      const [nodesRes, edgesRes] = await Promise.all([
        supabase.from('kg_nodes').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('kg_edges').select('*').limit(2000),
      ]);
      setNodes((nodesRes.data as KgNode[]) ?? []);
      setEdges((edgesRes.data as KgEdge[]) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  // When a node is selected, highlight its neighborhood
  useEffect(() => {
    if (!selectedNode) {
      setHighlightedNodeIds(new Set());
      return;
    }
    const ids = new Set<string>([selectedNode.id]);
    edges.forEach((e) => {
      if (e.source_id === selectedNode.id) ids.add(e.target_id);
      if (e.target_id === selectedNode.id) ids.add(e.source_id);
    });
    setHighlightedNodeIds(ids);
  }, [selectedNode, edges]);

  const handleSelectNode = useCallback(
    (node: KgNode | null) => {
      setSelectedNode(node);
    },
    [],
  );

  const handleNavigateNode = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (node) setSelectedNode(node);
    },
    [nodes],
  );

  function toggleFilter(type: NodeType) {
    setFilterNodeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  const allNodeTypes: NodeType[] = [
    'entity', 'concept', 'decision', 'metric', 'risk',
    'opportunity', 'learning', 'goal', 'project', 'process', 'person',
    'tool', 'pattern', 'fact', 'observation', 'organization',
    'team', 'hypothesis', 'event', 'product', 'document', 'incident',
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-txt-primary">Knowledge Graph</h1>
        <p className="mt-1 text-sm text-txt-muted">
          Explore the company's collective knowledge — entities, decisions, metrics, and their relationships
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-[500px]" />
        </div>
      ) : nodes.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <p className="text-lg font-medium text-txt-primary">No knowledge graph data yet</p>
            <p className="mt-1 text-sm text-txt-muted">
              Run agents with graph tools enabled to start building the knowledge graph
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-[400px]">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-txt-faint" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search nodes…"
                className="w-full rounded-lg border border-border bg-base pl-9 pr-3 py-2 text-sm text-txt-primary placeholder:text-txt-faint focus:border-cyan focus:outline-none"
              />
            </div>

            {/* Type filters */}
            <div className="flex flex-wrap gap-1">
              {allNodeTypes.map((type) => {
                const active = filterNodeTypes.has(type);
                const color = NODE_COLORS[type];
                return (
                  <button
                    key={type}
                    onClick={() => toggleFilter(type)}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                      active
                        ? 'border-transparent text-black'
                        : 'border-border text-txt-muted hover:border-[color:var(--c)] hover:text-[color:var(--c)]'
                    }`}
                    style={
                      active
                        ? { backgroundColor: color }
                        : ({ '--c': color } as React.CSSProperties)
                    }
                  >
                    {(() => { const TypeIcon = NODE_ICONS[type]; return <TypeIcon className="inline-block text-[12px]" />; })()} {type}
                  </button>
                );
              })}
              {filterNodeTypes.size > 0 && (
                <button
                  onClick={() => setFilterNodeTypes(new Set())}
                  className="rounded-full border border-border px-2.5 py-1 text-[10px] font-medium text-txt-muted hover:text-txt-primary"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Stats */}
          <StatsBar
            nodes={nodes.filter((n) => {
              if (filterNodeTypes.size > 0 && !filterNodeTypes.has(n.node_type as NodeType)) return false;
              if (searchQuery) {
                const q = searchQuery.toLowerCase();
                return n.title.toLowerCase().includes(q) || n.summary?.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q));
              }
              return true;
            })}
            edges={edges}
            totalNodes={nodes.length}
          />

          {/* Graph + Detail Panel */}
          <div className="relative overflow-hidden rounded-xl border border-border bg-surface dark:bg-white/[0.04] dark:backdrop-blur-xl dark:border-white/[0.08]" style={{ height: '700px' }}>
            <GraphCanvas
              nodes={nodes}
              edges={edges}
              onSelectNode={handleSelectNode}
              selectedNodeId={selectedNode?.id ?? null}
              highlightedNodeIds={highlightedNodeIds}
              filterNodeTypes={filterNodeTypes}
              searchQuery={searchQuery}
            />
            {selectedNode && (
              <NodeDetail
                node={selectedNode}
                edges={edges}
                allNodes={nodes}
                onClose={() => setSelectedNode(null)}
                onNavigateNode={handleNavigateNode}
              />
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[11px]">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-txt-faint mb-1">Node Types</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {allNodeTypes.map((type) => (
                  <span key={type} className="flex items-center gap-1">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full border"
                      style={{ borderColor: NODE_COLORS[type], backgroundColor: `${NODE_COLORS[type]}30` }}
                    />
                    <span className="text-txt-muted">{type}</span>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-txt-faint mb-1">Edge Types</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {Object.entries(EDGE_STYLES).map(([type, style]) => (
                  <span key={type} className="flex items-center gap-1">
                    <span
                      className="inline-block h-0.5 w-4"
                      style={{
                        backgroundColor: style.color,
                        borderBottom: style.dashed ? `1px dashed ${style.color}` : undefined,
                      }}
                    />
                    <span className="text-txt-muted">{type.replace(/_/g, ' ')}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Icons ─────────────────────────────────────── */

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  );
}
