import { useAssistantName } from '../lib/identity.js';
import { useEffect, useState } from 'react';
import api from '../lib/api.js';
import { getDisplayName } from '../lib/formatContact.js';

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
  received: 'bg-line text-muted',
  replied: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  skipped: 'bg-line text-muted',
  rate_limited: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300',
  blacklisted: 'bg-red-500/15 text-red-700 dark:text-red-300',
  'skipped-outside-schedule': 'bg-accent/15 text-accent-strong',
  'skipped-cost-limit': 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300',
  'skipped-group': 'bg-line text-muted',
  'skipped-channel': 'bg-line text-muted',
  'skipped-broadcast': 'bg-line text-muted',
  'skipped-status': 'bg-line text-muted',
  'skipped-self': 'bg-line text-muted',
  'skipped-unknown-chat-type': 'bg-line text-muted',
  error: 'bg-red-500/15 text-red-700 dark:text-red-300'
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
    <div className="border-b border-line last:border-none">
      <button
        onClick={onToggle}
        className="flex w-full flex-col gap-2 px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-4 transition-colors hover:bg-soft"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{formatDate(summary.created_at)}</p>
          <p className="truncate text-xs text-muted">{preview}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs text-muted">
          <span>{summary.contact_count} contacts</span>
          <span>{summary.message_count} msgs</span>
          <span className="rounded-full bg-line px-2 py-0.5">{summary.trigger}</span>
          <span className="text-muted">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>
      {expanded && (
        <div className="whitespace-pre-wrap px-4 pb-4 font-bengali text-sm text-ink">{summary.content}</div>
      )}
    </div>
  );
}

export default function Logs() {
  const assistant = useAssistantName();
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
          <h1 className="page-title">Logs</h1>
          <p className="text-sm text-muted">Every message event {assistant} has recorded, and its daily summaries.</p>
        </div>
        {tab === 'logs' && (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All statuses' : s.replace('_', ' ')}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="inline-flex w-fit rounded-xl border border-line bg-soft p-1">
        {[
          { key: 'logs', label: 'Logs' },
          { key: 'summaries', label: '🌅 Summaries' }
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-accent text-white' : 'text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'logs' && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card shadow-card">
          <table className="stack-table w-full text-left text-sm sm:min-w-[720px]">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Direction</th>
                <th className="px-4 py-3">Message</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-line last:border-none">
                  <td data-label="Time" className="whitespace-nowrap px-4 py-3 text-muted">{formatDate(log.created_at)}</td>
                  <td data-label="Contact" className="px-4 py-3 text-ink">{getDisplayName(log.contact_name, null, log.contact_id)}</td>
                  <td data-label="Direction" className="px-4 py-3 text-muted">{log.direction === 'in' ? 'Received' : 'Sent'}</td>
                  <td data-label="Message" className="px-4 py-3 text-muted sm:max-w-xs sm:truncate" title={log.body}>
                    {log.body || '—'}
                  </td>
                  <td data-label="Status" className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs ${STATUS_STYLE[log.status] || 'bg-line text-muted'}`}
                    >
                      {log.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    No logs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'summaries' && (
        <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-card">
          {summaries.map((s) => (
            <SummaryRow
              key={s.id}
              summary={s}
              expanded={expandedId === s.id}
              onToggle={() => setExpandedId((prev) => (prev === s.id ? null : s.id))}
            />
          ))}
          {!summariesLoading && summaries.length === 0 && (
            <p className="px-4 py-8 text-center text-muted">
              No summaries yet — the first one will appear here once {assistant}'s daily summary runs.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
