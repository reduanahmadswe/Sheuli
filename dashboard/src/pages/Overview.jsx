import { useEffect, useState } from 'react';
import api from '../lib/api.js';
import getSocket from '../lib/socket.js';

const STATUS_LABEL = {
  initializing: { text: 'Starting up…', color: 'bg-yellow-400' },
  qr: { text: 'Waiting for QR scan', color: 'bg-yellow-400' },
  connected: { text: 'Connected', color: 'bg-emerald-400' },
  disconnected: { text: 'Disconnected — reconnecting', color: 'bg-red-400' },
  auth_failure: { text: 'Authentication failed', color: 'bg-red-400' }
};

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-night-400/50 p-5 backdrop-blur-xl">
      <p className="text-xs uppercase tracking-wide text-petal-dim">{label}</p>
      <p className="mt-2 text-3xl font-bold text-petal">{value}</p>
      {hint && <p className="mt-1 text-xs text-petal-dim">{hint}</p>}
    </div>
  );
}

export default function Overview() {
  const [connection, setConnection] = useState('initializing');
  const [qr, setQr] = useState(null);
  const [stats, setStats] = useState({
    messagesReceived: 0,
    repliesSent: 0,
    activeConversations: 0,
    estimatedCostToday: 0
  });
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [toggling, setToggling] = useState(false);

  const fetchStatus = async () => {
    try {
      const { data } = await api.get('/status');
      setConnection(data.connection);
      setStats(data.stats);
      if (data.connection === 'connected') setQr(null);
    } catch {
      // ignore, socket will keep us updated
    }
  };

  const fetchSettings = async () => {
    const { data } = await api.get('/settings');
    setAutoReplyEnabled(Boolean(data.autoReplyEnabled));
  };

  useEffect(() => {
    fetchStatus();
    fetchSettings();

    const socket = getSocket();
    const onStatus = ({ status }) => {
      setConnection(status);
      if (status === 'connected') setQr(null);
    };
    const onQr = ({ qr: qrData }) => setQr(qrData);
    const onSettings = (settings) => setAutoReplyEnabled(Boolean(settings.autoReplyEnabled));
    const onStatsUpdated = () => fetchStatus();

    socket.on('whatsapp:status', onStatus);
    socket.on('whatsapp:qr', onQr);
    socket.on('settings:updated', onSettings);
    socket.on('stats:updated', onStatsUpdated);
    socket.on('message:new', onStatsUpdated);

    const interval = setInterval(fetchStatus, 15000);

    return () => {
      socket.off('whatsapp:status', onStatus);
      socket.off('whatsapp:qr', onQr);
      socket.off('settings:updated', onSettings);
      socket.off('stats:updated', onStatsUpdated);
      socket.off('message:new', onStatsUpdated);
      clearInterval(interval);
    };
  }, []);

  const toggleAutoReply = async () => {
    setToggling(true);
    try {
      const { data } = await api.put('/settings', { autoReplyEnabled: !autoReplyEnabled });
      setAutoReplyEnabled(Boolean(data.autoReplyEnabled));
    } finally {
      setToggling(false);
    }
  };

  const statusInfo = STATUS_LABEL[connection] || STATUS_LABEL.initializing;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-petal">Overview</h1>
        <p className="text-sm text-petal-dim">A quick look at how Sheuli is doing right now.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Connection status */}
        <div className="rounded-2xl border border-white/10 bg-night-400/50 p-6 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusInfo.color} animate-pulse`} />
            <p className="font-semibold text-petal">{statusInfo.text}</p>
          </div>

          {connection === 'qr' && qr && (
            <div className="mt-4 flex flex-col items-center gap-2">
              <div className="rounded-xl bg-white p-3 shadow-glow">
                <img src={qr} alt="Scan this QR code with WhatsApp" className="h-48 w-48" />
              </div>
              <p className="text-center text-xs text-petal-dim">
                Open WhatsApp → Linked Devices → Link a Device, then scan this code.
              </p>
            </div>
          )}

          {connection === 'connected' && (
            <p className="mt-3 text-sm text-petal-dim">
              WhatsApp is linked. Sheuli can now watch your messages.
            </p>
          )}
        </div>

        {/* Master toggle */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-night-400/50 p-6 backdrop-blur-xl">
          {autoReplyEnabled && (
            <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-sheuli/20 blur-3xl animate-float" />
          )}
          <p className="text-xs uppercase tracking-wide text-petal-dim">Master switch</p>
          <div className="mt-3 flex items-center justify-between">
            <div>
              <p className={`text-xl font-bold ${autoReplyEnabled ? 'text-sheuli-light' : 'text-petal'}`}>
                {autoReplyEnabled ? 'Sheuli is awake 🌸' : 'Sheuli is resting 🌙'}
              </p>
              <p className="mt-1 text-xs text-petal-dim">
                {autoReplyEnabled
                  ? 'Auto-replies are active for incoming chats.'
                  : 'Turn this on so Sheuli can reply while you’re away.'}
              </p>
            </div>
            <button
              onClick={toggleAutoReply}
              disabled={toggling}
              aria-pressed={autoReplyEnabled}
              className={`relative h-8 w-16 shrink-0 rounded-full transition-colors duration-300 ${
                autoReplyEnabled ? 'bg-sheuli shadow-glow' : 'bg-white/10'
              } disabled:opacity-60`}
            >
              <span
                className={`absolute top-1 h-6 w-6 rounded-full bg-petal shadow transition-transform duration-300 ${
                  autoReplyEnabled ? 'translate-x-9' : 'translate-x-1'
                } ${autoReplyEnabled ? 'animate-bloom' : ''}`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Live stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Messages today" value={stats.messagesReceived} />
        <StatCard label="Replies sent" value={stats.repliesSent} />
        <StatCard label="Active chats" value={stats.activeConversations} />
        <StatCard label="Est. API cost" value={`$${stats.estimatedCostToday.toFixed(4)}`} hint="gpt-4o-mini" />
      </div>
    </div>
  );
}
