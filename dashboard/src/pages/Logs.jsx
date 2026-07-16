import { useEffect, useState } from 'react';
import api from '../lib/api.js';

const STATUS_OPTIONS = [
  'all',
  'received',
  'replied',
  'skipped',
  'rate_limited',
  'blacklisted',
  'skipped-outside-schedule',
  'skipped-cost-limit',
  'skipped-group',
  'skipped-channel',
  'skipped-broadcast',
  'skipped-status',
  'skipped-self',
  'skipped-unknown-chat-type',
  'error'
];

const STATUS_STYLE = {
  received: 'bg-white/10 text-petal-dim',
  replied: 'bg-emerald-500/15 text-emerald-300',
  skipped: 'bg-white/10 text-petal-dim',
  rate_limited: 'bg-yellow-500/15 text-yellow-300',
  blacklisted: 'bg-red-500/15 text-red-300',
  'skipped-outside-schedule': 'bg-sheuli/15 text-sheuli-light',
  'skipped-cost-limit': 'bg-yellow-500/15 text-yellow-300',
  'skipped-group': 'bg-white/10 text-petal-dim',
  'skipped-channel': 'bg-white/10 text-petal-dim',
  'skipped-broadcast': 'bg-white/10 text-petal-dim',
  'skipped-status': 'bg-white/10 text-petal-dim',
  'skipped-self': 'bg-white/10 text-petal-dim',
  'skipped-unknown-chat-type': 'bg-white/10 text-petal-dim',
  error: 'bg-red-500/15 text-red-300'
};

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return iso;
  }
}

function SummaryRow({ summary, expanded, onToggle }) {
  const preview = (summary.content || '').split('\n')[0];
  return (
    <div className="border-b border-white/5 last:border-none">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-white/5"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-petal">{formatDate(summary.created_at)}</p>
          <p className="truncate text-xs text-petal-dim">{preview}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-petal-dim">
          <span>{summary.contact_count} contacts</span>
          <span>{summary.message_count} msgs</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5">{summary.trigger}</span>
          <span className="text-petal-dim">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>
      {expanded && (
        <div className="whitespace-pre-wrap px-4 pb-4 font-bengali text-sm text-petal">{summary.content}</div>
      )}
    </div>
  );
}

export default function Logs() {
  const [tab, setTab] = useState('logs');

  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);

  const [summaries, setSummaries] = useState([]);
  const [summariesLoading, setSummariesLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  const load = async (statusFilter) => {
    setLoading(true);
    try {
      const { data } = await api.get('/logs', {
        params: { status: statusFilter === 'all' ? undefined : statusFilter, limit: 200 }
      });
      setLogs(data);
    } finally {
      setLoading(false);
    }
  };

  const loadSummaries = async () => {
    setSummariesLoading(true);
    try {
      const { data } = await api.get('/summaries', { params: { limit: 60 } });
      setSummaries(data);
    } finally {
      setSummariesLoading(false);
    }
  };

  useEffect(() => {
    load(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (tab === 'summaries') loadSummaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-petal">Logs</h1>
          <p className="text-sm text-petal-dim">Every message event Sheuli has recorded, and her daily summaries.</p>
        </div>
        {tab === 'logs' && (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-white/10 bg-night-400/60 px-3 py-2 text-sm text-petal outline-none"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All statuses' : s.replace('_', ' ')}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="inline-flex w-fit rounded-xl border border-white/10 bg-night-500/60 p-1">
        {[
          { key: 'logs', label: 'Logs' },
          { key: 'summaries', label: '🌅 Summaries' }
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-sheuli text-night-900' : 'text-petal-dim hover:text-petal'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'logs' && (
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-night-400/40 backdrop-blur-xl">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-petal-dim">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Direction</th>
                <th className="px-4 py-3">Message</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-white/5 last:border-none">
                  <td className="whitespace-nowrap px-4 py-3 text-petal-dim">{formatDate(log.created_at)}</td>
                  <td className="px-4 py-3 text-petal">{log.contact_name || log.contact_id}</td>
                  <td className="px-4 py-3 text-petal-dim">{log.direction === 'in' ? 'Received' : 'Sent'}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-petal-dim" title={log.body}>
                    {log.body || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs ${STATUS_STYLE[log.status] || 'bg-white/10 text-petal-dim'}`}
                    >
                      {log.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-petal-dim">
                    No logs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'summaries' && (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-night-400/40 backdrop-blur-xl">
          {summaries.map((s) => (
            <SummaryRow
              key={s.id}
              summary={s}
              expanded={expandedId === s.id}
              onToggle={() => setExpandedId((prev) => (prev === s.id ? null : s.id))}
            />
          ))}
          {!summariesLoading && summaries.length === 0 && (
            <p className="px-4 py-8 text-center text-petal-dim">
              No summaries yet — the first one will appear here once Sheuli's daily summary runs.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
