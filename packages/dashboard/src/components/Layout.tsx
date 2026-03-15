import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTheme } from '../lib/theme';
import { useAuth } from '../lib/auth';
import { Orbit } from 'lucide-react';
import { useState, useEffect } from 'react';

const NAV = [
  { to: '/', label: 'Dashboard', icon: GridIcon },
  { to: '/directives', label: 'Directives', icon: DirectivesIcon },
  { to: '/workforce', label: 'Workforce', icon: UsersIcon },
  { to: '/comms', label: 'Comms', icon: ChatIcon },
  { to: '/ora', label: 'Ora', icon: OraIcon },
  { to: '/approvals', label: 'Approvals', icon: CheckIcon },
  { to: '/financials', label: 'Financials', icon: ChartIcon },
  { to: '/operations', label: 'Operations', icon: GearIcon },
  { to: '/strategy', label: 'Strategy', icon: StrategyIcon },
  { to: '/knowledge', label: 'Knowledge', icon: KnowledgeIcon },
  { to: '/skills', label: 'Skills', icon: SkillsIcon },
  { to: '/builder', label: 'Builder', icon: BuilderIcon },
  { to: '/governance', label: 'Governance', icon: GovernanceIcon },
  { to: '/change-requests', label: 'Change Requests', icon: ChangeRequestIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
] as const;

// Bottom tab bar shows these 5 + a "More" button for the slide-out drawer
const MOBILE_TABS = [
  { to: '/', label: 'Home', icon: GridIcon },
  { to: '/workforce', label: 'Team', icon: UsersIcon },
  { to: '/ora', label: 'Ora', icon: OraIcon },
  { to: '/comms', label: 'Comms', icon: ChatIcon },
  { to: '/approvals', label: 'Approvals', icon: CheckIcon },
] as const;

export default function Layout() {
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();
  const location = useLocation();
  const FULL_BLEED_ROUTES = ['/comms', '/ora'];
  const isFullBleed = FULL_BLEED_ROUTES.some(r => location.pathname === r || location.pathname.startsWith(r + '/'));
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer on navigation
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  return (
    <div className="dashboard-shell mesh-gradient flex h-screen overflow-x-hidden">
      {/* ── Desktop Sidebar ─────────────────── */}
      <aside className={`dashboard-sidebar sidebar-glass hidden w-[220px] flex-col transition-colors duration-200 md:flex ${theme === 'dark' ? 'dashboard-sidebar--dark' : 'dashboard-sidebar--light'}`}>
        {/* Brand */}
        <div className="relative z-10 flex items-center justify-between px-4 py-4">
          <BrandLockup theme={theme} />
        </div>

        {/* Nav links */}
        <nav className="relative z-10 flex-1 space-y-0.5 overflow-y-auto px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium transition-colors ${
                  isActive
                    ? `nav-item-active ${theme === 'dark' ? 'nav-item-active--dark' : 'nav-item-active--light'} text-prism-primary font-semibold`
                    : theme === 'dark'
                      ? 'text-white/70 hover:bg-cyan/10 hover:text-white'
                      : 'text-prism-tertiary hover:bg-prism-bg2 hover:text-prism-primary'
                }`
              }
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        {/* Theme Toggle */}
        <div className="relative z-10 px-4 py-3">
          <button
            onClick={toggle}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors ${
              theme === 'dark'
                ? 'text-white/70 hover:bg-cyan/10 hover:text-white'
                : 'text-prism-tertiary hover:bg-prism-bg2 hover:text-prism-primary'
            }`}
          >
            {theme === 'dark' ? (
              <SunIcon className="h-5 w-5" />
            ) : (
              <MoonIcon className="h-5 w-5" />
            )}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
        {/* Footer */}
        <div className="relative z-10 px-4 py-4">
          <div className="flex items-center gap-2.5">
            {user?.picture ? (
              <img src={user.picture} alt="" className="h-8 w-8 rounded-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-prism-bg2 text-[12px] font-bold text-prism-primary">
                {(user?.name ?? 'U')[0]}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-prism-primary">{user?.name ?? 'User'}</p>
              <button onClick={logout} className="text-[12px] text-prism-tertiary transition-colors hover:text-prism-primary">Sign out</button>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Mobile Drawer Overlay ───────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside
            className={`dashboard-sidebar sidebar-glass absolute bottom-0 left-0 top-0 flex w-[280px] flex-col shadow-xl ${theme === 'dark' ? 'dashboard-sidebar--dark' : 'dashboard-sidebar--light'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Brand */}
            <div className="relative z-10 flex items-center justify-between px-4 py-4">
              <BrandLockup theme={theme} />
              <button onClick={() => setDrawerOpen(false)} className="p-1 text-prism-tertiary">
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
            {/* Full nav */}
            <nav className="relative z-10 flex-1 space-y-0.5 overflow-y-auto px-3">
              {NAV.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium transition-colors ${
                      isActive
                        ? `nav-item-active ${theme === 'dark' ? 'nav-item-active--dark' : 'nav-item-active--light'} text-prism-primary font-semibold`
                        : theme === 'dark'
                          ? 'text-white/70 hover:bg-cyan/10 hover:text-white'
                          : 'text-prism-tertiary hover:bg-prism-bg2 hover:text-prism-primary'
                    }`
                  }
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  {label}
                </NavLink>
              ))}
            </nav>
            {/* Theme + User */}
            <div className="relative z-10 px-4 py-3">
              <button
                onClick={toggle}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium text-prism-tertiary"
              >
                {theme === 'dark' ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
            </div>
            <div className="relative z-10 px-4 py-4">
              <div className="flex items-center gap-2.5">
                {user?.picture ? (
                  <img src={user.picture} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-prism-bg2 text-[12px] font-bold text-prism-primary">
                    {(user?.name ?? 'U')[0]}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-prism-primary">{user?.name ?? 'User'}</p>
                  <button onClick={logout} className="text-[12px] text-prism-tertiary">Sign out</button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ── Main Content ────────────────────── */}
      <main className={`dashboard-main flex-1 transition-colors duration-200 ${isFullBleed ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'} pb-16 md:pb-0 safe-top`}>
        <div className="dashboard-content">
          {isFullBleed ? (
            <div className="page-enter min-h-0 flex-1 px-4 py-4 md:px-8 md:py-8">
              <Outlet />
            </div>
          ) : (
            <div className="page-enter mx-auto max-w-[1400px] px-6 py-4 md:px-8 md:py-8">
              <Outlet />
            </div>
          )}
        </div>
      </main>

      {/* ── Mobile Bottom Tab Bar ───────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden border-t border-prism-border bg-prism-card safe-bottom">
        {MOBILE_TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                isActive ? 'text-cyan' : 'text-prism-tertiary'
              }`
            }
          >
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-prism-tertiary"
        >
          <MenuIcon className="h-5 w-5" />
          More
        </button>
      </nav>
    </div>
  );
}

function BrandLockup({ theme, compact = false }: { theme: 'dark' | 'light'; compact?: boolean }) {
  return (
    <div className={`flex items-center ${compact ? 'justify-center' : 'gap-2.5'}`}>
      <div className={`brand-badge ${compact ? 'brand-badge--compact' : ''}`}>
        <img src="/icons/icon-192x192.png" alt="Glyphor icon" className="h-9 w-9 object-contain" />
      </div>
      {!compact && (
        <span className={`font-agency text-[1.65rem] lowercase leading-none ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
          glyphor
        </span>
      )}
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

function PolicyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M8 1L2 4v4c0 4 2.5 6 6 7 3.5-1 6-3 6-7V4z" />
      <path d="M5.5 8l2 2 3.5-4" />
    </svg>
  );
}

function OraIcon({ className }: { className?: string }) {
  return <Orbit className={className} size={16} />;
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2 4h12M2 8h12M2 12h12" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
