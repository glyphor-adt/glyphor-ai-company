import { NavLink, Outlet } from 'react-router-dom';
import { useTheme } from '../lib/theme';

const NAV = [
  { to: '/', label: 'Dashboard', icon: GridIcon },
  { to: '/workforce', label: 'Workforce', icon: UsersIcon },
  { to: '/approvals', label: 'Approvals', icon: CheckIcon },
  { to: '/chat', label: 'Chat', icon: ChatIcon },
] as const;

export default function Layout() {
  const { theme, toggle } = useTheme();
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
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan/20 text-[11px] font-bold text-cyan">
              KD
            </div>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium text-txt-secondary">Kristina</p>
              <p className="truncate text-[11px] text-txt-muted">CEO</p>
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
