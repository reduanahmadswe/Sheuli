import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../lib/api.js';
import getSocket from '../lib/socket.js';
import Logo from '../components/Logo.jsx';

const STATUS_TAG = {
  skipped: 'skipped',
  rate_limited: 'rate limited',
  blacklisted: 'skipped — blacklisted',
  error: 'error'
};

function initials(name = '') {
  const clean = name.trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = iso.includes('T') ? new Date(iso) : new Date(`${iso.replace(' ', 'T')}Z`);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function toDate(iso) {
  if (!iso) return new Date();
  return iso.includes('T') ? new Date(iso) : new Date(`${iso.replace(' ', 'T')}Z`);
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(iso) {
  const d = toDate(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, now)) return 'Today';
  if (isSameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

function ChatListItem({ chat, active, onClick }) {
  const preview = chat.lastMessageBody
    ? chat.lastMessageDirection === 'out'
      ? `Sheuli: ${chat.lastMessageBody}`
      : chat.lastMessageBody
    : chat.lastMessageStatus
      ? `— ${(STATUS_TAG[chat.lastMessageStatus] || chat.lastMessageStatus).replace('_', ' ')}`
      : 'No messages yet';

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-white/5 px-4 py-3 text-left transition-colors ${
        active ? 'bg-sheuli/10' : 'hover:bg-white/5'
      }`}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-night-300 text-sm font-semibold text-sheuli-light ring-1 ring-white/10">
        {initials(chat.name || chat.number)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium text-petal">{chat.name || chat.number}</p>
          <span className="shrink-0 text-[11px] text-petal-dim">{formatTime(chat.lastMessageAt)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs text-petal-dim">{preview}</p>
          {chat.unreadCount > 0 && (
            <span className="flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-sheuli px-1.5 text-[11px] font-semibold text-night-900">
              {chat.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function MessageBubble({ msg }) {
  const isOut = msg.direction === 'out';

  if (isOut && !msg.body) {
    const tag = STATUS_TAG[msg.status] || msg.status;
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] text-petal-dim">{tag}</span>
      </div>
    );
  }

  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className="flex max-w-[75%] flex-col gap-1">
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
            isOut
              ? 'rounded-br-sm bg-sheuli font-medium text-night-900'
              : 'rounded-bl-sm border border-white/5 bg-night-300/80 text-petal'
          }`}
        >
          {msg.body}
        </div>
        <span className={`px-1 text-[10px] text-petal-dim/70 ${isOut ? 'text-right' : 'text-left'}`}>
          {formatTime(msg.created_at || msg.createdAt)}
        </span>
      </div>
    </div>
  );
}

function DateSeparator({ label }) {
  return (
    <div className="flex justify-center py-2">
      <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] text-petal-dim">{label}</span>
    </div>
  );
}

export default function LiveMessages() {
  const [chats, setChats] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [clearing, setClearing] = useState(false);
  const bottomRef = useRef(null);
  const selectedIdRef = useRef(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadChats = async () => {
    const { data } = await api.get('/chats');
    setChats(data);
  };

  useEffect(() => {
    loadChats();

    const socket = getSocket();
    const onMessage = (msg) => {
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.contactId === msg.contactId);
        const isOpenChat = selectedIdRef.current === msg.contactId;
        const bumped = {
          contactId: msg.contactId,
          name: (idx >= 0 && prev[idx].name) || msg.contactName,
          number: idx >= 0 ? prev[idx].number : msg.contactId.replace('@c.us', '').replace('@lid', ''),
          blacklisted: idx >= 0 ? prev[idx].blacklisted : 0,
          whitelisted: idx >= 0 ? prev[idx].whitelisted : 0,
          lastMessageBody: msg.body,
          lastMessageDirection: msg.direction,
          lastMessageStatus: msg.status,
          lastMessageAt: msg.createdAt,
          unreadCount:
            msg.direction === 'in' && !isOpenChat ? (idx >= 0 ? (prev[idx].unreadCount || 0) + 1 : 1) : idx >= 0 ? prev[idx].unreadCount : 0
        };
        const rest = idx >= 0 ? [...prev.slice(0, idx), ...prev.slice(idx + 1)] : prev;
        return [bumped, ...rest];
      });

      if (selectedIdRef.current === msg.contactId) {
        setMessages((prev) => [...prev, msg]);
        api.post(`/chats/${msg.contactId}/read`).catch(() => {});
      }
    };

    socket.on('message:new', onMessage);
    return () => socket.off('message:new', onMessage);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const openChat = async (contactId) => {
    setSelectedId(contactId);
    setChats((prev) => prev.map((c) => (c.contactId === contactId ? { ...c, unreadCount: 0 } : c)));
    const { data } = await api.get(`/chats/${contactId}/messages`, { params: { limit: 100 } });
    setMessages(data);
    api.post(`/chats/${contactId}/read`).catch(() => {});
  };

  const closeChat = () => setSelectedId(null);

  const selectedChat = chats.find((c) => c.contactId === selectedId);

  const toggleFlag = async (field) => {
    if (!selectedChat) return;
    const { data } = await api.patch(`/contacts/${selectedId}`, { [field]: !selectedChat[field] });
    setChats((prev) => prev.map((c) => (c.contactId === selectedId ? { ...c, ...data } : c)));
  };

  const clearMemory = async () => {
    if (!selectedId) return;
    setClearing(true);
    try {
      await api.post(`/contacts/${selectedId}/clear-memory`);
      setMessages([]);
    } finally {
      setClearing(false);
    }
  };

  const filteredChats = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter(
      (c) => (c.name || '').toLowerCase().includes(q) || (c.number || '').toLowerCase().includes(q)
    );
  }, [chats, search]);

  const groupedMessages = useMemo(() => {
    const groups = [];
    let lastLabel = null;
    for (const msg of messages) {
      const label = dayLabel(msg.created_at || msg.createdAt);
      if (label !== lastLabel) {
        groups.push({ type: 'separator', label, key: `sep-${groups.length}` });
        lastLabel = label;
      }
      groups.push({ type: 'message', msg, key: `msg-${msg.id || groups.length}` });
    }
    return groups;
  }, [messages]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-petal">Live Messages</h1>
        <p className="text-sm text-petal-dim">Chat with Sheuli's conversations, one contact at a time.</p>
      </div>

      <div className="flex h-[calc(100vh-12rem)] overflow-hidden rounded-2xl border border-white/10 bg-night-400/40 backdrop-blur-xl">
        {/* Chat list pane */}
        <div className={`${selectedId ? 'hidden md:flex' : 'flex'} w-full flex-col md:w-80 md:border-r md:border-white/10`}>
          <div className="border-b border-white/10 p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats…"
              className="w-full rounded-xl border border-white/10 bg-night-500/80 px-3 py-2 text-sm text-petal outline-none ring-sheuli/50 focus:ring-2"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredChats.length === 0 && (
              <p className="p-6 text-center text-sm text-petal-dim">No conversations yet.</p>
            )}
            {filteredChats.map((chat) => (
              <ChatListItem
                key={chat.contactId}
                chat={chat}
                active={chat.contactId === selectedId}
                onClick={() => openChat(chat.contactId)}
              />
            ))}
          </div>
        </div>

        {/* Conversation pane */}
        <div className={`${selectedId ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
          {!selectedChat && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <Logo size={56} />
              <p className="text-sm text-petal-dim">Select a chat to view the conversation</p>
            </div>
          )}

          {selectedChat && (
            <>
              <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                <button
                  onClick={closeChat}
                  className="rounded-lg p-1.5 text-petal-dim hover:bg-white/5 hover:text-petal md:hidden"
                  aria-label="Back to chat list"
                >
                  ←
                </button>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-night-300 text-xs font-semibold text-sheuli-light ring-1 ring-white/10">
                  {initials(selectedChat.name || selectedChat.number)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-petal">
                    {selectedChat.name || selectedChat.number}
                  </p>
                  <p className="truncate text-xs text-petal-dim">{selectedChat.number}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => toggleFlag('blacklisted')}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                      selectedChat.blacklisted
                        ? 'border-red-400/40 bg-red-500/15 text-red-300'
                        : 'border-white/10 text-petal-dim hover:text-petal'
                    }`}
                  >
                    {selectedChat.blacklisted ? 'Blacklisted' : 'Blacklist'}
                  </button>
                  <button
                    onClick={() => toggleFlag('whitelisted')}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                      selectedChat.whitelisted
                        ? 'border-sheuli/40 bg-sheuli/15 text-sheuli-light'
                        : 'border-white/10 text-petal-dim hover:text-petal'
                    }`}
                  >
                    {selectedChat.whitelisted ? 'Whitelisted' : 'Whitelist'}
                  </button>
                  <button
                    onClick={clearMemory}
                    disabled={clearing}
                    className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-petal-dim transition-colors hover:text-petal disabled:opacity-50"
                  >
                    {clearing ? 'Clearing…' : 'Clear memory'}
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {groupedMessages.length === 0 && (
                  <p className="mt-10 text-center text-sm text-petal-dim">No messages in this conversation yet.</p>
                )}
                {groupedMessages.map((item) =>
                  item.type === 'separator' ? (
                    <DateSeparator key={item.key} label={item.label} />
                  ) : (
                    <MessageBubble key={item.key} msg={item.msg} />
                  )
                )}
                <div ref={bottomRef} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
