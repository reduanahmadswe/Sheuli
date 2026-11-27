import { LuSun, LuMoon } from 'react-icons/lu';
import { useState } from 'react';

// The initial class is set by the inline script in index.html, so the page never
// flashes the wrong theme; this button only flips and remembers it.
export default function ThemeToggle({ className = '' }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next ? '#000000' : '#ffffff');
    try {
      localStorage.setItem('sheuli-theme', next ? 'dark' : 'light');
    } catch {
      // Private mode — the choice just won't persist.
    }
    setDark(next);
  };

  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-card text-lg transition hover:border-accent/50 ${className}`}
    >
      {dark ? <LuSun aria-hidden="true" /> : <LuMoon aria-hidden="true" />}
    </button>
  );
}
