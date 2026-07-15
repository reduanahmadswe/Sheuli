// Pure, dependency-free chat-type classifier so it can be unit tested without
// spinning up a real WhatsApp client (see server/tests/chatFilter.test.mjs).
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

export default { classifyChatId, isIndividualChatId };
