import { BarChart3, CheckSquare, LayoutGrid, Settings, Sparkles, Users } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTheme } from '../lib/theme';
import { useAuth } from '../lib/auth';

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

  const navItems = NAV.filter((item) => !item.requiresApprovals || (profile?.pending_approvals ?? 0) > 0);

  return (
    <div className="dashboard-shell flex min-h-screen bg-base">
      <aside className={`dashboard-sidebar sidebar-glass hidden w-[250px] flex-col md:flex ${theme === 'dark' ? 'dashboard-sidebar--dark' : 'dashboard-sidebar--light'}`}>
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="brand-badge">
            <img src="/icons/icon-192x192.png" alt="Glyphor" className="h-9 w-9 object-contain" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-txt-faint">Glyphor</p>
            <h1 className="text-lg font-semibold text-txt-primary">Simple view</h1>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 pb-4">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-cyan/15 text-cyan'
                    : 'text-txt-secondary hover:bg-base/70 hover:text-txt-primary'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-3 px-4 pb-4">
          <button
            onClick={() => {
              setDashboardModeOverride('internal');
              navigate('/app/internal/dashboard');
            }}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-base px-4 py-3 text-left text-sm font-medium text-txt-primary transition-colors hover:border-border-hover hover:bg-base/80"
          >
            <Sparkles className="h-4 w-4 text-cyan" />
            Switch to advanced view
          </button>

          <button
            onClick={toggle}
            className="w-full rounded-xl border border-border px-4 py-2 text-sm text-txt-secondary transition-colors hover:border-border-hover hover:text-txt-primary"
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>

          <div className="rounded-2xl border border-border bg-base px-4 py-3">
            <p className="text-sm font-medium text-txt-primary">{user?.name ?? 'User'}</p>
            <p className="truncate text-xs text-txt-muted">{user?.email ?? ''}</p>
            <button onClick={logout} className="mt-2 text-xs font-medium text-txt-secondary transition-colors hover:text-txt-primary">
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <div className="page-enter mx-auto max-w-[1320px] px-5 py-5 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>

      <nav
        className="fixed bottom-0 left-0 right-0 z-40 grid border-t border-border bg-prism-card md:hidden"
        style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
      >
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `flex flex-col items-center gap-1 py-2 text-[11px] ${isActive ? 'text-cyan' : 'text-txt-secondary'}`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}