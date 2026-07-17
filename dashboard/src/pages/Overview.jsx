import { useEffect, useState } from 'react';
import api from '../lib/api.js';
import getSocket from '../lib/socket.js';

const STATUS_LABEL = {
  initializing: { text: 'Starting up…', color: 'bg-yellow-400' },
  qr: { text: 'Waiting for QR scan', color: 'bg-yellow-400' },
  authenticated: { text: '✅ Authenticated — starting up…', color: 'bg-blue-400' },
  loading: { text: '⏳ Authenticated — loading chats…', color: 'bg-blue-400' },
  ready: { text: 'Connected', color: 'bg-emerald-400' },
  connected: { text: 'Connected', color: 'bg-emerald-400' },
  disconnected: { text: 'Disconnected — reconnecting', color: 'bg-red-400' },
  auth_failure: { text: 'Authentication failed', color: 'bg-red-400' },
  logging_out: { text: 'Logging out…', color: 'bg-yellow-400' },
  needs_qr: { text: 'Preparing a fresh QR to reconnect…', color: 'bg-yellow-400' }
};

// FIX 4: distinct copy for the account-switch window (before the fresh QR is
// ready) and for the loop-guard recovery case (QR is ready, but it took a
// failed auto-recovery to get there).
function getStatusDisplay(status, percent, switchingAccount, sessionRecoveryFailed) {
  if (switchingAccount && status !== 'qr') {
    return { text: '🔄 Switching account — preparing a fresh QR…', color: 'bg-yellow-400' };
  }
  if (status === 'qr' && sessionRecoveryFailed) {
    return { text: "Session couldn't be restored — scan the QR below to reconnect.", color: 'bg-red-400' };
  }
  if (status === 'loading') {
    return {
      text: `⏳ Authenticated — loading chats… ${percent || 0}%`,
      color: 'bg-blue-400'
    };
  }
  return STATUS_LABEL[status] || STATUS_LABEL.initializing;
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-night-400/50 p-5 backdrop-blur-xl">
      <p className="text-xs uppercase tracking-wide text-petal-dim">{label}</p>
      <p className="mt-2 text-3xl font-bold text-petal">{value}</p>
      {hint && <p className="mt-1 text-xs text-petal-dim">{hint}</p>}
    </div>
  );
}

function formatInZone(iso, timezone) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return new Date(iso).toLocaleTimeString();
  }
}

export default function Overview() {
  const [connection, setConnection] = useState('initializing');
  const [loadingPercent, setLoadingPercent] = useState(0);
  const [info, setInfo] = useState(null);
  const [qr, setQr] = useState(null);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [sessionRecoveryFailed, setSessionRecoveryFailed] = useState(false);
  const [stats, setStats] = useState({
    messagesReceived: 0,
    repliesSent: 0,
    activeConversations: 0,
    estimatedCostToday: 0,
    costLimitDaily: 0.5,
    costLimitReached: false
  });
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [scheduleStatus, setScheduleStatus] = useState({ mode: 'manual', active: false });

  const fetchStatus = async () => {
    try {
      const { data } = await api.get('/status');
      setConnection(data.connection);
      if (data.loadingPercent !== undefined) setLoadingPercent(data.loadingPercent);
      if (data.info !== undefined) setInfo(data.info);
      setSwitchingAccount(Boolean(data.switchingAccount));
      setSessionRecoveryFailed(Boolean(data.sessionRecoveryFailed));
      setStats(data.stats);
      if (
        data.connection === 'authenticated' ||
        data.connection === 'loading' ||
        data.connection === 'ready' ||
        data.connection === 'connected' ||
        data.connection === 'logging_out'
      ) {
        setQr(null);
      }
    } catch {
      // ignore, socket will keep us updated
    }
  };

  const fetchSettings = async () => {
    const { data } = await api.get('/settings');
    setAutoReplyEnabled(Boolean(data.autoReplyEnabled));
  };

  const fetchSchedule = async () => {
    const { data } = await api.get('/settings/schedule');
    setScheduleStatus(data.status);
  };

  useEffect(() => {
    fetchStatus();
    fetchSettings();
    fetchSchedule();

    const socket = getSocket();
    const onStatus = (details) => {
      const st = typeof details === 'string' ? details : details?.status || details?.connection || 'initializing';
      setConnection(st);
      if (details && typeof details === 'object') {
        if (details.loadingPercent !== undefined) setLoadingPercent(details.loadingPercent);
        if (details.info !== undefined) setInfo(details.info);
        setSwitchingAccount(Boolean(details.switchingAccount));
        setSessionRecoveryFailed(Boolean(details.sessionRecoveryFailed));
      }
      if (
        st === 'authenticated' ||
        st === 'loading' ||
        st === 'ready' ||
        st === 'connected' ||
        st === 'logging_out'
      ) {
        setQr(null);
      }
    };
    const onQr = ({ qr: qrData }) => setQr(qrData);
    const onSettings = (settings) => setAutoReplyEnabled(Boolean(settings.autoReplyEnabled));
    const onScheduleStatus = (status) => setScheduleStatus(status);
    const onStatsUpdated = () => fetchStatus();

    socket.on('whatsapp:status', onStatus);
    socket.on('whatsapp:qr', onQr);
    socket.on('settings:updated', onSettings);
    socket.on('schedule:status', onScheduleStatus);
    socket.on('stats:updated', onStatsUpdated);
    socket.on('message:new', onStatsUpdated);

    const interval = setInterval(fetchStatus, 15000);

    return () => {
      socket.off('whatsapp:status', onStatus);
      socket.off('whatsapp:qr', onQr);
      socket.off('settings:updated', onSettings);
      socket.off('schedule:status', onScheduleStatus);
      socket.off('stats:updated', onStatsUpdated);
      socket.off('message:new', onStatsUpdated);
      clearInterval(interval);
    };
  }, []);

  const toggleAutoReply = async () => {
    if (scheduleStatus.mode === 'schedule') return;
    setToggling(true);
    try {
      const { data } = await api.put('/settings', { autoReplyEnabled: !autoReplyEnabled });
      setAutoReplyEnabled(Boolean(data.autoReplyEnabled));
    } finally {
      setToggling(false);
    }
  };

  const statusInfo = getStatusDisplay(connection, loadingPercent, switchingAccount, sessionRecoveryFailed);
  const isScheduleMode = scheduleStatus.mode === 'schedule';
  const active = isScheduleMode ? scheduleStatus.active : autoReplyEnabled;
  const nextChangeLabel = isScheduleMode ? formatInZone(scheduleStatus.nextChangeAt, scheduleStatus.timezone) : null;

  let subtitle;
  if (isScheduleMode) {
    subtitle = active
      ? nextChangeLabel
        ? `Scheduled until ${nextChangeLabel}`
        : 'Active on schedule'
      : nextChangeLabel
        ? `Will wake at ${nextChangeLabel}`
        : 'Resting on schedule';
  } else {
    subtitle = active
      ? 'Auto-replies are active for incoming chats.'
      : 'Turn this on so Sheuli can reply while you’re away.';
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-petal">Overview</h1>
        <p className="text-sm text-petal-dim">A quick look at how Sheuli is doing right now.</p>
      </div>

      {stats.costLimitReached && (
        <div className="rounded-2xl border border-yellow-400/30 bg-yellow-400/10 px-4 py-3 text-sm text-yellow-200">
          ⚠️ Today's API cost limit (${stats.costLimitDaily.toFixed(2)}) has been reached — auto-replies are paused until
          local midnight. Raise the limit in Settings if you need Sheuli back sooner.
        </div>
      )}

      {/* FIX 4: impossible-to-miss reminder after a fresh deploy — a new
          database seeds autoReplyEnabled=false by default, so Sheuli won't
          reply to anyone until this is flipped on. */}
      {!isScheduleMode && !autoReplyEnabled && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-sheuli/40 bg-sheuli/10 px-4 py-3 text-sm text-sheuli-light">
          <span>🌙 Sheuli is OFF — turn her on to start replying.</span>
          <button
            onClick={toggleAutoReply}
            disabled={toggling}
            className="shrink-0 rounded-lg bg-sheuli px-3 py-1.5 text-xs font-semibold text-night-900 transition hover:bg-sheuli-light disabled:opacity-50"
          >
            {toggling ? 'Turning on…' : 'Turn on'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Connection status */}
        <div className="rounded-2xl border border-white/10 bg-night-400/50 p-6 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusInfo.color} animate-pulse`} />
            <p className="font-semibold text-petal">{statusInfo.text}</p>
          </div>

          {connection === 'qr' && qr && (
            <div className="mt-4 flex flex-col items-center gap-2">
              {sessionRecoveryFailed && (
                <p className="text-center text-sm font-medium text-red-300">
                  Session couldn't be restored — scan the QR below to reconnect.
                </p>
              )}
              <div className="rounded-xl bg-white p-3 shadow-glow">
                <img src={qr} alt="Scan this QR code with WhatsApp" className="h-48 w-48" />
              </div>
              <p className="text-center text-xs text-petal-dim">
                Open WhatsApp → Linked Devices → Link a Device, then scan this code.
              </p>
              <p className="text-center text-[11px] text-petal-dim/80">
                QR refreshes automatically (~every 60s).
              </p>
            </div>
          )}

          {(connection === 'connected' || connection === 'ready') && (
            <p className="mt-3 text-sm text-petal-dim">
              WhatsApp is linked{info?.number ? ` (+${info.number})` : ''}{info?.name ? ` as ${info.name}` : ''}. Sheuli can now watch your messages.
            </p>
          )}
        </div>

        {/* Master toggle / schedule status */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-night-400/50 p-6 backdrop-blur-xl">
          {active && (
            <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-sheuli/20 blur-3xl animate-float" />
          )}
          <p className="text-xs uppercase tracking-wide text-petal-dim">
            {isScheduleMode ? 'Schedule' : 'Master switch'}
          </p>
          <div className="mt-3 flex items-center justify-between">
            <div>
              <p className={`text-xl font-bold ${active ? 'text-sheuli-light' : 'text-petal'}`}>
                {active ? 'Sheuli is awake 🌸' : 'Sheuli is resting 🌙'}
              </p>
              <p className="mt-1 text-xs text-petal-dim">{subtitle}</p>
              {isScheduleMode && (
                <p className="mt-1 text-xs text-petal-dim/70">Schedule mode is controlling Sheuli right now.</p>
              )}
            </div>
            <button
              onClick={toggleAutoReply}
              disabled={toggling || isScheduleMode}
              aria-pressed={active}
              title={isScheduleMode ? 'Switch to manual mode in Settings to control this toggle' : undefined}
              className={`relative h-8 w-16 shrink-0 rounded-full transition-colors duration-300 ${
                active ? 'bg-sheuli shadow-glow' : 'bg-white/10'
              } ${isScheduleMode ? 'cursor-not-allowed opacity-50' : ''} disabled:opacity-50`}
            >
              <span
                className={`absolute top-1 h-6 w-6 rounded-full bg-petal shadow transition-transform duration-300 ${
                  active ? 'translate-x-9' : 'translate-x-1'
                } ${active ? 'animate-bloom' : ''}`}
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
        <StatCard
          label="Est. API cost"
          value={`$${stats.estimatedCostToday.toFixed(4)}`}
          hint={`of $${stats.costLimitDaily.toFixed(2)} daily limit`}
        />
      </div>
    </div>
  );
}
