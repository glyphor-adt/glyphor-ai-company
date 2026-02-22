import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/', label: 'Dashboard', icon: GridIcon },
  { to: '/workforce', label: 'Workforce', icon: UsersIcon },
  { to: '/approvals', label: 'Approvals', icon: CheckIcon },
  { to: '/chat', label: 'Chat', icon: ChatIcon },
] as const;

export default function Layout() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ─────────────────────────── */}
      <aside className="flex w-[220px] flex-col border-r border-border bg-raised">
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-5 py-5">
          <GlyphorLogo className="h-9 w-9 flex-shrink-0 drop-shadow-[0_0_8px_rgba(0,224,255,0.35)]" />
          <span className="text-lg font-semibold tracking-tight bg-gradient-to-r from-cyan to-azure bg-clip-text text-transparent">
            Glyphor
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                  isActive
                    ? 'bg-cyan/10 text-cyan'
                    : 'text-slate-400 hover:bg-white/[.03] hover:text-slate-200'
                }`
              }
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-border px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan/20 text-[11px] font-bold text-cyan">
              KD
            </div>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium text-slate-200">Kristina</p>
              <p className="truncate text-[11px] text-slate-500">CEO</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main Content ────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-base">
        <div className="page-enter mx-auto max-w-[1400px] px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/* ── Inline SVG Icons ─────────────────────── */
function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="6" cy="5" r="2.5" />
      <path d="M1.5 14c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" />
      <circle cx="11" cy="5.5" r="1.8" />
      <path d="M11 9.5c1.8 0 3.5 1.3 3.5 3.5" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M5 8l2 2 4-4" />
    </svg>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2 3h12v8H6l-3 2.5V11H2z" rx="1" />
    </svg>
  );
}
