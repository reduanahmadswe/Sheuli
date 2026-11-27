// Runs INSIDE the WhatsApp Web page (via pupPage.evaluate), so it must not use
// anything from outside its own body. It reads what the page already holds in
// memory in one pass. client.getChats() + chat.getContact() builds a full model
// of every chat and took minutes (then timed out) on busy accounts.
export function readChatDirectory() {
  const optional = (name) => {
    try {
      return window.require(name);
    } catch {
      return null;
    }
  };
  const { Chat } = window.require('WAWebCollections');
  const getters = optional('WAWebContactGetters');
  const contactApi = optional('WAWebApiContact');
  const serialized = (wid) => wid?._serialized || wid?.$1 || null;

  const entries = [];
  for (const chat of Chat.getModelsArray()) {
    const id = serialized(chat.id);
    if (!id) continue;

    let name = null;
    let number = chat.id.user || id.split('@')[0];
    try {
      const contact = chat.contact;
      if (contact && getters) {
        name =
          getters.getName(contact) ||
          getters.getPushname(contact) ||
          getters.getShortName(contact) ||
          getters.getVerifiedName(contact) ||
          null;
      }
      name = name || chat.name || chat.formattedTitle || null;
      // "@lid" ids are not phone numbers; use the mapping the page already has.
      if (id.endsWith('@lid')) number = contactApi?.getPhoneNumber(chat.id)?.user || number;
    } catch {
      // Keep whatever was read for this chat.
    }

    entries.push({ id, name, number });
  }
  return entries;
}
