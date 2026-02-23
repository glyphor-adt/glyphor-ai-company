import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Card, SectionHeader, Skeleton } from '../components/ui';

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
  | 'opportunity' | 'learning' | 'goal' | 'project' | 'process' | 'person';

type EdgeType =
  | 'causes' | 'precedes' | 'relates_to' | 'part_of' | 'depends_on'
  | 'created_by' | 'assigned_to' | 'measured_by' | 'mitigates' | 'enables';

/* ── Constants ─────────────────────────────────── */

const NODE_COLORS: Record<NodeType, string> = {
  entity: '#00E0FF',
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
};

const NODE_ICONS: Record<NodeType, string> = {
  entity: '🏢',
  concept: '💡',
  decision: '⚖️',
  metric: '📊',
  risk: '⚠️',
  opportunity: '🚀',
  learning: '📚',
  goal: '🎯',
  project: '📋',
  process: '⚙️',
  person: '👤',
};

const EDGE_STYLES: Record<EdgeType, { color: string; dashed: boolean }> = {
  causes: { color: '#F87171', dashed: false },
  precedes: { color: '#60A5FA', dashed: false },
  relates_to: { color: '#6B7280', dashed: true },
  part_of: { color: '#A78BFA', dashed: false },
  depends_on: { color: '#FB923C', dashed: true },
  created_by: { color: '#34D399', dashed: true },
  assigned_to: { color: '#F472B6', dashed: true },
  measured_by: { color: '#FBBF24', dashed: true },
  mitigates: { color: '#2DD4BF', dashed: false },
  enables: { color: '#818CF8', dashed: false },
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
    // Initialize positions — keep existing positions for nodes that haven't changed
    const existing = new Map(simNodes.current.map((n) => [n.id, n]));
    simNodes.current = nodes.map((n) => {
      const prev = existing.get(n.id);
      if (prev) return { ...n, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy, radius: prev.radius };
      return {
        ...n,
        x: width / 2 + (Math.random() - 0.5) * width * 0.6,
        y: height / 2 + (Math.random() - 0.5) * height * 0.6,
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

    // Set radius based on connectivity
    simNodes.current.forEach((n) => {
      const connections = edgeIndex.get(n.id)?.length ?? 0;
      n.radius = Math.max(16, Math.min(32, 16 + connections * 3));
    });

    let iterations = 0;
    const maxIterations = 300;

    function simulate() {
      const sn = simNodes.current;
      const alpha = Math.max(0.001, 1 - iterations / maxIterations);
      const repulsion = 800;
      const attraction = 0.005;
      const damping = 0.85;

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

      // Attraction along edges
      const nodeMap = new Map(sn.map((n) => [n.id, n]));
      edges.forEach((e) => {
        const s = nodeMap.get(e.source_id);
        const t = nodeMap.get(e.target_id);
        if (!s || !t) return;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const targetDist = 120;
        const force = (dist - targetDist) * attraction * alpha;
        const fx = (dx / Math.max(1, dist)) * force;
        const fy = (dy / Math.max(1, dist)) * force;
        s.vx += fx;
        s.vy += fy;
        t.vx -= fx;
        t.vy -= fy;
      });

      // Center gravity
      sn.forEach((n) => {
        n.vx += (width / 2 - n.x) * 0.001 * alpha;
        n.vy += (height / 2 - n.y) * 0.001 * alpha;
      });

      // Apply velocity
      sn.forEach((n) => {
        n.vx *= damping;
        n.vy *= damping;
        n.x += n.vx;
        n.y += n.vy;
        // Boundary constraint
        n.x = Math.max(n.radius + 10, Math.min(width - n.radius - 10, n.x));
        n.y = Math.max(n.radius + 10, Math.min(height - n.radius - 10, n.y));
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

  // Filter nodes
  const filteredNodes = nodes.filter((n) => {
    if (filterNodeTypes.size > 0 && !filterNodeTypes.has(n.node_type as NodeType)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return n.title.toLowerCase().includes(q) || n.summary?.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q));
    }
    return true;
  });
  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter((e) => filteredNodeIds.has(e.source_id) && filteredNodeIds.has(e.target_id));

  const { simNodes, tick } = useForceSimulation(filteredNodes, filteredEdges, dims.width, dims.height);

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
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const label = n.title.length > 18 ? n.title.substring(0, 16) + '…' : n.title;
      ctx.fillText(label, n.x, n.y + n.radius + 4);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, dims, selectedNodeId, highlightedNodeIds, filteredEdges, simNodes]);

  // Click handler
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

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
      <canvas ref={canvasRef} onClick={handleClick} className="cursor-pointer" />
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
  const icon = NODE_ICONS[node.node_type as NodeType] ?? '📄';
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
            <span className="text-xl">{icon}</span>
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
                    <span className="text-txt-faint">→</span>
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
                    <span className="text-txt-faint">→</span>
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

function StatsBar({ nodes, edges }: { nodes: KgNode[]; edges: KgEdge[] }) {
  const typeCounts = new Map<string, number>();
  nodes.forEach((n) => typeCounts.set(n.node_type, (typeCounts.get(n.node_type) ?? 0) + 1));

  return (
    <div className="flex items-center gap-4 text-[11px]">
      <span className="text-txt-muted">
        <span className="font-semibold text-txt-primary">{nodes.length}</span> nodes
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
                    {NODE_ICONS[type]} {type}
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
          <StatsBar nodes={nodes} edges={edges} />

          {/* Graph + Detail Panel */}
          <div className="relative overflow-hidden rounded-xl border border-border bg-surface dark:bg-white/[0.04] dark:backdrop-blur-xl dark:border-white/[0.08]" style={{ height: '560px' }}>
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
