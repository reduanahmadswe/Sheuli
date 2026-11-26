// Pure, dependency-free chat-type classifier so it can be unit tested without
// spinning up a real WhatsApp client (see backend/tests/chatFilter.test.mjs).
//
// Whitelist-by-type: only individual 1-to-1 chats (@c.us and @lid) are eligible for a
// reply. Every other chat ID shape — including ones we don't recognize yet —
// is skipped by default. This is intentionally NOT a blocklist, so a future
// WhatsApp ID format we haven't seen can't silently slip through.

export function classifyChatId(chatId) {
  if (!chatId || typeof chatId !== 'string') return 'skipped-unknown-chat-type';
  if (chatId === 'status@broadcast') return 'skipped-status';
  if (chatId.includes('@broadcast')) return 'skipped-broadcast';
  if (chatId.endsWith('@newsletter')) return 'skipped-channel';
  if (chatId.endsWith('@g.us')) return 'skipped-group';
  if (chatId.endsWith('@c.us') || chatId.endsWith('@lid')) return null; // null = allowed, individual 1-to-1 chat (@c.us or @lid)
  return 'skipped-unknown-chat-type';
}

export function isIndividualChatId(chatId) {
  return classifyChatId(chatId) === null;
}

// Message types a person actually sends. Anything else (encryption notices,
// business templates, call logs, protocol events…) is WhatsApp's own noise.
const CONTENT_LABELS = {
  chat: '',
  audio: '[Voice Note Received]',
  ptt: '[Voice Note Received]',
  image: '[Image]',
  video: '[Video]',
  document: '[Document]',
  sticker: '[Sticker]',
  location: '[Location]',
  vcard: '[Contact card]',
  multi_vcard: '[Contact card]'
};

// Returns the text to store for a message, or null if it should be ignored.
export function describeContent({ type = 'chat', body = '' } = {}) {
  if (!Object.hasOwn(CONTENT_LABELS, type)) return null;
  const label = CONTENT_LABELS[type];
  // Location and contact-card bodies are raw data, not something the sender typed.
  const text = ['location', 'vcard', 'multi_vcard'].includes(type) ? '' : (body || '').trim();
  return [label, text].filter(Boolean).join(' ') || null;
}

export default { classifyChatId, isIndividualChatId, describeContent };
