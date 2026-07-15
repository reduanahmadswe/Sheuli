import { useEffect, useState } from 'react';
import api from '../lib/api.js';

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
        checked ? 'bg-sheuli' : 'bg-white/10'
      }`}
      title={label}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-petal transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

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

  const updateContact = async (id, patch) => {
    const { data } = await api.patch(`/contacts/${id}`, patch);
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...data } : c)));
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-petal">Contacts</h1>
        <p className="text-sm text-petal-dim">Everyone who has messaged you, and how Sheuli treats them.</p>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or number…"
        className="w-full max-w-sm rounded-xl border border-white/10 bg-night-400/60 px-4 py-2.5 text-sm text-petal outline-none ring-sheuli/50 focus:ring-2"
      />

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-night-400/40 backdrop-blur-xl">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-petal-dim">
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Messages</th>
              <th className="px-4 py-3">Last message</th>
              <th className="px-4 py-3">Blacklist</th>
              <th className="px-4 py-3">Whitelist</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id} className="border-b border-white/5 last:border-none">
                <td className="px-4 py-3">
                  <p className="font-medium text-petal">{c.name || c.number}</p>
                  <p className="text-xs text-petal-dim">{c.number}</p>
                </td>
                <td className="px-4 py-3 text-petal-dim">{c.message_count}</td>
                <td className="px-4 py-3 text-petal-dim">{formatDate(c.last_message_at)}</td>
                <td className="px-4 py-3">
                  <Toggle
                    checked={Boolean(c.blacklisted)}
                    onChange={() => updateContact(c.id, { blacklisted: !c.blacklisted })}
                    label="Blacklist"
                  />
                </td>
                <td className="px-4 py-3">
                  <Toggle
                    checked={Boolean(c.whitelisted)}
                    onChange={() => updateContact(c.id, { whitelisted: !c.whitelisted })}
                    label="Whitelist"
                  />
                </td>
              </tr>
            ))}
            {!loading && contacts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-petal-dim">
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
