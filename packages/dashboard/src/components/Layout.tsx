import { NavLink, Outlet } from 'react-router-dom';
import { useTheme } from '../lib/theme';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'Dashboard', icon: GridIcon },
  { to: '/directives', label: 'Directives', icon: DirectivesIcon },
  { to: '/workforce', label: 'Workforce', icon: UsersIcon },
  { to: '/comms', label: 'Comms', icon: ChatIcon },
  { to: '/approvals', label: 'Approvals', icon: CheckIcon },
  { to: '/financials', label: 'Financials', icon: ChartIcon },
  { to: '/operations', label: 'Operations', icon: GearIcon },
  { to: '/strategy', label: 'Strategy', icon: StrategyIcon },
  { to: '/knowledge', label: 'Knowledge', icon: KnowledgeIcon },
  { to: '/capabilities', label: 'Capabilities', icon: SkillsIcon },
  { to: '/builder', label: 'Builder', icon: BuilderIcon },
  { to: '/governance', label: 'Governance', icon: GovernanceIcon },
  { to: '/change-requests', label: 'Change Requests', icon: ChangeRequestIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
] as const;

export default function Layout() {
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();
  return (
    <div className="flex h-screen overflow-hidden bg-base">
      {/* ── Sidebar ─────────────────────────── */}
      <aside className="flex w-[220px] flex-col border-r border-prism-border bg-prism-card transition-colors duration-200">
        {/* Brand */}
        <div className="flex items-center gap-3 px-4 py-4">
          <img src="/glyphor-logo.png" alt="Glyphor" className="h-10 w-10 drop-shadow-[0_0_10px_rgba(34,211,238,0.4)]" />
          <span className="text-lg font-prism-display tracking-tight text-prism-primary">
            glyphor
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
                    ? 'bg-prism-bg2 text-prism-primary font-semibold'
                    : 'text-prism-tertiary hover:bg-prism-bg2 hover:text-prism-primary'
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
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-prism-tertiary transition-colors hover:bg-prism-bg2 hover:text-prism-primary"
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
        <div className="border-t border-prism-border px-4 py-4">
          <div className="flex items-center gap-2.5">
            {user?.picture ? (
              <img src={user.picture} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-prism-bg2 text-[11px] font-bold text-prism-primary">
                {(user?.name ?? 'U')[0]}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium text-prism-primary">{user?.name ?? 'User'}</p>
              <button onClick={logout} className="text-[11px] text-prism-tertiary hover:text-prism-primary transition-colors">Sign out</button>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main Content ────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-prism-bg transition-colors duration-200">
        <div className="h-1 w-full bg-prism-gradient" />
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

function GroupChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M1 2.5h10v6H4.5l-2 1.5V8.5H1z" />
      <path d="M5 6h9v6h-2.5v1.5l-2-1.5H5z" />
    </svg>
  );
}

function GraphIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="4" cy="4" r="2" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="13" cy="11" r="1.5" />
      <path d="M5.8 5.2L7 10M10.2 5.2L9 10M12 5.5L12.5 9.5" />
    </svg>
  );
}

function SkillsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M8 1l2 3h3l-2.5 3L12 10l-4-2-4 2 1.5-3L3 4h3z" />
      <path d="M6 11v3M10 11v3M8 12v3" />
    </svg>
  );
}

function BuilderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="5" y="1" width="6" height="4" rx="1" />
      <rect x="1" y="11" width="5" height="4" rx="1" />
      <rect x="10" y="11" width="5" height="4" rx="1" />
      <path d="M8 5v3M3.5 11V8h9v3" />
    </svg>
  );
}

function DirectivesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2" y="1.5" width="12" height="13" rx="1.5" />
      <path d="M5 5h6M5 8h6M5 11h4" />
    </svg>
  );
}

function KnowledgeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2 2h5v6H2zM9 2h5v4H9zM9 8h5v6H9zM2 10h5v4H2z" />
      <circle cx="4.5" cy="5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="4" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="11" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M1 8h3l2-5 2 10 2-5h5" />
    </svg>
  );
}

function GovernanceIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2" y="6" width="12" height="8" rx="1.5" />
      <path d="M5 6V4.5a3 3 0 016 0V6" />
      <circle cx="8" cy="10.5" r="1.2" />
      <path d="M8 11.7v1.3" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M6.5 1.5h3l.5 2 1.5.8 1.8-1 2 2-1 1.8.8 1.5 2 .5v3l-2 .5-1 1.5 1 1.8-2 2-1.8-1-1.5.8-.5 2h-3l-.5-2-1.5-.8-1.8 1-2-2 1-1.8-.8-1.5-2-.5v-3l2-.5 1-1.5-1-1.8 2-2 1.8 1 1.5-.8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function WorldModelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 2v12M2 8h12M3.5 4.5Q8 7 12.5 4.5M3.5 11.5Q8 9 12.5 11.5" />
    </svg>
  );
}

function ChangeRequestIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2" y="1.5" width="12" height="13" rx="1.5" />
      <path d="M5 5h3M5 8h6" />
      <path d="M10 4l2 2-2 2" />
    </svg>
  );
}
