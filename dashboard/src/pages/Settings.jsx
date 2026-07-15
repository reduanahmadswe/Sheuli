import { useEffect, useState } from 'react';
import api from '../lib/api.js';

const MODEL_OPTIONS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'];

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={onChange}
      aria-pressed={checked}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-sheuli' : 'bg-white/10'
      }`}
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

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    api.get('/settings').then(({ data }) => setSettings(data));
  }, []);

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

  if (!settings) {
    return <p className="text-petal-dim">Loading settings…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-petal">Settings</h1>
        <p className="text-sm text-petal-dim">Tune how Sheuli thinks, talks, and behaves.</p>
      </div>

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

      <Section title="Schedule mode" description="Automatically wake Sheuli up during a nightly window.">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <Toggle
              checked={Boolean(settings.scheduleEnabled)}
              onChange={() => save({ scheduleEnabled: !settings.scheduleEnabled })}
            />
            <span className="text-sm text-petal-dim">
              {settings.scheduleEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm text-petal-dim">
            Start
            <input
              type="time"
              value={settings.scheduleStart}
              onChange={(e) => patch({ scheduleStart: e.target.value })}
              onBlur={() => save({ scheduleStart: settings.scheduleStart })}
              className="rounded-lg border border-white/10 bg-night-500/80 px-3 py-1.5 text-petal outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-petal-dim">
            End
            <input
              type="time"
              value={settings.scheduleEnd}
              onChange={(e) => patch({ scheduleEnd: e.target.value })}
              onBlur={() => save({ scheduleEnd: settings.scheduleEnd })}
              className="rounded-lg border border-white/10 bg-night-500/80 px-3 py-1.5 text-petal outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-petal-dim">
            Timezone
            <input
              type="text"
              value={settings.timezone}
              onChange={(e) => patch({ timezone: e.target.value })}
              onBlur={() => save({ timezone: settings.timezone })}
              className="w-36 rounded-lg border border-white/10 bg-night-500/80 px-3 py-1.5 text-petal outline-none"
            />
          </label>
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Section title="Rate limit" description="Max AI replies per contact, per hour.">
          <input
            type="number"
            min={1}
            max={50}
            value={settings.rateLimitPerHour}
            onChange={(e) => patch({ rateLimitPerHour: Number(e.target.value) })}
            onBlur={() => save({ rateLimitPerHour: settings.rateLimitPerHour })}
            className="w-24 rounded-lg border border-white/10 bg-night-500/80 px-3 py-2 text-petal outline-none"
          />
        </Section>

        <Section title="Whitelist mode" description="When on, Sheuli only replies to whitelisted contacts.">
          <Toggle
            checked={Boolean(settings.whitelistMode)}
            onChange={() => save({ whitelistMode: !settings.whitelistMode })}
          />
        </Section>
      </div>

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

      {savedAt && <p className="text-xs text-petal-dim">Saved at {savedAt.toLocaleTimeString()}</p>}
    </div>
  );
}
