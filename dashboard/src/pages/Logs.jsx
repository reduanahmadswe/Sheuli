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

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    load(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-petal">Logs</h1>
          <p className="text-sm text-petal-dim">Every message event Sheuli has recorded.</p>
        </div>
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
      </div>

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
                  <span className={`rounded-full px-2.5 py-1 text-xs ${STATUS_STYLE[log.status] || 'bg-white/10 text-petal-dim'}`}>
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
    </div>
  );
}
