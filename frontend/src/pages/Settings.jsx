import { LuSlidersHorizontal, LuMessageSquare, LuSunrise, LuSmartphone, LuCheck, LuLock, LuTriangleAlert } from 'react-icons/lu';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api.js';
import getSocket from '../lib/socket.js';
import { useAssistantName } from '../lib/identity.js';

// Every change on this page saves by itself; a small "Saved" note confirms it.

const TABS = [
  { id: 'general', label: 'General', icon: LuSlidersHorizontal },
  { id: 'replies', label: 'Replies', icon: LuMessageSquare },
  { id: 'summary', label: 'Summary', icon: LuSunrise },
  { id: 'account', label: 'Account', icon: LuSmartphone }
];

const MODEL_OPTIONS = [
  { value: 'gpt-4o-mini', label: 'gpt-4o-mini (cheapest, recommended)' },
  { value: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
  { value: 'gpt-4o', label: 'gpt-4o (smarter, costs more)' }
];
const VOICE_OPTIONS = [
  { value: 'nova', label: 'Nova (warm female)' },
  { value: 'shimmer', label: 'Shimmer (clear female)' },
  { value: 'alloy', label: 'Alloy (neutral)' },
  { value: 'echo', label: 'Echo (calm male)' },
  { value: 'fable', label: 'Fable (expressive)' },
  { value: 'onyx', label: 'Onyx (deep male)' }
];
const RATE_LIMITS = [5, 10, 20, 50, 100, 0];
const COST_LIMITS = [0.25, 0.5, 1, 2, 5];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_LABEL = {
  initializing: { text: 'Starting up…', color: 'bg-yellow-400' },
  qr: { text: 'Waiting for QR scan', color: 'bg-yellow-400' },
  authenticated: { text: 'Signed in — starting up…', color: 'bg-blue-400' },
  loading: { text: 'Loading chats…', color: 'bg-blue-400' },
  ready: { text: 'Connected', color: 'bg-emerald-400' },
  connected: { text: 'Connected', color: 'bg-emerald-400' },
  disconnected: { text: 'Disconnected — reconnecting', color: 'bg-red-400' },
  auth_failure: { text: 'Sign-in failed', color: 'bg-red-400' },
  logging_out: { text: 'Logging out…', color: 'bg-yellow-400' },
  needs_qr: { text: 'Preparing a new QR code…', color: 'bg-yellow-400' }
};

function getStatusDisplay(status, percent, switchingAccount, sessionRecoveryFailed) {
  if (switchingAccount && status !== 'qr') return { text: 'Switching account…', color: 'bg-yellow-400' };
  if (status === 'qr' && sessionRecoveryFailed) {
    return { text: "Couldn't restore the session — scan the QR code below.", color: 'bg-red-400' };
  }
  if (status === 'loading') return { text: `Loading chats… ${percent || 0}%`, color: 'bg-blue-400' };
  return STATUS_LABEL[status] || STATUS_LABEL.initializing;
}

function formatDiagnosticTime(iso) {
  if (!iso) return 'never';
  return new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

const FIELD =
  'w-full rounded-xl border border-line bg-soft px-3 py-2.5 text-sm text-ink outline-none ring-accent/50 focus:ring-2';

function Card({ title, hint, children }) {
  return (
    <section className="card p-4 sm:p-6">
      <h2 className="section-title">{title}</h2>
      {hint && <p className="mt-1.5 text-sm text-muted">{hint}</p>}
      <div className="mt-2 divide-y divide-line">{children}</div>
    </section>
  );
}

// One setting: what it is on the left, the control on the right (below on phones).
function Row({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-2 py-4 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      <div className="w-full shrink-0 sm:w-64">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      aria-label={label}
      className={`relative h-7 w-12 rounded-full transition-colors sm:ml-auto sm:block ${checked ? 'bg-accent' : 'bg-line'}`}
    >
      <span
        className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function Choice({ selected, onClick, title, text }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-2xl border p-4 text-left transition ${
        selected ? 'border-accent bg-accent/10' : 'border-line bg-card hover:border-accent/50'
      }`}
    >
      <span className="flex items-center justify-between gap-2 text-sm font-bold text-ink">
        {title}
        {selected && <LuCheck className="shrink-0 text-accent" aria-hidden="true" />}
      </span>
      <span className="mt-1 block text-xs text-muted">{text}</span>
    </button>
  );
}

// Saves when the field is left (or Enter is pressed), and only if it changed.
function NameField({ value, placeholder, onSave }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <input
      value={draft}
      maxLength={40}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onSave(draft.trim())}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className={FIELD}
    />
  );
}

function InfoRow({ label, value, good }) {
  const tone = good === undefined ? 'text-ink' : good ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300';
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className={`min-w-0 break-all text-right font-medium ${tone}`}>{value}</span>
    </div>
  );
}

export default function Settings() {
  const assistant = useAssistantName();
  const navigate = useNavigate();

  const [tab, setTab] = useState('general');
  const [settings, setSettings] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);

  const [diagnostics, setDiagnostics] = useState(null);
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

  // QR is only meaningful while waiting for a scan.
  const applyConnection = (status, details = {}) => {
    setWaStatus(status);
    if (details.loadingPercent !== undefined) setLoadingPercent(details.loadingPercent);
    setSwitchingAccount(Boolean(details.switchingAccount));
    setSessionRecoveryFailed(Boolean(details.sessionRecoveryFailed));
    setPairingRejectedHint(Boolean(details.pairingRejectedHint));
    if (['authenticated', 'loading', 'ready', 'connected', 'logging_out'].includes(status)) setWaQr(null);
  };

  const loadDiagnostics = async () => {
    try {
      const { data } = await api.get('/diagnostics');
      setDiagnostics(data);
      if (data.whatsapp) {
        applyConnection(data.whatsapp.state, data.whatsapp);
        if (data.whatsapp.number || data.whatsapp.name) {
          setWaInfo({ number: data.whatsapp.number, name: data.whatsapp.name });
        }
      }
    } catch {
      // Keep the last known values on screen.
    }
  };

  useEffect(() => {
    api.get('/settings').then(({ data }) => setSettings(data));
    api.get('/settings/schedule').then(({ data }) => setSchedule(data));
    api.get('/status').then(({ data }) => {
      applyConnection(data.connection, data);
      setWaInfo(data.info);
      if (data.qr) setWaQr(data.qr);
    });
    loadDiagnostics();
    const interval = setInterval(loadDiagnostics, 10000);

    const socket = getSocket();
    const onWaStatus = (details) => {
      if (typeof details === 'string') return applyConnection(details);
      applyConnection(details?.status || details?.connection || 'initializing', details);
      if (details?.info !== undefined) setWaInfo(details.info);
    };
    const onWaQr = ({ qr }) => setWaQr(qr);
    socket.on('whatsapp:status', onWaStatus);
    socket.on('whatsapp:qr', onWaQr);

    return () => {
      clearInterval(interval);
      clearTimeout(noticeTimer.current);
      socket.off('whatsapp:status', onWaStatus);
      socket.off('whatsapp:qr', onWaQr);
    };
  }, []);

  const flash = (text, error = false) => {
    clearTimeout(noticeTimer.current);
    setNotice({ text, error });
    noticeTimer.current = setTimeout(() => setNotice(null), error ? 5000 : 2000);
  };

  // Sends only what changed.
  const save = async (changes) => {
    try {
      const { data } = await api.put('/settings', changes);
      setSettings(data);
      flash('Saved');
    } catch (err) {
      flash(err.response?.data?.error || 'Could not save. Please try again.', true);
    }
  };

  const saveSchedule = async (changes) => {
    const next = { ...schedule, ...changes };
    setSchedule(next);
    if (next.scheduleStart === next.scheduleEnd) {
      flash('Start and end time cannot be the same.', true);
      return;
    }
    try {
      const { data } = await api.put('/settings/schedule', {
        mode: next.mode,
        scheduleStart: next.scheduleStart,
        scheduleEnd: next.scheduleEnd,
        scheduleDays: next.scheduleDays
      });
      setSchedule(data);
      flash('Saved');
    } catch (err) {
      flash(err.response?.data?.error || 'Could not save the timetable.', true);
    }
  };

  const toggleDay = (day) => {
    const current = schedule.scheduleDays || [];
    saveSchedule({ scheduleDays: current.includes(day) ? current.filter((d) => d !== day) : [...current, day] });
  };

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

  if (!settings || !schedule) {
    return <p className="text-muted">Loading settings…</p>;
  }

  const status = getStatusDisplay(waStatus, loadingPercent, switchingAccount, sessionRecoveryFailed);
  const connected = waStatus === 'ready' || waStatus === 'connected';
  const voiceMode = settings.voiceReplyMode || 'auto';
  // Keep a previously chosen value selectable even if it isn't one of the presets.
  const rateLimits = RATE_LIMITS.includes(settings.rateLimitPerHour) ? RATE_LIMITS : [settings.rateLimitPerHour, ...RATE_LIMITS];
  const costLimits = COST_LIMITS.includes(Number(settings.costLimitDaily))
    ? COST_LIMITS
    : [Number(settings.costLimitDaily), ...COST_LIMITS];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 sm:gap-6">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="text-sm text-muted">Changes are saved automatically.</p>
      </div>

      <div role="tablist" className="card grid grid-cols-4 gap-1 p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-xs font-semibold transition sm:flex-row sm:justify-center sm:gap-2 sm:text-sm ${
              tab === item.id ? 'bg-accent text-white' : 'text-muted hover:bg-soft hover:text-ink'
            }`}
          >
            <item.icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <>
          <Card title="Names">
            <Row label="Assistant name" hint="What your assistant calls itself.">
              <NameField value={settings.assistantName} placeholder="Sheuli" onSave={(v) => save({ assistantName: v })} />
            </Row>
            <Row label="Your name" hint="Empty means your WhatsApp account name.">
              <NameField value={settings.ownerName} placeholder={settings.effectiveOwnerName} onSave={(v) => save({ ownerName: v })} />
            </Row>
          </Card>

          <Card title="When should it reply?">
            <div className="grid gap-3 pt-3 sm:grid-cols-2">
              <Choice
                selected={schedule.mode === 'manual'}
                onClick={() => saveSchedule({ mode: 'manual' })}
                title="I'll switch it myself"
                text="Use the switch on Overview, or send /on and /off to yourself."
              />
              <Choice
                selected={schedule.mode === 'schedule'}
                onClick={() => saveSchedule({ mode: 'schedule' })}
                title="On a timetable"
                text="Replies only during the hours you pick."
              />
            </div>

            {schedule.mode === 'schedule' && (
              <div className="mt-4 flex flex-col gap-4 pt-4">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['scheduleStart', 'From'],
                    ['scheduleEnd', 'Until']
                  ].map(([key, label]) => (
                    <label key={key} className="text-sm font-semibold text-ink">
                      {label}
                      <input
                        type="time"
                        value={schedule[key]}
                        onChange={(e) => setSchedule({ ...schedule, [key]: e.target.value })}
                        onBlur={() => saveSchedule({})}
                        className={`${FIELD} mt-1`}
                      />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {WEEKDAYS.map((day) => {
                    const on = (schedule.scheduleDays || []).includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(day)}
                        aria-pressed={on}
                        className={`rounded-lg border py-2 text-xs font-semibold ${
                          on ? 'border-accent bg-accent/10 text-accent-strong' : 'border-line text-muted'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted">
                  Times are in {schedule.timezone}.
                  {schedule.scheduleStart > schedule.scheduleEnd && ' This window runs overnight.'}
                </p>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'replies' && (
        <>
          <Card title="Voice notes">
            <Row label="Reply with" hint="How to answer incoming messages.">
              <select value={voiceMode} onChange={(e) => save({ voiceReplyMode: e.target.value })} className={FIELD}>
                <option value="auto">Same as they sent</option>
                <option value="text">Always text</option>
                <option value="voice">Always voice</option>
              </select>
            </Row>
            {voiceMode !== 'text' && (
              <Row label="Voice">
                <select value={settings.ttsVoice || 'nova'} onChange={(e) => save({ ttsVoice: e.target.value })} className={FIELD}>
                  {VOICE_OPTIONS.map((voice) => (
                    <option key={voice.value} value={voice.value}>
                      {voice.label}
                    </option>
                  ))}
                </select>
              </Row>
            )}
          </Card>

          <Card title="Limits" hint="These protect you from spam and surprise bills.">
            <Row label="Replies per person" hint="Most replies to one contact in an hour.">
              <select
                value={settings.rateLimitPerHour}
                onChange={(e) => save({ rateLimitPerHour: Number(e.target.value) })}
                className={FIELD}
              >
                {rateLimits.map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? 'No limit' : `${n} per hour`}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Daily spending limit" hint="Replies pause until midnight once reached.">
              <select
                value={Number(settings.costLimitDaily)}
                onChange={(e) => save({ costLimitDaily: Number(e.target.value) })}
                className={FIELD}
              >
                {costLimits.map((n) => (
                  <option key={n} value={n}>
                    ${n.toFixed(2)} per day
                  </option>
                ))}
              </select>
            </Row>
            <Row label="AI model">
              <select value={settings.model} onChange={(e) => save({ model: e.target.value })} className={FIELD}>
                {MODEL_OPTIONS.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </Row>
          </Card>
          <p className="flex items-start gap-2 text-xs text-muted">
            <LuLock className="mt-0.5 shrink-0" aria-hidden="true" />
            Only personal chats get replies. Groups, channels and broadcasts are always ignored.
          </p>
        </>
      )}

      {tab === 'summary' && (
        <Card title="Daily summary" hint="A short Bangla recap, sent to your own WhatsApp chat.">
          <Row label="Send me a summary">
            <Toggle
              label="Daily summary"
              checked={Boolean(settings.dailySummaryEnabled)}
              onChange={() => save({ dailySummaryEnabled: !settings.dailySummaryEnabled })}
            />
          </Row>
          {Boolean(settings.dailySummaryEnabled) && (
            <>
              <Row label="Time" hint={schedule.timezone}>
                <input
                  type="time"
                  value={settings.dailySummaryTime}
                  onChange={(e) => setSettings({ ...settings, dailySummaryTime: e.target.value })}
                  onBlur={() => save({ dailySummaryTime: settings.dailySummaryTime })}
                  className={FIELD}
                />
              </Row>
              <Row label="Skip quiet days" hint="Send nothing when there were no messages.">
                <Toggle
                  label="Skip quiet days"
                  checked={Boolean(settings.dailySummarySkipIfEmpty)}
                  onChange={() => save({ dailySummarySkipIfEmpty: !settings.dailySummarySkipIfEmpty })}
                />
              </Row>
            </>
          )}
          <p className="pt-4 text-xs text-muted">
            Want one now? Send <span className="font-mono font-semibold text-ink">/summary</span> to yourself. Old ones are on
            the Logs page.
          </p>
        </Card>
      )}

      {tab === 'account' && (
        <>
          <Card title="WhatsApp">
            <div className="flex flex-col gap-3 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="flex items-center gap-2 font-semibold text-ink">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${status.color}`} />
                  {status.text}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {waInfo?.number ? `+${waInfo.number}` : 'No account linked'}
                  {waInfo?.name ? ` · ${waInfo.name}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLogoutError('');
                  setShowLogoutModal(true);
                }}
                disabled={waStatus === 'logging_out' || switchingAccount || loggingOut}
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-500/20 disabled:opacity-50 dark:text-red-300"
              >
                Log out WhatsApp
              </button>
            </div>

            {waStatus === 'qr' && waQr && (
              <div className="mt-4 flex flex-col items-center gap-2 pt-4 text-center">
                {pairingRejectedHint && (
                  <p className="max-w-xs text-xs font-medium text-yellow-700 dark:text-yellow-300">
                    <LuTriangleAlert className="mr-1 inline" aria-hidden="true" />
                    WhatsApp rejected the last link right after accepting it. Try updating whatsapp-web.js.
                  </p>
                )}
                <div className="rounded-2xl border border-line bg-white p-3">
                  <img src={waQr} alt="Scan this QR code with WhatsApp" className="h-48 w-48" />
                </div>
                <p className="text-xs text-muted">On your phone: WhatsApp → Linked Devices → Link a Device.</p>
              </div>
            )}
          </Card>

          <details className="card p-4 sm:p-6">
            <summary className="cursor-pointer text-sm font-bold text-brand">Technical details (for troubleshooting)</summary>
            {diagnostics ? (
              <div className="mt-3 divide-y divide-line">
                <InfoRow label="WhatsApp" value={diagnostics.whatsapp.state} good={connected} />
                <InfoRow label="Auto-reply" value={diagnostics.autoReply.reason} good={diagnostics.autoReply.active} />
                <InfoRow
                  label="OpenAI key"
                  value={diagnostics.env.openaiApiKeyPresent ? 'added' : 'MISSING'}
                  good={diagnostics.env.openaiApiKeyPresent}
                />
                <InfoRow
                  label="Today's cost"
                  value={`$${diagnostics.cost.todayEstimated.toFixed(4)} / $${diagnostics.cost.dailyLimit.toFixed(2)}`}
                />
                <InfoRow label="Last message received" value={formatDiagnosticTime(diagnostics.lastIncomingAt)} />
                <InfoRow label="Last reply sent" value={formatDiagnosticTime(diagnostics.lastReplyAt)} />
                <InfoRow label="Messages stored" value={diagnostics.database.messageCount} />
                <InfoRow label="Database file" value={diagnostics.database.path} />
                <InfoRow label="Running for" value={`${Math.floor(diagnostics.uptimeSeconds / 60)} min`} />
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">Loading…</p>
            )}
          </details>
        </>
      )}

      {notice && (
        <div
          role="status"
          className={`fixed bottom-24 left-1/2 z-50 w-max max-w-[90vw] -translate-x-1/2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-card md:bottom-8 ${
            notice.error ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {!notice.error && <LuCheck className="mr-1 inline" aria-hidden="true" />}
          {notice.text}
        </div>
      )}

      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-ink">Log out WhatsApp?</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {assistant} will stop replying until you scan a new QR code. Your chat history and settings stay.
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-soft p-3.5">
              <input
                type="checkbox"
                checked={clearHistoryCheckbox}
                onChange={(e) => setClearHistoryCheckbox(e.target.checked)}
                disabled={loggingOut}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span className="text-xs font-medium text-ink">Also delete all chat history and memory</span>
            </label>
            {logoutError && <p className="mt-3 text-xs text-red-500">{logoutError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => !loggingOut && setShowLogoutModal(false)}
                disabled={loggingOut}
                className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-muted hover:bg-soft hover:text-ink disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmLogout}
                disabled={loggingOut}
                className="rounded-xl bg-red-500 px-5 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              >
                {loggingOut ? 'Logging out…' : 'Log out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
