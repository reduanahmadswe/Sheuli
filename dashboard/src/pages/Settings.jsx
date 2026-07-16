import { useEffect, useState } from 'react';
import api from '../lib/api.js';

const MODEL_OPTIONS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

  const [testingAlert, setTestingAlert] = useState(false);
  const [alertResult, setAlertResult] = useState(null);

  const [rateLimitDraft, setRateLimitDraft] = useState('10');
  const [rateLimitError, setRateLimitError] = useState('');

  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(true);

  const loadDiagnostics = async () => {
    try {
      const { data } = await api.get('/diagnostics');
      setDiagnostics(data);
    } catch {
      // Leave the last-known values displayed rather than clearing them.
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  useEffect(() => {
    api.get('/settings').then(({ data }) => setSettings(data));
    api.get('/settings/schedule').then(({ data }) => setSchedule(data));
    loadDiagnostics();
    const interval = setInterval(loadDiagnostics, 10000);
    return () => clearInterval(interval);
  }, []);

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

  const sendTestAlert = async () => {
    setTestingAlert(true);
    setAlertResult(null);
    try {
      await api.post('/settings/test-alert');
      setAlertResult({ ok: true, message: 'Test alert sent — check your Telegram.' });
    } catch (err) {
      setAlertResult({ ok: false, message: err.response?.data?.error || 'Failed to send test alert.' });
    } finally {
      setTestingAlert(false);
    }
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
            <DiagRow
              label="Telegram alerts"
              value={diagnostics.env.telegramConfigured ? 'configured' : 'not configured'}
              tone={diagnostics.env.telegramConfigured ? 'good' : undefined}
            />
            <DiagRow label="Last incoming message" value={formatDiagnosticTime(diagnostics.lastIncomingAt)} />
            <DiagRow label="Last reply sent" value={formatDiagnosticTime(diagnostics.lastReplyAt)} />
            <DiagRow label="Server uptime" value={`${Math.floor(diagnostics.uptimeSeconds / 60)} min`} />
          </div>
        ) : (
          <p className="text-sm text-red-400">Could not load diagnostics.</p>
        )}
      </Section>

      <Section title="Sheuli's personality" description="This is the system prompt sent to the AI on every reply.">
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

      <Section title="Whitelist mode" description="When on, Sheuli only replies to whitelisted contacts.">
        <Toggle
          checked={Boolean(settings.whitelistMode)}
          onChange={() => save({ whitelistMode: !settings.whitelistMode })}
        />
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

      <Section
        title="Telegram alerts"
        description="Get pinged on Telegram when Sheuli disconnects, crashes, or hits her daily cost limit."
      >
        <div className="flex flex-col gap-3">
          <button
            onClick={sendTestAlert}
            disabled={testingAlert}
            className="w-fit rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-petal-dim transition-colors hover:border-sheuli/40 hover:text-sheuli-light disabled:opacity-50"
          >
            {testingAlert ? 'Sending…' : 'Send test alert'}
          </button>
          {alertResult && (
            <p className={`text-sm ${alertResult.ok ? 'text-emerald-300' : 'text-red-400'}`}>{alertResult.message}</p>
          )}
          <p className="text-xs text-petal-dim">
            Configure <span className="font-mono text-petal">TELEGRAM_BOT_TOKEN</span> and{' '}
            <span className="font-mono text-petal">TELEGRAM_CHAT_ID</span> in <span className="font-mono text-petal">.env</span>{' '}
            on the server, then restart Sheuli — see the README for how to create a bot with @BotFather.
          </p>
        </div>
      </Section>

      {savedAt && <p className="text-xs text-petal-dim">Saved at {savedAt.toLocaleTimeString()}</p>}
    </div>
  );
}
