import { useSyncExternalStore } from 'react';

// The assistant's name, shared by every page. Filled from the server.
let assistantName = 'Sheuli';
const listeners = new Set();

export function setAssistantName(name) {
  if (!name || name === assistantName) return;
  assistantName = name;
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAssistantName() {
  return useSyncExternalStore(subscribe, () => assistantName);
}
