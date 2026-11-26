import { useAssistantName } from '../lib/identity.js';
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

function StatCard({ icon, label, value, hint }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
      <p className="flex items-center gap-2 text-xs font-semibold text-white/70">
        <span aria-hidden="true">{icon}</span>
        {label}
      </p>
      <p className="mt-2 break-all text-2xl font-extrabold sm:text-3xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-white/60">{hint}</p>}
    </div>
  );
}

const MODE_OPTIONS = [
  { id: 'normal', label: 'Normal 🌸' },
  { id: 'sleep', label: 'Sleep 🌙' },
  { id: 'home', label: 'At Home 🏡' },
  { id: 'commute', label: 'Commute 🚌' },
  { id: 'shopping', label: 'Market 🛒' },
  { id: 'adda', label: 'Adda ☕' },
  { id: 'movie', label: 'Movie 🎬' },
  { id: 'barber', label: 'Salon 💈' },
  { id: 'errands', label: 'Errands 🏃' },
  { id: 'lowbat', label: 'Low Bat 🪫' },
  { id: 'medical', label: 'Medical 🏥' },
  { id: 'rainy', label: 'Rainy/Jam 🌧️' },
  { id: 'party', label: 'Party 🎉' },
  { id: 'teabreak', label: 'Tea Break 🫖' },
  { id: 'chores', label: 'Chores 🧹' },
  { id: 'oncall', label: 'On Call 📞' },
  { id: 'charging', label: 'Charging 🔌' },
  { id: 'reading', label: 'Reading 📖' },
  { id: 'outdoors', label: 'Outdoors 🏕️' },
  { id: 'thinking', label: 'Thinking 🧠' },
  { id: 'class', label: 'Class 🏫' },
  { id: 'study', label: 'Study 📚' },
  { id: 'exam', label: 'Exam 📝' },
  { id: 'lab', label: 'Lab 🔬' },
  { id: 'meeting', label: 'Meeting 💼' },
  { id: 'coding', label: 'Coding 💻' },
  { id: 'prayer', label: 'Prayer 🕌' },
  { id: 'dining', label: 'Dining 🍽️' },
  { id: 'resting', label: 'Resting 🤒' },
  { id: 'driving', label: 'Driving 🚗' },
  { id: 'workout', label: 'Gym 🏋️' },
  { id: 'gaming', label: 'Gaming 🎮' },
  { id: 'travel', label: 'Travel ✈️' },
  { id: 'dnd', label: 'DND 🛑' }
];

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
  const assistant = useAssistantName();
  const [connection, setConnection] = useState('initializing');
  const [loadingPercent, setLoadingPercent] = useState(0);
  const [info, setInfo] = useState(null);
  const [qr, setQr] = useState(null);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [sessionRecoveryFailed, setSessionRecoveryFailed] = useState(false);
  const [pairingRejectedHint, setPairingRejectedHint] = useState(false);
  const [stats, setStats] = useState({
    messagesReceived: 0,
    repliesSent: 0,
    activeConversations: 0,
    estimatedCostToday: 0,
    costLimitDaily: 0.5,
    costLimitReached: false
  });
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [activeMode, setActiveMode] = useState('normal');
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
      setPairingRejectedHint(Boolean(data.pairingRejectedHint));
      setStats(data.stats);
      if (data.qr) {
        setQr(data.qr);
      }
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
    if (data.activeMode) setActiveMode(data.activeMode);
  };

  const changeMode = async (modeKey) => {
    setActiveMode(modeKey);
    try {
      await api.put('/settings', { activeMode: modeKey });
    } catch {
      // fallback
    }
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
        setPairingRejectedHint(Boolean(details.pairingRejectedHint));
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
      : `Turn this on so ${assistant} can reply while you’re away.`;
  }

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      {stats.costLimitReached && (
        <div className="rounded-2xl border border-yellow-500/40 bg-yellow-400/10 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-200">
          ⚠️ Today's API cost limit (${stats.costLimitDaily.toFixed(2)}) has been reached — auto-replies are paused until
          local midnight. Raise the limit in Settings if you need {assistant} back sooner.
        </div>
      )}

      {/* Hero with the master switch */}
      <section className="hero grid gap-6 p-5 sm:p-8 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div>
          <span className="inline-block rounded-full border border-line bg-card px-3 py-1 text-xs font-semibold text-muted">
            Personal WhatsApp assistant
          </span>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-brand sm:text-4xl lg:text-5xl">
            Replies for you, <span className="text-accent">while you rest</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted sm:text-base">
            {assistant} watches your personal chats and answers politely, based on what you are doing right now.
          </p>
        </div>

        <div className="card p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            {isScheduleMode ? 'Schedule' : 'Master switch'}
          </p>
          <div className="mt-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className={`text-xl font-extrabold ${active ? 'text-accent-strong' : 'text-brand'}`}>
                {active ? `${assistant} is awake 🌸` : `${assistant} is resting 🌙`}
              </p>
              <p className="mt-1 text-xs text-muted">{subtitle}</p>
              {isScheduleMode && <p className="mt-1 text-xs text-muted">Schedule mode is in control right now.</p>}
            </div>
            <button
              onClick={toggleAutoReply}
              disabled={toggling || isScheduleMode}
              aria-pressed={active}
              aria-label="Auto-reply"
              title={isScheduleMode ? 'Switch to manual mode in Settings to control this toggle' : undefined}
              className={`relative h-8 w-16 shrink-0 rounded-full transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${
                active ? 'bg-accent shadow-glow' : 'bg-line'
              }`}
            >
              <span
                className={`absolute left-0 top-1 h-6 w-6 rounded-full bg-white shadow transition-transform duration-300 ${
                  active ? 'translate-x-9' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="mt-4 border-t border-line pt-4">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusInfo.color} animate-pulse`} />
              <p className="text-sm font-semibold text-ink">{statusInfo.text}</p>
            </div>
            {(connection === 'connected' || connection === 'ready') && (
              <p className="mt-1 text-xs text-muted">
                WhatsApp is linked{info?.number ? ` (+${info.number})` : ''}
                {info?.name ? ` as ${info.name}` : ''}.
              </p>
            )}
          </div>
        </div>
      </section>

      {connection === 'qr' && qr && (
        <section className="card flex flex-col items-center gap-3 p-5 text-center">
          <h2 className="section-title">Link your WhatsApp</h2>
          {sessionRecoveryFailed && (
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              Session couldn't be restored — scan the QR below to reconnect.
            </p>
          )}
          {pairingRejectedHint && (
            <p className="max-w-xs text-xs font-medium text-yellow-700 dark:text-yellow-300">
              ⚠️ Last pairing was accepted, then instantly rejected by WhatsApp — likely a web-version/library
              incompatibility, not an account issue. Try updating whatsapp-web.js, or set WA_WEB_VERSION as a stopgap.
            </p>
          )}
          <div className="rounded-2xl border border-line bg-white p-3 shadow-card">
            <img src={qr} alt="Scan this QR code with WhatsApp" className="h-52 w-52 max-w-full" />
          </div>
          <p className="text-xs text-muted">Open WhatsApp → Linked Devices → Link a Device, then scan this code.</p>
          <p className="text-xs text-muted">QR refreshes automatically (~every 60s).</p>
        </section>
      )}

      {/* Today's numbers */}
      <section className="band p-5 sm:p-8">
        <h2 className="text-xl font-extrabold">Today at a glance</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon="💬" label="Messages" value={stats.messagesReceived} />
          <StatCard icon="↩️" label="Replies sent" value={stats.repliesSent} />
          <StatCard icon="👥" label="Active chats" value={stats.activeConversations} />
          <StatCard
            icon="💵"
            label="API cost"
            value={`$${stats.estimatedCostToday.toFixed(4)}`}
            hint={`of $${stats.costLimitDaily.toFixed(2)} daily limit`}
          />
        </div>
      </section>

      {/* Mode selector */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">Personal modes</h2>
          <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-bold text-accent-strong">
            Active: {activeMode.toUpperCase()}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-6 lg:grid-cols-8">
          {MODE_OPTIONS.map((item) => {
            // "Sleep 🌙" -> name and icon, shown stacked.
            const cut = item.label.lastIndexOf(' ');
            const selected = activeMode === item.id;
            return (
              <button
                key={item.id}
                onClick={() => changeMode(item.id)}
                aria-pressed={selected}
                className={`flex min-h-[4.75rem] flex-col items-center justify-center gap-1 rounded-2xl border px-1 py-2 text-center text-xs font-semibold transition ${
                  selected
                    ? 'border-accent bg-accent text-white shadow-glow'
                    : 'border-line bg-card text-ink hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-card'
                }`}
              >
                <span className="text-xl leading-none" aria-hidden="true">
                  {item.label.slice(cut + 1)}
                </span>
                {item.label.slice(0, cut)}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
