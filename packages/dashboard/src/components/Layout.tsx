import { NavLink, Outlet } from 'react-router-dom';
import { useTheme } from '../lib/theme';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'Dashboard', icon: GridIcon },
  { to: '/workforce', label: 'Workforce', icon: UsersIcon },
  { to: '/agents', label: 'Agents', icon: AgentIcon },
  { to: '/chat', label: 'Chat', icon: ChatIcon },
  { to: '/approvals', label: 'Approvals', icon: CheckIcon },
  { to: '/financials', label: 'Financials', icon: ChartIcon },
  { to: '/operations', label: 'Operations', icon: GearIcon },
  { to: '/strategy', label: 'Strategy', icon: StrategyIcon },
  { to: '/meetings', label: 'Meetings', icon: MeetingsIcon },
] as const;

export default function Layout() {
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();
  return (
    <div className="flex h-screen overflow-hidden bg-base">
      {/* ── Sidebar ─────────────────────────── */}
      <aside className="flex w-[220px] flex-col border-r border-border bg-raised transition-colors duration-200">
        {/* Brand */}
        <div className="flex items-center gap-3 px-4 py-4">
          <img src="/glyphor-logo.png" alt="Glyphor" className="h-10 w-10 drop-shadow-[0_0_10px_rgba(0,224,255,0.4)]" />
          <span className="text-lg font-semibold tracking-tight text-txt-primary">
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
                    : 'text-txt-muted hover:bg-[var(--color-hover-bg)] hover:text-txt-secondary'
                }`
              }
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        {/* Theme Toggle */}
        <div className="px-4 py-2">
          <button
            onClick={toggle}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-txt-muted transition-colors hover:bg-[var(--color-hover-bg)] hover:text-txt-secondary"
          >
            {theme === 'dark' ? (
              <SunIcon className="h-4 w-4" />
            ) : (
              <MoonIcon className="h-4 w-4" />
            )}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
        {/* Footer */}
        <div className="border-t border-border px-4 py-4">
          <div className="flex items-center gap-2.5">
            {user?.picture ? (
              <img src={user.picture} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan/20 text-[11px] font-bold text-cyan">
                {(user?.name ?? 'U')[0]}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium text-txt-secondary">{user?.name ?? 'User'}</p>
              <button onClick={logout} className="text-[11px] text-txt-muted hover:text-cyan transition-colors">Sign out</button>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main Content ────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-base transition-colors duration-200">
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

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2 14V6l4-4 3 3 5-3v12z" />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M13.5 8.5a5.5 5.5 0 01-7.5-7.5 6 6 0 107.5 7.5z" />
    </svg>
  );
}

function AgentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="5" r="3" />
      <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
      <circle cx="12" cy="4" r="1.5" />
    </svg>
  );
}

function StrategyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2 14l4-5 3 3 5-8" />
      <path d="M11 4h3v3" />
    </svg>
  );
}

function MeetingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="4" cy="5" r="2" />
      <circle cx="12" cy="5" r="2" />
      <circle cx="8" cy="12" r="2" />
      <path d="M6 5h4M5.5 6.5L7 10.5M10.5 6.5L9 10.5" />
    </svg>
  );
}
