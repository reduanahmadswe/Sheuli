import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api.js';
import getSocket from '../lib/socket.js';

const MODEL_OPTIONS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      aria-pressed={checked}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-sheuli' : 'bg-white/10'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-petal transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function Section({ title, description, children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-night-400/50 p-6 backdrop-blur-xl">
      <h2 className="font-semibold text-petal">{title}</h2>
      {description && <p className="mt-1 text-xs text-petal-dim">{description}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function formatTime12h(hhmm) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return hhmm || '';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatDiagnosticTime(iso) {
  if (!iso) return 'never';
  try {
    return new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

function DiagRow({ label, value, tone }) {
  const toneClass = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-petal';
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-2 text-sm last:border-none">
      <span className="text-petal-dim">{label}</span>
      <span className={`text-right font-medium ${toneClass}`}>{value}</span>
    </div>
  );
}

function describeDays(days) {
  if (!Array.isArray(days) || days.length === 0 || days.length === 7) return 'every day';
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const weekend = ['Sat', 'Sun'];
  const sorted = [...days].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
  if (sorted.length === 5 && weekdays.every((d) => sorted.includes(d))) return 'on weekdays';
  if (sorted.length === 2 && weekend.every((d) => sorted.includes(d))) return 'on weekends';
  return `on ${sorted.join(', ')}`;
}

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const [schedule, setSchedule] = useState(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleSavedAt, setScheduleSavedAt] = useState(null);
  const [scheduleError, setScheduleError] = useState('');

  const [rateLimitDraft, setRateLimitDraft] = useState('10');
  const [rateLimitError, setRateLimitError] = useState('');

  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(true);

  const [waStatus, setWaStatus] = useState('initializing');
  const [loadingPercent, setLoadingPercent] = useState(0);
  const [waInfo, setWaInfo] = useState(null);
  const [waQr, setWaQr] = useState(null);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [sessionRecoveryFailed, setSessionRecoveryFailed] = useState(false);
  const [pairingRejectedHint, setPairingRejectedHint] = useState(false);

  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [clearHistoryCheckbox, setClearHistoryCheckbox] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');

  // ── Routine Management State ──
  const [routineModalOpen, setRoutineModalOpen] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState(null);
  const [routineGroupFilter, setRoutineGroupFilter] = useState('All');
  const [routineDayFilter, setRoutineDayFilter] = useState('All');
  const [slotForm, setSlotForm] = useState({
    day: 'Sat',
    startTime: '10:00',
    endTime: '11:30',
    subject: '',
    code: '',
    room: '',
    group: 'All',
    validUntil: '2026-12-20'
  });

  function parseSchedule(val) {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  const isSlotCurrentlyActive = (slot) => {
    if (!slot?.day || !slot?.startTime || !slot?.endTime) return false;
    const now = new Date();
    const dayStr = now.toLocaleDateString('en-US', { weekday: 'short' });
    if (slot.day.slice(0, 3).toLowerCase() !== dayStr.slice(0, 3).toLowerCase()) return false;

    if (slot.validUntil) {
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const todayIso = `${y}-${m}-${d}`;
      if (todayIso > slot.validUntil) return false;
    }

    const curMin = now.getHours() * 60 + now.getMinutes();
    const [sH, sM] = slot.startTime.split(':').map(Number);
    const [eH, eM] = slot.endTime.split(':').map(Number);
    return curMin >= sH * 60 + sM && curMin <= eH * 60 + eM;
  };

  const handleOpenAddSlot = (day = 'Sat') => {
    setEditingSlotId(null);
    setSlotForm({
      day,
      startTime: '10:00',
      endTime: '11:30',
      subject: '',
      code: '',
      room: '',
      group: 'All',
      validUntil: '2026-12-20'
    });
    setRoutineModalOpen(true);
  };

  const handleOpenEditSlot = (slot) => {
    setEditingSlotId(slot.id || `${slot.day}-${slot.startTime}-${slot.subject}`);
    setSlotForm({
      day: slot.day || 'Sat',
      startTime: slot.startTime || '10:00',
      endTime: slot.endTime || '11:30',
      subject: slot.subject || '',
      code: slot.code || '',
      room: slot.room || '',
      group: slot.group || 'All',
      validUntil: slot.validUntil || '2026-12-20'
    });
    setRoutineModalOpen(true);
  };

  const handleSaveSlot = () => {
    if (!slotForm.subject.trim() || !slotForm.startTime || !slotForm.endTime) return;
    const schedule = [...parseSchedule(settings.classSchedule)];

    if (editingSlotId) {
      const idx = schedule.findIndex((s) => (s.id || `${s.day}-${s.startTime}-${s.subject}`) === editingSlotId);
      if (idx >= 0) {
        schedule[idx] = { ...slotForm, id: editingSlotId };
      } else {
        schedule.push({ ...slotForm, id: editingSlotId });
      }
    } else {
      const newId = `slot-${Date.now()}`;
      schedule.push({ ...slotForm, id: newId });
    }

    const DAY_ORDER = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    schedule.sort((a, b) => {
      const dA = DAY_ORDER.indexOf(a.day.slice(0, 3));
      const dB = DAY_ORDER.indexOf(b.day.slice(0, 3));
      if (dA !== dB) return dA - dB;
      return a.startTime.localeCompare(b.startTime);
    });

    save({ classSchedule: JSON.stringify(schedule) });
    setRoutineModalOpen(false);
  };

  const handleDeleteSlot = (targetId) => {
    const schedule = parseSchedule(settings.classSchedule);
    const filtered = schedule.filter((s) => {
      const id = s.id || `${s.day}-${s.startTime}-${s.subject}`;
      return id !== targetId;
    });
    save({ classSchedule: JSON.stringify(filtered) });
  };

  const navigate = useNavigate();

  const loadDiagnostics = async () => {
    try {
      const { data } = await api.get('/diagnostics');
      setDiagnostics(data);
      if (data.whatsapp) {
        setWaStatus(data.whatsapp.state);
        if (data.whatsapp.loadingPercent !== undefined) setLoadingPercent(data.whatsapp.loadingPercent);
        if (data.whatsapp.number || data.whatsapp.name) {
          setWaInfo({ number: data.whatsapp.number, name: data.whatsapp.name });
        }
        setSwitchingAccount(Boolean(data.whatsapp.switchingAccount));
        setSessionRecoveryFailed(Boolean(data.whatsapp.sessionRecoveryFailed));
        setPairingRejectedHint(Boolean(data.whatsapp.pairingRejectedHint));
      }
    } catch {
      // Leave the last-known values displayed rather than clearing them.
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  useEffect(() => {
    api.get('/settings').then(({ data }) => setSettings(data));
    api.get('/settings/schedule').then(({ data }) => setSchedule(data));
    api.get('/status').then(({ data }) => {
      setWaStatus(data.connection);
      if (data.loadingPercent !== undefined) setLoadingPercent(data.loadingPercent);
      setWaInfo(data.info);
      setSwitchingAccount(Boolean(data.switchingAccount));
      setSessionRecoveryFailed(Boolean(data.sessionRecoveryFailed));
      setPairingRejectedHint(Boolean(data.pairingRejectedHint));
      if (
        data.connection === 'authenticated' ||
        data.connection === 'loading' ||
        data.connection === 'ready' ||
        data.connection === 'connected' ||
        data.connection === 'logging_out'
      ) {
        setWaQr(null);
      }
    });
    loadDiagnostics();
    const interval = setInterval(loadDiagnostics, 10000);

    const socket = getSocket();
    const onWaStatus = (details) => {
      const st = typeof details === 'string' ? details : details?.status || details?.connection || 'initializing';
      setWaStatus(st);
      if (details && typeof details === 'object') {
        if (details.loadingPercent !== undefined) setLoadingPercent(details.loadingPercent);
        if (details.info !== undefined) setWaInfo(details.info);
        // FIX 2.4/4: trust the server's `switchingAccount` flag directly
        // instead of re-deriving it from the status string here — the
        // server now keeps it true until the fresh client actually reaches
        // 'qr', and guessing it as false on 'qr' locally was reintroducing
        // the same premature-clear race client-side.
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
        setWaQr(null);
      }
    };
    const onWaQr = ({ qr }) => setWaQr(qr);

    socket.on('whatsapp:status', onWaStatus);
    socket.on('whatsapp:qr', onWaQr);

    return () => {
      clearInterval(interval);
      socket.off('whatsapp:status', onWaStatus);
      socket.off('whatsapp:qr', onWaQr);
    };
  }, []);

  const handleConfirmLogout = async () => {
    setLoggingOut(true);
    setLogoutError('');
    try {
      await api.post('/whatsapp/logout', { clearHistory: clearHistoryCheckbox });
      setShowLogoutModal(false);
      setClearHistoryCheckbox(false);
      navigate('/');
    } catch (err) {
      setLogoutError(err.response?.data?.error || 'Failed to log out WhatsApp account.');
    } finally {
      setLoggingOut(false);
    }
  };

  // Keeps the number input in sync with the saved value, but only while rate
  // limiting is on — while off (0), the input keeps whatever the owner last
  // typed so toggling back on restores it instead of jumping to 0.
  useEffect(() => {
    if (settings?.rateLimitPerHour > 0) {
      setRateLimitDraft(String(settings.rateLimitPerHour));
    }
  }, [settings?.rateLimitPerHour]);

  const patch = (updates) => setSettings((prev) => ({ ...prev, ...updates }));

  const save = async (overrides = {}) => {
    setSaving(true);
    try {
      const payload = { ...settings, ...overrides };
      const { data } = await api.put('/settings', payload);
      setSettings(data);
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  };

  const patchSchedule = (updates) => {
    setScheduleError('');
    setSchedule((prev) => ({ ...prev, ...updates }));
  };

  const saveSchedule = async (overrides = {}) => {
    const next = { ...schedule, ...overrides };
    if (next.scheduleStart === next.scheduleEnd) {
      setScheduleError('Start and end time cannot be identical.');
      return;
    }
    setScheduleError('');
    setScheduleSaving(true);
    try {
      const { data } = await api.put('/settings/schedule', {
        mode: next.mode,
        scheduleStart: next.scheduleStart,
        scheduleEnd: next.scheduleEnd,
        scheduleDays: next.scheduleDays
      });
      setSchedule(data);
      setScheduleSavedAt(new Date());
    } catch (err) {
      setScheduleError(err.response?.data?.error || 'Could not save schedule.');
    } finally {
      setScheduleSaving(false);
    }
  };

  const toggleRateLimit = () => {
    if (settings.rateLimitPerHour > 0) {
      save({ rateLimitPerHour: 0 });
      return;
    }
    const restored = Number(rateLimitDraft);
    save({ rateLimitPerHour: Number.isInteger(restored) && restored >= 1 && restored <= 100 ? restored : 10 });
  };

  const saveRateLimit = () => {
    const value = Number(rateLimitDraft);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      setRateLimitError('Enter a whole number between 1 and 100.');
      return;
    }
    setRateLimitError('');
    save({ rateLimitPerHour: value });
  };

  const toggleDay = (day) => {
    const current = schedule.scheduleDays || [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    patchSchedule({ scheduleDays: next });
    saveSchedule({ scheduleDays: next });
  };

  if (!settings || !schedule) {
    return <p className="text-petal-dim">Loading settings…</p>;
  }

  const isOvernight = schedule.scheduleStart > schedule.scheduleEnd;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-petal">Settings</h1>
        <p className="text-sm text-petal-dim">Tune how Sheuli thinks, talks, and behaves.</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-night-400/30 px-4 py-3 text-xs text-petal-dim">
        🔒 Sheuli only replies to personal chats. Groups, communities, channels and broadcasts are always ignored.
      </div>

      <Section
        title="WhatsApp Account"
        description="Manage the WhatsApp account currently linked to Sheuli."
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${getStatusDisplay(waStatus, loadingPercent, switchingAccount, sessionRecoveryFailed).color} animate-pulse`} />
              <span className="font-semibold text-petal">{getStatusDisplay(waStatus, loadingPercent, switchingAccount, sessionRecoveryFailed).text}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-petal-dim">
              <p>
                Number: <span className="font-mono font-medium text-petal">{waInfo?.number ? `+${waInfo.number}` : 'Not linked'}</span>
              </p>
              <p>
                Name: <span className="font-medium text-petal">{waInfo?.name || '—'}</span>
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setLogoutError('');
              setShowLogoutModal(true);
            }}
            disabled={waStatus === 'logging_out' || switchingAccount || loggingOut || saving}
            className="w-fit rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 shadow-glow-sm transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Logout WhatsApp
          </button>
        </div>

        {waStatus === 'qr' && waQr && (
          <div className="mt-5 flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-night-500/60 p-4">
            {sessionRecoveryFailed ? (
              <p className="text-sm font-medium text-red-300">
                Session couldn't be restored — scan the QR below to reconnect.
              </p>
            ) : (
              <p className="text-sm font-medium text-petal">Scan to link a new WhatsApp account:</p>
            )}
            {pairingRejectedHint && (
              <p className="max-w-xs text-center text-xs font-medium text-yellow-300">
                ⚠️ Last pairing was accepted, then instantly rejected by WhatsApp — likely a web-version/library
                incompatibility, not an account issue. Try updating whatsapp-web.js, or set WA_WEB_VERSION as a
                stopgap.
              </p>
            )}
            <div className="rounded-xl bg-white p-3 shadow-glow">
              <img src={waQr} alt="Scan this QR code with WhatsApp" className="h-48 w-48" />
            </div>
            <p className="text-center text-xs text-petal-dim">
              Open WhatsApp → Linked Devices → Link a Device, then scan this code.
            </p>
            <p className="text-center text-[11px] text-petal-dim/80">
              QR refreshes automatically (~every 60s).
            </p>
          </div>
        )}
      </Section>

      <Section
        title="🩺 Diagnostics"
        description="Live values, refreshed every 10s — check this first if something seems off."
      >
        {diagnosticsLoading && !diagnostics ? (
          <p className="text-sm text-petal-dim">Loading…</p>
        ) : diagnostics ? (
          <div className="flex flex-col gap-1">
            <DiagRow
              label="WhatsApp"
              value={diagnostics.whatsapp.state}
              tone={diagnostics.whatsapp.state === 'connected' ? 'good' : 'bad'}
            />
            <DiagRow label="My number" value={diagnostics.whatsapp.number || '—'} />
            <DiagRow
              label="Auto-reply"
              value={diagnostics.autoReply.reason}
              tone={diagnostics.autoReply.active ? 'good' : 'bad'}
            />
            <DiagRow label="Messages in DB" value={diagnostics.database.messageCount} />
            <DiagRow label="DB path" value={diagnostics.database.path} />
            <DiagRow
              label="Today's cost"
              value={`$${diagnostics.cost.todayEstimated.toFixed(4)} / $${diagnostics.cost.dailyLimit.toFixed(2)}`}
            />
            <DiagRow
              label="OPENAI_API_KEY"
              value={diagnostics.env.openaiApiKeyPresent ? 'present' : 'MISSING'}
              tone={diagnostics.env.openaiApiKeyPresent ? 'good' : 'bad'}
            />
            <DiagRow label="Last incoming message" value={formatDiagnosticTime(diagnostics.lastIncomingAt)} />
            <DiagRow label="Last reply sent" value={formatDiagnosticTime(diagnostics.lastReplyAt)} />
            <DiagRow label="Server uptime" value={`${Math.floor(diagnostics.uptimeSeconds / 60)} min`} />
          </div>
        ) : (
          <p className="text-sm text-red-400">Could not load diagnostics.</p>
        )}
      </Section>

      <Section title="Sheuli's personality" description="This is the core identity & language rules prompt sent to the AI on every reply.">
        <div className="mb-3 rounded-xl border border-sheuli/30 bg-sheuli/10 px-3.5 py-2.5 text-xs text-sheuli-light">
          💡 <strong>Dynamic Mode Notice:</strong> Active Modes (Sleep 🌙, Class 🏫, Study 📚, Exam 📝, Driving 🚗) automatically inject live status instructions into every reply dynamically. You don't need to hardcode "sleeping" or "in class" here!
        </div>
        <textarea
          value={settings.systemPrompt}
          onChange={(e) => patch({ systemPrompt: e.target.value })}
          rows={8}
          className="font-bengali w-full rounded-xl border border-white/10 bg-night-500/80 px-4 py-3 text-sm text-petal outline-none ring-sheuli/50 focus:ring-2"
        />
        <button
          onClick={() => save({ systemPrompt: settings.systemPrompt })}
          disabled={saving}
          className="mt-3 rounded-xl bg-sheuli px-4 py-2 text-sm font-semibold text-night-900 shadow-glow-sm transition hover:bg-sheuli-light disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save prompt'}
        </button>
      </Section>

      <Section
        title="🎙️ Voice Note & Voice Reply Settings"
        description="Configure how Sheuli handles incoming WhatsApp voice notes and voice responses."
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-petal">Voice Auto-Reply Mode</p>
              <p className="text-xs text-petal-dim">
                When enabled, Sheuli will reply using synthesized voice notes (TTS) for voice messages!
              </p>
            </div>
            <select
              value={settings.voiceReplyMode || 'auto'}
              onChange={(e) => save({ voiceReplyMode: e.target.value })}
              className="rounded-xl border border-white/10 bg-night-500 px-3 py-1.5 text-sm text-sheuli-light font-semibold"
            >
              <option value="auto">Smart Auto ⚡ (Voice for Voice 🎙️, Text for Text 💬)</option>
              <option value="voice">Always Voice Note 🎙️ (TTS Voice for All)</option>
              <option value="text">Always Text Reply 💬 (Text Only)</option>
            </select>
          </div>

          <div className="flex items-center justify-between border-t border-white/5 pt-3">
            <div>
              <p className="text-sm font-medium text-petal">AI Voice Actor (Tone)</p>
              <p className="text-xs text-petal-dim">
                Select the voice actor used when Sheuli generates audio responses.
              </p>
            </div>
            <select
              value={settings.ttsVoice || 'nova'}
              onChange={(e) => save({ ttsVoice: e.target.value })}
              className="rounded-xl border border-white/10 bg-night-500 px-3 py-1.5 text-sm text-sheuli-light font-semibold"
            >
              <option value="nova">Nova 🌸 (Sweet & Warm Female - Recommended)</option>
              <option value="shimmer">Shimmer ✨ (Clear Female)</option>
              <option value="alloy">Alloy 🎙️ (Neutral Assistant)</option>
              <option value="echo">Echo 🎧 (Calm Male)</option>
              <option value="fable">Fable 📖 (Expressive)</option>
              <option value="onyx">Onyx 🔊 (Deep Male)</option>
            </select>
          </div>
        </div>
      </Section>

      <Section
        title="🏫 University Routine & Realtime Schedule"
        description="Sheuli prioritizes your realtime routine above all else. When you are in class or lab, she will automatically inform callers/senders what class you are in and when you will be free."
      >
        <div className="flex flex-col gap-4">
          {/* Routine Header Info & Group Filter */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-sheuli/10 px-2.5 py-1 text-xs font-semibold text-sheuli-light border border-sheuli/20">
                DS-G (Batch 41)
              </span>
              <span className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-petal-dim border border-white/10">
                📅 Valid until Dec 20, 2026
              </span>
            </div>

            {/* Group Filters */}
            <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-night-500/80 p-1 text-xs">
              <span className="px-2 text-petal-dim font-medium text-[11px]">Filter:</span>
              {[
                { id: 'All', label: 'All Classes' },
                { id: 'G1', label: 'Lab G1 Only' },
                { id: 'Theory', label: 'Section G Theory' }
              ].map((grp) => (
                <button
                  key={grp.id}
                  type="button"
                  onClick={() => setRoutineGroupFilter(grp.id)}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                    routineGroupFilter === grp.id
                      ? 'bg-sheuli text-white shadow-glow-sm'
                      : 'text-petal-dim hover:text-petal hover:bg-white/5'
                  }`}
                >
                  {grp.label}
                </button>
              ))}
            </div>
          </div>

          {/* Day Filters */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {['All', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setRoutineDayFilter(d)}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  routineDayFilter === d
                    ? 'bg-white/15 text-white border border-white/20'
                    : 'border border-white/5 bg-night-500/40 text-petal-dim hover:bg-white/5 hover:text-petal'
                }`}
              >
                {d === 'All' ? 'All Days' : d}
              </button>
            ))}
          </div>

          {/* Routine Slot Cards */}
          <div className="space-y-2.5">
            {(() => {
              let schedule = parseSchedule(settings.classSchedule);

              // Filter by group
              if (routineGroupFilter === 'G1') {
                schedule = schedule.filter((s) => s.group === 'G1');
              } else if (routineGroupFilter === 'Theory') {
                schedule = schedule.filter((s) => !s.group || s.group === 'All' || s.group === 'Theory');
              }

              // Filter by day
              if (routineDayFilter !== 'All') {
                schedule = schedule.filter((s) => s.day?.toLowerCase().startsWith(routineDayFilter.toLowerCase()));
              }

              if (!schedule || schedule.length === 0) {
                return (
                  <div className="rounded-xl border border-dashed border-white/15 p-6 text-center text-xs text-petal-dim">
                    No routine slots found for this filter.
                  </div>
                );
              }

              return schedule.map((slot, idx) => {
                const isActive = isSlotCurrentlyActive(slot);
                const slotId = slot.id || `${slot.day}-${slot.startTime}-${slot.subject}`;

                return (
                  <div
                    key={slotId || idx}
                    className={`group flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3.5 transition ${
                      isActive
                        ? 'border-emerald-500/60 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                        : 'border-white/10 bg-night-500/60 hover:border-white/20 hover:bg-night-500/90'
                    }`}
                  >
                    <div className="flex items-start sm:items-center gap-3">
                      {/* Day & Time Badge */}
                      <div className="flex flex-col items-center justify-center rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-center min-w-[75px]">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-sheuli-light">
                          {slot.day}
                        </span>
                        <span className="text-xs font-mono font-semibold text-petal">
                          {slot.startTime}–{slot.endTime}
                        </span>
                      </div>

                      {/* Course details */}
                      <div className="flex flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-petal">
                            {slot.subject}
                          </span>
                          {slot.group && slot.group !== 'All' && (
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              slot.group === 'G1'
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            }`}>
                              {slot.group}
                            </span>
                          )}
                          {isActive && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30 animate-pulse">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                              Ongoing Right Now
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-petal-dim">
                          {slot.code && <span>{slot.code}</span>}
                          {slot.room && (
                            <span className="flex items-center gap-1 text-sheuli-light/90">
                              📍 {slot.room}
                            </span>
                          )}
                          {slot.validUntil && (
                            <span className="text-white/30 text-[10px]">
                              until {slot.validUntil}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenEditSlot(slot)}
                        className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-petal hover:bg-white/10 transition"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSlot(slotId)}
                        className="rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-500/20 transition"
                        title="Delete slot"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              });
            })()}
          </div>

          {/* Add Slot Button */}
          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleOpenAddSlot('Sat')}
              className="rounded-xl border border-sheuli/40 bg-sheuli/10 px-4 py-2 text-xs font-semibold text-sheuli-light hover:bg-sheuli/20 transition flex items-center gap-1.5 shadow-glow-sm"
            >
              + Add Routine Slot
            </button>
          </div>
        </div>
      </Section>

      <Section
        title="Schedule"
        description="Choose whether Sheuli is controlled by the manual switch, or only wakes up during a set window."
      >
        <div className="flex flex-col gap-5">
          <div className="inline-flex w-fit rounded-xl border border-white/10 bg-night-500/60 p-1">
            {['manual', 'schedule'].map((m) => (
              <button
                key={m}
                onClick={() => saveSchedule({ mode: m })}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                  schedule.mode === m ? 'bg-sheuli text-night-900' : 'text-petal-dim hover:text-petal'
                }`}
              >
                {m === 'manual' ? 'Manual' : 'Scheduled'}
              </button>
            ))}
          </div>

          {schedule.mode === 'schedule' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 text-sm text-petal-dim">
                  Start
                  <input
                    type="time"
                    value={schedule.scheduleStart}
                    onChange={(e) => patchSchedule({ scheduleStart: e.target.value })}
                    onBlur={() => saveSchedule()}
                    className="rounded-lg border border-white/10 bg-night-500/80 px-3 py-1.5 text-petal outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-petal-dim">
                  End
                  <input
                    type="time"
                    value={schedule.scheduleEnd}
                    onChange={(e) => patchSchedule({ scheduleEnd: e.target.value })}
                    onBlur={() => saveSchedule()}
                    className="rounded-lg border border-white/10 bg-night-500/80 px-3 py-1.5 text-petal outline-none"
                  />
                </label>
                <div className="text-sm text-petal-dim">
                  Timezone: <span className="text-petal">{schedule.timezone}</span>{' '}
                  <span className="text-petal-dim/70">(from server config)</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => {
                  const active = (schedule.scheduleDays || []).includes(day);
                  return (
                    <button
                      key={day}
                      onClick={() => toggleDay(day)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        active
                          ? 'border-sheuli/40 bg-sheuli/15 text-sheuli-light'
                          : 'border-white/10 text-petal-dim hover:text-petal'
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>

              <p className="text-sm text-petal">
                Sheuli will be awake {describeDays(schedule.scheduleDays)} from{' '}
                <span className="font-semibold text-sheuli-light">{formatTime12h(schedule.scheduleStart)}</span> to{' '}
                <span className="font-semibold text-sheuli-light">{formatTime12h(schedule.scheduleEnd)}</span> (
                {schedule.timezone}).
              </p>

              {isOvernight && (
                <p className="text-xs text-petal-dim">
                  🌙 This window crosses midnight — Sheuli will be active overnight.
                </p>
              )}

              {scheduleError && <p className="text-sm text-red-400">{scheduleError}</p>}

              <button
                onClick={() => saveSchedule()}
                disabled={scheduleSaving}
                className="w-fit rounded-xl bg-sheuli px-4 py-2 text-sm font-semibold text-night-900 shadow-glow-sm transition hover:bg-sheuli-light disabled:opacity-50"
              >
                {scheduleSaving ? 'Saving…' : 'Save schedule'}
              </button>
            </div>
          )}

          {schedule.mode === 'manual' && (
            <p className="text-xs text-petal-dim">
              Manual mode — control Sheuli from the master switch on the Overview page, or with /on and /off in
              your own WhatsApp chat.
            </p>
          )}

          {scheduleSavedAt && (
            <p className="text-xs text-petal-dim">Schedule saved at {scheduleSavedAt.toLocaleTimeString()}</p>
          )}
        </div>
      </Section>


      <Section title="Rate limit" description="Caps how many replies Sheuli sends to the same contact per hour.">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-petal">Enable rate limit</p>
            <Toggle checked={settings.rateLimitPerHour > 0} onChange={toggleRateLimit} />
          </div>

          {settings.rateLimitPerHour > 0 ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={rateLimitDraft}
                  onChange={(e) => {
                    setRateLimitDraft(e.target.value);
                    setRateLimitError('');
                  }}
                  className="w-24 rounded-lg border border-white/10 bg-night-500/80 px-3 py-2 text-petal outline-none"
                />
                <span className="text-xs text-petal-dim">max replies per contact / hour</span>
                <button
                  onClick={saveRateLimit}
                  disabled={saving}
                  className="rounded-xl bg-sheuli px-4 py-2 text-sm font-semibold text-night-900 shadow-glow-sm transition hover:bg-sheuli-light disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save limit'}
                </button>
              </div>
              {rateLimitError && <p className="text-sm text-red-400">{rateLimitError}</p>}
            </div>
          ) : (
            <p className="text-xs text-yellow-300/90">
              ⚠️ Unlimited mode: Sheuli will reply to every message. This may increase API cost — the daily cost
              guard still protects you.
            </p>
          )}
        </div>
      </Section>

      <Section title="Model" description="Which OpenAI model Sheuli uses to write replies.">
        <select
          value={settings.model}
          onChange={(e) => save({ model: e.target.value })}
          className="rounded-lg border border-white/10 bg-night-500/80 px-3 py-2 text-petal outline-none"
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Section>

      <Section
        title="Daily API cost guard"
        description="Once today's estimated OpenAI cost hits this limit, Sheuli pauses auto-replies until midnight."
      >
        <div className="flex items-center gap-3">
          <span className="text-petal-dim">$</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={settings.costLimitDaily}
            onChange={(e) => patch({ costLimitDaily: e.target.value })}
            className="w-32 rounded-lg border border-white/10 bg-night-500/80 px-3 py-2 text-petal outline-none"
          />
          <button
            onClick={() => save({ costLimitDaily: Number(settings.costLimitDaily) })}
            disabled={saving}
            className="rounded-xl bg-sheuli px-4 py-2 text-sm font-semibold text-night-900 shadow-glow-sm transition hover:bg-sheuli-light disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save limit'}
          </button>
        </div>
        <p className="mt-2 text-xs text-petal-dim">Default: $0.50/day. Resets at local midnight ({schedule.timezone}).</p>
      </Section>

      <Section
        title="🌅 Daily Summary"
        description="Every morning Sheuli sends a Bangla recap of everything that happened while she was on duty to your own WhatsApp chat."
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-petal">Enable daily summary</p>
            <Toggle
              checked={Boolean(settings.dailySummaryEnabled)}
              onChange={() => save({ dailySummaryEnabled: !settings.dailySummaryEnabled })}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-petal-dim">
            Send at
            <input
              type="time"
              value={settings.dailySummaryTime}
              onChange={(e) => patch({ dailySummaryTime: e.target.value })}
              onBlur={() => save({ dailySummaryTime: settings.dailySummaryTime })}
              className="rounded-lg border border-white/10 bg-night-500/80 px-3 py-1.5 text-petal outline-none"
            />
            <span className="text-petal-dim/70">({schedule.timezone})</span>
          </label>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-petal">Skip if no messages</p>
              <p className="text-xs text-petal-dim">When on, sends nothing instead of the "no messages" note.</p>
            </div>
            <Toggle
              checked={Boolean(settings.dailySummarySkipIfEmpty)}
              onChange={() => save({ dailySummarySkipIfEmpty: !settings.dailySummarySkipIfEmpty })}
            />
          </div>

          <p className="text-xs text-petal-dim">
            You can also request one anytime by sending <span className="font-mono text-petal">/summary</span> to your own
            "Message Yourself" chat. Past summaries are on the Logs page.
          </p>
        </div>
      </Section>


      {savedAt && <p className="text-xs text-petal-dim">Saved at {savedAt.toLocaleTimeString()}</p>}

      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-night-400 p-6 shadow-2xl backdrop-blur-xl">
            <h3 className="text-lg font-bold text-petal">Logout WhatsApp?</h3>
            <p className="mt-3 text-sm leading-relaxed text-petal-dim">
              This will unlink the current WhatsApp account ({waInfo?.number ? `+${waInfo.number}` : 'the currently linked account'}). Sheuli will stop replying until you scan the QR code with an account. This does NOT delete your chat history or settings.
            </p>
            
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-night-500/50 p-3.5 transition hover:border-white/20">
              <input
                type="checkbox"
                checked={clearHistoryCheckbox}
                onChange={(e) => setClearHistoryCheckbox(e.target.checked)}
                disabled={loggingOut}
                className="mt-0.5 h-4 w-4 rounded border-white/20 bg-night-500 text-sheuli accent-sheuli focus:ring-0"
              />
              <span className="text-xs font-medium text-petal">
                Also clear all chat history and conversation memory
              </span>
            </label>

            {logoutError && <p className="mt-3 text-xs text-red-400">{logoutError}</p>}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => !loggingOut && setShowLogoutModal(false)}
                disabled={loggingOut}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-petal-dim transition hover:bg-white/5 hover:text-petal disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmLogout}
                disabled={loggingOut}
                className="rounded-xl bg-red-500 px-5 py-2 text-sm font-semibold text-white shadow-glow-sm transition hover:bg-red-600 disabled:opacity-50"
              >
                {loggingOut ? 'Logging out…' : 'Logout'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Routine Slot Add / Edit Modal */}
      {routineModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-night-600/95 p-6 shadow-glow backdrop-blur-md">
            <h3 className="text-lg font-bold text-petal">
              {editingSlotId ? '✏️ Edit Routine Slot' : '➕ Add Routine Slot'}
            </h3>
            <p className="mt-1 text-xs text-petal-dim">
              Configure class or lab session details. Sheuli uses this in real-time.
            </p>

            <div className="mt-4 space-y-3.5 text-xs">
              {/* Day & Group */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-semibold text-petal-dim">Day of Week</label>
                  <select
                    value={slotForm.day}
                    onChange={(e) => setSlotForm({ ...slotForm, day: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-night-500/80 px-3 py-2 text-petal outline-none focus:border-sheuli"
                  >
                    {['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-petal-dim">Group</label>
                  <select
                    value={slotForm.group}
                    onChange={(e) => setSlotForm({ ...slotForm, group: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-night-500/80 px-3 py-2 text-petal outline-none focus:border-sheuli"
                  >
                    <option value="All">Section G (Theory)</option>
                    <option value="G1">Group 1 (G1 Lab)</option>
                  </select>
                </div>
              </div>

              {/* Start & End Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-semibold text-petal-dim">Start Time (24h)</label>
                  <input
                    type="time"
                    value={slotForm.startTime}
                    onChange={(e) => setSlotForm({ ...slotForm, startTime: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-night-500/80 px-3 py-2 text-petal outline-none focus:border-sheuli"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-petal-dim">End Time (24h)</label>
                  <input
                    type="time"
                    value={slotForm.endTime}
                    onChange={(e) => setSlotForm({ ...slotForm, endTime: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-night-500/80 px-3 py-2 text-petal outline-none focus:border-sheuli"
                    required
                  />
                </div>
              </div>

              {/* Subject */}
              <div>
                <label className="mb-1 block font-semibold text-petal-dim">Subject / Course Name</label>
                <input
                  type="text"
                  placeholder="e.g. Machine Learning Driven Data Applications"
                  value={slotForm.subject}
                  onChange={(e) => setSlotForm({ ...slotForm, subject: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-night-500/80 px-3 py-2 text-petal outline-none focus:border-sheuli"
                  required
                />
              </div>

              {/* Code & Room */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-semibold text-petal-dim">Code / Teacher</label>
                  <input
                    type="text"
                    placeholder="e.g. DS421 - MRN"
                    value={slotForm.code}
                    onChange={(e) => setSlotForm({ ...slotForm, code: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-night-500/80 px-3 py-2 text-petal outline-none focus:border-sheuli"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-petal-dim">Room / Location</label>
                  <input
                    type="text"
                    placeholder="e.g. 712B or Annex-108"
                    value={slotForm.room}
                    onChange={(e) => setSlotForm({ ...slotForm, room: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-night-500/80 px-3 py-2 text-petal outline-none focus:border-sheuli"
                  />
                </div>
              </div>

              {/* Valid Until */}
              <div>
                <label className="mb-1 block font-semibold text-petal-dim">Valid Until Date</label>
                <input
                  type="date"
                  value={slotForm.validUntil}
                  onChange={(e) => setSlotForm({ ...slotForm, validUntil: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-night-500/80 px-3 py-2 text-petal outline-none focus:border-sheuli"
                />
                <p className="mt-1 text-[11px] text-petal-dim/80">
                  Semester ends 2026-12-20. Slots will automatically stop activating after this date.
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setRoutineModalOpen(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs font-medium text-petal-dim hover:bg-white/5 hover:text-petal transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSlot}
                disabled={!slotForm.subject.trim() || !slotForm.startTime || !slotForm.endTime}
                className="rounded-xl bg-sheuli px-5 py-2 text-xs font-semibold text-night-900 shadow-glow-sm hover:bg-sheuli-light transition disabled:opacity-50"
              >
                {editingSlotId ? 'Update Slot' : 'Save Slot'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
