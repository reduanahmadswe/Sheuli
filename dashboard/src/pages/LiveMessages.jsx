import { useEffect, useRef, useState } from 'react';
import api from '../lib/api.js';
import getSocket from '../lib/socket.js';

const STATUS_TAG = {
  replied: null,
  received: null,
  skipped: 'skipped',
  rate_limited: 'rate limited',
  blacklisted: 'blacklisted',
  error: 'error'
};

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function Bubble({ msg }) {
  const isOut = msg.direction === 'out';
  const tag = STATUS_TAG[msg.status];

  if (isOut && !msg.body) {
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] text-petal-dim">
          {msg.contactName}: {tag || msg.status}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] ${isOut ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        {!isOut && <span className="px-1 text-xs text-petal-dim">{msg.contactName}</span>}
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
            isOut
              ? 'rounded-br-sm bg-sheuli text-night-900 font-medium'
              : 'rounded-bl-sm bg-night-300/80 text-petal border border-white/5'
          }`}
        >
          {msg.body}
        </div>
        <span className="px-1 text-[10px] text-petal-dim/70">
          {formatTime(msg.createdAt || msg.created_at)}
          {isOut && tag ? ` · ${tag}` : ''}
        </span>
      </div>
    </div>
  );
}

export default function LiveMessages() {
  const [messages, setMessages] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    api.get('/logs', { params: { limit: 100 } }).then(({ data }) => {
      const ordered = [...data].reverse().map((row) => ({
        contactId: row.contact_id,
        contactName: row.contact_name,
        direction: row.direction,
        body: row.body,
        status: row.status,
        createdAt: row.created_at
      }));
      setMessages(ordered);
    });

    const socket = getSocket();
    const onMessage = (msg) => {
      setMessages((prev) => [...prev.slice(-199), msg]);
    };
    socket.on('message:new', onMessage);
    return () => socket.off('message:new', onMessage);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-petal">Live Messages</h1>
        <p className="text-sm text-petal-dim">Watch conversations as they happen, in real time.</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-night-400/40 p-4 backdrop-blur-xl sm:p-6">
        {messages.length === 0 && (
          <p className="mt-10 text-center text-sm text-petal-dim">No messages yet. They’ll appear here live.</p>
        )}
        {messages.map((msg, idx) => (
          <Bubble key={idx} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
