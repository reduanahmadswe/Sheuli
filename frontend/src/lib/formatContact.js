export function isRawId(str) {
  if (!str) return true;
  const s = String(str).trim();
  if (s.includes('@c.us') || s.includes('@lid') || s.includes('@g.us') || s.includes('@newsletter')) return true;
  if (/^\d{10,}$/.test(s)) return true;
  return false;
}

export function formatPhoneNumber(num) {
  if (!num) return '';
  const s = String(num).replace('@c.us', '').replace('@lid', '').replace('@g.us', '').trim();
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (/^\d+$/.test(s)) return `+${s}`;
  return s;
}

export function getDisplayName(name, number, contactId = '') {
  const cleanName = name && typeof name === 'string' ? name.trim() : '';
  if (cleanName && !isRawId(cleanName)) {
    return cleanName;
  }

  const cleanNum = number || contactId;
  const formatted = formatPhoneNumber(cleanNum);
  if (formatted) {
    return formatted;
  }

  if (cleanName) return cleanName;
  return 'Unknown Contact';
}
