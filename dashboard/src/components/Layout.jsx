import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Logo from './Logo.jsx';
import useAuth from '../hooks/useAuth.js';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: '🌸', end: true },
  { to: '/messages', label: 'Live Messages', icon: '💬' },
  { to: '/contacts', label: 'Contacts', icon: '👥' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
  { to: '/logs', label: 'Logs', icon: '📜' }
];

export default function Layout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navLinkClass = ({ isActive }) =>
    `flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
      isActive
        ? 'bg-sheuli/15 text-sheuli-light shadow-glow-sm'
        : 'text-petal-dim hover:bg-white/5 hover:text-petal'
    }`;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-white/5 bg-night-400/60 px-4 py-6 backdrop-blur-xl lg:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <Logo size={38} />
          <div>
            <p className="text-base font-bold tracking-tight text-petal">Sheuli</p>
            <p className="text-[11px] text-petal-dim">She blooms while you sleep.</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
              <span className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={handleLogout}
          className="mt-4 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-petal-dim transition-colors hover:border-sheuli/40 hover:text-sheuli-light"
        >
          Log out
        </button>
      </aside>

      {/* Mobile top bar */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/5 bg-night-400/60 px-4 py-3 backdrop-blur-xl lg:hidden">
          <div className="flex items-center gap-2">
            <Logo size={30} />
            <span className="font-bold text-petal">Sheuli</span>
          </div>
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-petal-dim"
          >
            {mobileOpen ? '✕' : '☰'}
          </button>
        </header>

        {mobileOpen && (
          <nav className="flex flex-col gap-1 border-b border-white/5 bg-night-400/95 px-4 py-3 lg:hidden">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={navLinkClass}
                onClick={() => setMobileOpen(false)}
              >
                <span className="text-lg leading-none">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
            <button
              onClick={handleLogout}
              className="mt-2 rounded-xl border border-white/10 px-4 py-2.5 text-left text-sm font-medium text-petal-dim hover:border-sheuli/40 hover:text-sheuli-light"
            >
              Log out
            </button>
          </nav>
        )}

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
