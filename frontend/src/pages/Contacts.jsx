import { useAssistantName } from '../lib/identity.js';
import { useEffect, useState } from 'react';
import api from '../lib/api.js';
import { getDisplayName, formatPhoneNumber } from '../lib/formatContact.js';

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      onClick={onChange}
      aria-pressed={checked}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-line'
      }`}
      title={label}
    >
      <span
        className={`absolute left-0 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export default function Contacts() {
  const assistant = useAssistantName();
  const [contacts, setContacts] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = async (q = '') => {
    setLoading(true);
    try {
      const { data } = await api.get('/contacts', { params: { search: q } });
      setContacts(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => load(search), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const syncContacts = async () => {
    setSyncing(true);
    try {
      await api.post('/contacts/sync');
      await load(search);
    } catch {
      // Ignore sync errors
    } finally {
      setSyncing(false);
    }
  };

  const updateContact = async (id, patch) => {
    const { data } = await api.patch(`/contacts/${id}`, patch);
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...data } : c)));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Contacts</h1>
          <p className="text-sm text-muted">Everyone who has messaged you, and how {assistant} treats them.</p>
        </div>
        <button
          onClick={syncContacts}
          disabled={syncing}
          className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-accent/40 hover:text-accent-strong disabled:opacity-50"
        >
          {syncing ? 'Syncing names…' : 'Sync WhatsApp Names'}
        </button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or number…"
        className="w-full max-w-sm rounded-xl border border-line bg-card px-4 py-2.5 text-sm text-ink outline-none ring-accent/50 focus:ring-2"
      />

      <div className="overflow-x-auto rounded-2xl border border-line bg-card shadow-card">
        <table className="stack-table w-full text-left text-sm sm:min-w-[640px]">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Messages</th>
              <th className="px-4 py-3">Last message</th>
              <th className="px-4 py-3">Blacklist</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => {
              const displayName = getDisplayName(c.name, c.number, c.id);
              const displayNum = formatPhoneNumber(c.number || c.id);
              return (
                <tr key={c.id} className="border-b border-line last:border-none">
                  <td data-label="Contact" className="px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{displayName}</p>
                      {displayNum !== displayName && <p className="text-xs text-muted">{displayNum}</p>}
                    </div>
                  </td>
                  <td data-label="Messages" className="px-4 py-3 text-muted">{c.message_count}</td>
                  <td data-label="Last message" className="px-4 py-3 text-muted">{formatDate(c.last_message_at)}</td>
                  <td data-label="Blacklist" className="px-4 py-3">
                    <Toggle
                      checked={Boolean(c.blacklisted)}
                      onChange={() => updateContact(c.id, { blacklisted: !c.blacklisted })}
                      label="Blacklist"
                    />
                  </td>
                </tr>
              );
            })}
            {!loading && contacts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  No contacts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
