import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Logo from './Logo.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import useAuth from '../hooks/useAuth.js';
import getSocket from '../lib/socket.js';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', short: 'Home', icon: '🌸', end: true },
  { to: '/messages', label: 'Live Messages', short: 'Chats', icon: '💬' },
  { to: '/contacts', label: 'Contacts', short: 'Contacts', icon: '👥' },
  { to: '/settings', label: 'Settings', short: 'Settings', icon: '⚙️' },
  { to: '/logs', label: 'Logs', short: 'Logs', icon: '📜' }
];

// FIX 5: small live indicator for the dashboard's own WebSocket connection —
// green when the socket.io connection to the server is up, red when it's
// down/reconnecting, independent of whether WhatsApp itself is connected.
function SocketStatusDot() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    setConnected(socket.connected);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-emerald-500' : 'animate-pulse bg-red-500'}`}
      title={connected ? 'Live connection active' : 'Live connection lost — reconnecting…'}
    />
  );
}

export default function Layout({ children }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-card/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Logo size={36} />
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-lg font-extrabold leading-none tracking-tight text-brand">Sheuli</p>
                <SocketStatusDot />
              </div>
              <p className="mt-1 hidden text-[11px] leading-none text-muted sm:block">She blooms while you sleep.</p>
            </div>
          </div>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold transition lg:px-4 ${
                    isActive ? 'bg-accent/10 text-accent-strong' : 'text-muted hover:bg-soft hover:text-ink'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="h-10 rounded-full bg-accent px-4 text-sm font-bold text-white shadow-glow-sm transition hover:bg-accent-hover"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      {/* Bottom padding keeps content clear of the phone tab bar. */}
      <main className="flex-1 px-4 pb-28 pt-5 sm:px-6 md:pb-12 md:pt-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 py-2 text-[11px] font-semibold ${
                isActive ? 'text-accent-strong' : 'text-muted'
              }`
            }
          >
            <span className="text-xl leading-none" aria-hidden="true">
              {item.icon}
            </span>
            {item.short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
