import { useState, useMemo } from 'react';
import { DISPLAY_NAME_MAP, ROLE_DEPARTMENT, ROLE_TIER, ROLE_TITLE, AGENT_META } from '../lib/types';
import { MdClose, MdSearch, MdExpandMore, MdChevronRight } from 'react-icons/md';

interface OrgAgent {
  role: string;
  department?: string | null;
}

interface Props {
  agents: OrgAgent[];
  onSelect: (role: string) => void;
  onClose: () => void;
}

const DEPT_ORDER = [
  'Executive Office',
  'Engineering',
  'Product',
  'Finance',
  'Marketing',
  'Sales',
  'Design & Frontend',
  'Research & Intelligence',
  'Operations',
  'Operations & IT',
  'Legal',
  'People & Culture',
];

const TIER_PRIORITY: Record<string, number> = {
  Orchestrator: 0,
  Executive: 1,
  Specialist: 2,
  'Sub-Team': 3,
};

export default function OrgChartPicker({ agents, onSelect, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(DEPT_ORDER));

  const departments = useMemo(() => {
    const deptMap = new Map<string, OrgAgent[]>();
    for (const agent of agents) {
      const dept = agent.department || ROLE_DEPARTMENT[agent.role] || 'Other';
      if (!deptMap.has(dept)) deptMap.set(dept, []);
      deptMap.get(dept)!.push(agent);
    }

    // Sort agents within each dept: executives first, then sub-team
    for (const [, list] of deptMap) {
      list.sort((a, b) => {
        const tierA = TIER_PRIORITY[ROLE_TIER[a.role] ?? 'Sub-Team'] ?? 3;
        const tierB = TIER_PRIORITY[ROLE_TIER[b.role] ?? 'Sub-Team'] ?? 3;
        return tierA - tierB;
      });
    }

    // Order departments by DEPT_ORDER, then any remaining
    const ordered: [string, OrgAgent[]][] = [];
    for (const dept of DEPT_ORDER) {
      if (deptMap.has(dept)) {
        ordered.push([dept, deptMap.get(dept)!]);
        deptMap.delete(dept);
      }
    }
    for (const [dept, list] of deptMap) {
      ordered.push([dept, list]);
    }

    return ordered;
  }, [agents]);

  const isSearching = search.trim().length > 0;

  const filtered = useMemo(() => {
    if (!isSearching) return departments;
    const q = search.toLowerCase();
    return departments
      .map(
        ([dept, list]) =>
          [
            dept,
            list.filter((a) => {
              const name = (DISPLAY_NAME_MAP[a.role] ?? '').toLowerCase();
              const title = (ROLE_TITLE[a.role] ?? '').toLowerCase();
              return name.includes(q) || title.includes(q) || a.role.includes(q);
            }),
          ] as [string, OrgAgent[]],
      )
      .filter(([, list]) => list.length > 0);
  }, [departments, search, isSearching]);

  const toggleDept = (dept: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  return (
    <div
      className="theme-overlay-backdrop-strong fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[80vh] rounded-xl border border-border bg-surface shadow-prism-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-sm font-semibold text-txt-primary">New Chat — Org Chart</h3>
          <button
            onClick={onClose}
            className="text-txt-faint hover:text-txt-primary transition-colors"
          >
            <MdClose size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-raised px-3 py-2">
            <MdSearch size={16} className="text-txt-faint flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, role, or department..."
              className="flex-1 bg-transparent text-[13px] text-txt-secondary placeholder-txt-faint outline-none"
              autoFocus
            />
          </div>
        </div>

        {/* Org Chart */}
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {filtered.map(([dept, agentList]) => (
            <div key={dept} className="mb-1">
              <button
                onClick={() => toggleDept(dept)}
                className="flex w-full items-center gap-1.5 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-txt-muted hover:text-txt-secondary transition-colors"
              >
                {expanded.has(dept) && !isSearching ? (
                  <MdExpandMore size={16} />
                ) : isSearching ? (
                  <MdExpandMore size={16} />
                ) : (
                  <MdChevronRight size={16} />
                )}
                {dept}
                <span className="text-txt-faint font-normal ml-1">({agentList.length})</span>
              </button>
              {(isSearching || expanded.has(dept)) &&
                agentList.map((agent) => {
                  const meta = AGENT_META[agent.role];
                  const tier = ROLE_TIER[agent.role];
                  const isLead = tier === 'Executive' || tier === 'Orchestrator';
                  return (
                    <button
                      key={agent.role}
                      onClick={() => onSelect(agent.role)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[var(--color-hover-bg)] transition-colors ${isLead ? '' : 'ml-4'}`}
                    >
                      <img
                        src={`/avatars/${agent.role}.png`}
                        alt=""
                        className={`rounded-full object-cover flex-shrink-0 ${isLead ? 'h-9 w-9' : 'h-7 w-7'}`}
                        style={{ border: `2px solid ${meta?.color ?? '#64748b'}40` }}
                        onError={(e) => {
                          const img = e.currentTarget;
                          const fallback = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(DISPLAY_NAME_MAP[agent.role] ?? agent.role)}&radius=50&bold=true`;
                          if (img.src !== fallback) { img.src = fallback; img.onerror = null; }
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={`truncate ${isLead ? 'text-[13px] font-semibold text-txt-primary' : 'text-[12px] font-medium text-txt-secondary'}`}
                        >
                          {DISPLAY_NAME_MAP[agent.role] ?? agent.role}
                        </p>
                        <p className="text-[10px] text-txt-faint truncate">
                          {ROLE_TITLE[agent.role] ?? agent.role}
                        </p>
                      </div>
                      {isLead && (
                        <span className="text-[9px] font-medium uppercase px-1.5 py-0.5 rounded-full bg-cyan/10 text-cyan tracking-wider flex-shrink-0">
                          {tier === 'Orchestrator' ? 'CoS' : 'Lead'}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-[12px] text-txt-faint py-8">
              No agents match &ldquo;{search}&rdquo;
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
