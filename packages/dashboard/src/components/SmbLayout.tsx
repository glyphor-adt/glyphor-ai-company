import { BarChart3, CheckSquare, LayoutGrid, Settings, Users } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTheme } from '../lib/theme';
import { useAuth } from '../lib/auth';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

const NAV: Array<{
  to: string;
  label: string;
  icon: typeof Users;
  requiresApprovals?: boolean;
}> = [
  { to: '/app/smb/team', label: 'Team', icon: Users },
  { to: '/app/smb/work', label: 'Work', icon: LayoutGrid },
  { to: '/app/smb/approvals', label: 'Approvals', icon: CheckSquare, requiresApprovals: true },
  { to: '/app/smb/insights', label: 'Insights', icon: BarChart3 },
  { to: '/app/smb/settings', label: 'Settings', icon: Settings },
];

export default function SmbLayout() {
  const { theme, toggle } = useTheme();
  const { user, profile, logout, setDashboardModeOverride } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const bgRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const navItems = NAV.filter((item) => !item.requiresApprovals || (profile?.pending_approvals ?? 0) > 0);

  useEffect(() => {
    const main = mainRef.current;
    const bg = bgRef.current;
    if (!main || !bg) return;
    if (theme !== 'dark') {
      bg.style.removeProperty('--gradient-offset');
      return;
    }
    const update = () => {
      const max = main.scrollHeight - main.clientHeight;
      if (max <= 0) {
        bg.style.setProperty('--gradient-offset', '0px');
        return;
      }
      const ratio = Math.min(main.scrollTop / max, 1);
      const shift = ratio * (4200 - window.innerHeight);
      bg.style.setProperty('--gradient-offset', `${-shift}px`);
    };
    main.addEventListener('scroll', update, { passive: true });
    update();
    return () => main.removeEventListener('scroll', update);
  }, [theme]);

  function openInternalDashboard() {
    setDashboardModeOverride('internal');
    navigate('/app/internal/dashboard');
  }

  return (
    <>
      <div ref={bgRef} className="mesh-gradient-bg" />
      <div className="dashboard-shell flex h-screen overflow-x-hidden">
        <aside className={`dashboard-sidebar sidebar-glass hidden w-[220px] flex-col transition-colors duration-200 md:flex ${theme === 'dark' ? 'dashboard-sidebar--dark' : 'dashboard-sidebar--light'}`}>
          <div className="relative z-10 flex items-center justify-between px-4 py-4">
            <BrandLockup theme={theme} />
          </div>

          <nav className="relative z-10 flex-1 space-y-0.5 overflow-y-auto scrollbar-hide px-3">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/app/smb/dashboard'}
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

          <div className="relative z-10 px-4 py-3">
            <Button
              variant="ghost"
              onClick={openInternalDashboard}
              className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors ${
                theme === 'dark'
                  ? 'text-white/70 hover:bg-cyan/10 hover:text-white'
                  : 'text-prism-tertiary hover:bg-prism-bg2 hover:text-prism-primary'
              }`}
            >
              <OrbitIcon className="h-5 w-5" />
              Advanced view
            </Button>
            <Button
              variant="ghost"
              onClick={toggle}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors ${
                theme === 'dark'
                  ? 'text-white/70 hover:bg-cyan/10 hover:text-white'
                  : 'text-prism-tertiary hover:bg-prism-bg2 hover:text-prism-primary'
              }`}
            >
              {theme === 'dark' ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </Button>
          </div>

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
                <Button variant="ghost" onClick={logout} className="text-[12px] text-prism-tertiary transition-colors hover:text-prism-primary">
                  Sign out
                </Button>
              </div>
            </div>
          </div>
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-50 md:hidden" onClick={() => setDrawerOpen(false)}>
            <div className="theme-overlay-backdrop absolute inset-0" />
            <aside
              className={`dashboard-sidebar sidebar-glass absolute bottom-0 left-0 top-0 flex w-[280px] flex-col shadow-xl ${theme === 'dark' ? 'dashboard-sidebar--dark' : 'dashboard-sidebar--light'}`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="relative z-10 flex items-center justify-between px-4 py-4">
                <BrandLockup theme={theme} />
                <Button variant="ghost" size="icon-sm" onClick={() => setDrawerOpen(false)} className="p-1 text-prism-tertiary">
                  <CloseIcon className="h-5 w-5" />
                </Button>
              </div>

              <nav className="relative z-10 flex-1 space-y-0.5 overflow-y-auto scrollbar-hide px-3">
                {navItems.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/app/smb/dashboard'}
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

              <div className="relative z-10 px-4 py-3">
                <Button
                  variant="ghost"
                  onClick={openInternalDashboard}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium text-prism-tertiary"
                >
                  <OrbitIcon className="h-5 w-5" />
                  Advanced view
                </Button>
                <Button
                  variant="ghost"
                  onClick={toggle}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium text-prism-tertiary"
                >
                  {theme === 'dark' ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
                  {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                </Button>
              </div>

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
                    <Button variant="ghost" onClick={logout} className="text-[12px] text-prism-tertiary">
                      Sign out
                    </Button>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}

        <main ref={mainRef} className="dashboard-main flex-1 overflow-y-auto pb-16 md:pb-0 safe-top">
          <div className="dashboard-content">
            <div className="page-enter mx-auto max-w-[1400px] px-6 py-4 md:px-8 md:py-8">
              <Outlet />
            </div>
          </div>
        </main>

        <nav className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-prism-border bg-prism-card md:hidden safe-bottom">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/app/smb/dashboard'}
              className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${isActive ? 'text-cyan' : 'text-prism-tertiary'}`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
          <Button
            variant="ghost"
            onClick={() => setDrawerOpen(true)}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-prism-tertiary"
          >
            <MenuIcon className="h-5 w-5" />
            More
          </Button>
        </nav>
      </div>
    </>
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

function OrbitIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="1.8" />
      <path d="M13.2 8a5.2 5.2 0 0 1-5.2 5.2A5.2 5.2 0 0 1 2.8 8 5.2 5.2 0 0 1 8 2.8 5.2 5.2 0 0 1 13.2 8Z" />
      <path d="M3.8 3.8 12.2 12.2" />
    </svg>
  );
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
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 4l16 16M20 4 4 20" />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M11.6 10.6A5.5 5.5 0 0 1 5.4 4.4 5.8 5.8 0 1 0 11.6 10.6Z" />
    </svg>
  );
}