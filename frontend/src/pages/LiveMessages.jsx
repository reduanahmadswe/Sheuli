import { useAssistantName } from '../lib/identity.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../lib/api.js';
import getSocket from '../lib/socket.js';
import Logo from '../components/Logo.jsx';
import { getDisplayName, formatPhoneNumber } from '../lib/formatContact.js';

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
  const assistant = useAssistantName();
  const displayName = getDisplayName(chat.name, chat.number, chat.contactId);
  const preview = chat.lastMessageBody
    ? chat.lastMessageDirection === 'out'
      ? `${assistant}: ${chat.lastMessageBody}`
      : chat.lastMessageBody
    : chat.lastMessageStatus
      ? `— ${(STATUS_TAG[chat.lastMessageStatus] || chat.lastMessageStatus).replace('_', ' ')}`
      : 'No messages yet';

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors ${
        active ? 'bg-accent/10' : 'hover:bg-soft'
      }`}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-soft text-sm font-semibold text-accent-strong ring-1 ring-line">
        {initials(displayName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium text-ink">{displayName}</p>
          <span className="shrink-0 text-[11px] text-muted">{formatTime(chat.lastMessageAt)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted">{preview}</p>
          {chat.unreadCount > 0 && (
            <span className="flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">
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

  // Older logs hold empty rows for WhatsApp system events — nothing to show.
  if (!isOut && !msg.body) return null;

  if (isOut && !msg.body) {
    const tag = STATUS_TAG[msg.status] || msg.status;
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-soft px-3 py-1 text-[11px] text-muted">{tag}</span>
      </div>
    );
  }

  const isVoiceMsg = msg.isVoice || (msg.body && msg.body.includes('[Voice Note'));

  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className="flex max-w-[85%] flex-col gap-1 break-words sm:max-w-[75%]">
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
            isOut
              ? 'rounded-br-sm bg-accent font-medium text-white'
              : 'rounded-bl-sm border border-line bg-soft text-ink'
          }`}
        >
          {isVoiceMsg && (
            <div className="flex items-center gap-1.5 text-xs font-semibold mb-1 opacity-80">
              <span>🎙️ Voice Note</span>
            </div>
          )}
          {msg.body}
        </div>
        <span className={`px-1 text-[10px] text-muted/70 ${isOut ? 'text-right' : 'text-left'}`}>
          {formatTime(msg.created_at || msg.createdAt)}
        </span>
      </div>
    </div>
  );
}

function DateSeparator({ label }) {
  return (
    <div className="flex justify-center py-2">
      <span className="rounded-full bg-soft px-3 py-1 text-[11px] text-muted">{label}</span>
    </div>
  );
}

export default function LiveMessages() {
  const assistant = useAssistantName();
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
        const existing = idx >= 0 ? prev[idx] : null;
        const isOpenChat = selectedIdRef.current === msg.contactId;
        // Skip/status placeholder events (rate_limited, blacklisted, etc.) always
        // log with an empty body — they must never overwrite the chat-list
        // preview, which should always show the last real message text.
        const hasRealBody = Boolean(msg.body);
        const bumped = {
          contactId: msg.contactId,
          name: (existing && existing.name) || msg.contactName,
          number: existing ? existing.number : msg.contactId.replace('@c.us', '').replace('@lid', ''),
          blacklisted: existing ? existing.blacklisted : 0,
          whitelisted: existing ? existing.whitelisted : 0,
          lastMessageBody: hasRealBody ? msg.body : (existing?.lastMessageBody ?? null),
          lastMessageDirection: hasRealBody ? msg.direction : (existing?.lastMessageDirection ?? null),
          lastMessageStatus: hasRealBody ? msg.status : (existing?.lastMessageStatus ?? null),
          lastMessageAt: hasRealBody ? msg.createdAt : (existing?.lastMessageAt ?? msg.createdAt),
          unreadCount:
            msg.direction === 'in' && !isOpenChat ? (existing ? (existing.unreadCount || 0) + 1 : 1) : existing ? existing.unreadCount : 0
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
    // Scroll only the message list; scrollIntoView would drag the whole page on phones.
    const list = bottomRef.current?.parentElement;
    list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
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
        <h1 className="page-title">Live Messages</h1>
        <p className="text-sm text-muted">Chat with {assistant}'s conversations, one contact at a time.</p>
      </div>

      <div className="flex h-[calc(100dvh-15rem)] min-h-[22rem] overflow-hidden md:h-[calc(100dvh-13rem)] rounded-2xl border border-line bg-card shadow-card">
        {/* Chat list pane */}
        <div className={`${selectedId ? 'hidden md:flex' : 'flex'} w-full flex-col md:w-80 md:border-r md:border-line`}>
          <div className="border-b border-line p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats…"
              className="w-full rounded-xl border border-line bg-soft px-3 py-2 text-sm text-ink outline-none ring-accent/50 focus:ring-2"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredChats.length === 0 && (
              <p className="p-6 text-center text-sm text-muted">No conversations yet.</p>
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
              <p className="text-sm text-muted">Select a chat to view the conversation</p>
            </div>
          )}

          {selectedChat && (
            <>
              <div className="flex items-center gap-2 border-b border-line px-3 py-3 sm:gap-3 sm:px-4">
                <button
                  onClick={closeChat}
                  className="rounded-lg p-1.5 text-muted hover:bg-soft hover:text-ink md:hidden"
                  aria-label="Back to chat list"
                >
                  ←
                </button>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-soft text-xs font-semibold text-accent-strong ring-1 ring-line">
                  {initials(getDisplayName(selectedChat.name, selectedChat.number, selectedChat.contactId))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {getDisplayName(selectedChat.name, selectedChat.number, selectedChat.contactId)}
                  </p>
                  {formatPhoneNumber(selectedChat.number || selectedChat.contactId) !== getDisplayName(selectedChat.name, selectedChat.number, selectedChat.contactId) && (
                    <p className="truncate text-xs text-muted">{formatPhoneNumber(selectedChat.number || selectedChat.contactId)}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:gap-2">
                  <button
                    onClick={() => toggleFlag('blacklisted')}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                      selectedChat.blacklisted
                        ? 'border-red-400/40 bg-red-500/15 text-red-700 dark:text-red-300'
                        : 'border-line text-muted hover:text-ink'
                    }`}
                  >
                    {selectedChat.blacklisted ? 'Blacklisted' : 'Blacklist'}
                  </button>
                  <button
                    onClick={clearMemory}
                    disabled={clearing}
                    className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:text-ink disabled:opacity-50"
                  >
                    {clearing ? 'Clearing…' : 'Clear memory'}
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {groupedMessages.length === 0 && (
                  <p className="mt-10 text-center text-sm text-muted">No messages in this conversation yet.</p>
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
