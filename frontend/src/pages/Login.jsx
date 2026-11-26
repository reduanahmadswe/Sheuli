import { useAssistantName } from '../lib/identity.js';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import useAuth from '../hooks/useAuth.js';

export default function Login() {
  const assistant = useAssistantName();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { authenticated, login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authenticated) navigate('/', { replace: true });
  }, [authenticated, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="hero relative flex min-h-screen items-center justify-center rounded-none border-0 px-4 py-10">
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo size={64} animated />
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-brand">{assistant}</h1>
            <p className="mt-1 text-sm text-muted">She blooms while you sleep.</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-line bg-card p-6 shadow-glow-sm shadow-card"
        >
          <label htmlFor="password" className="mb-2 block text-sm font-medium text-muted">
            Dashboard password
          </label>
          <input
            id="password"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-line bg-soft px-4 py-2.5 text-ink outline-none ring-accent/50 transition focus:ring-2"
            placeholder="••••••••"
          />

          {error && <p className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}

          <button
            type="submit"
            disabled={loading || !password}
            className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white shadow-glow transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? `Waking ${assistant}…` : 'Enter'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-muted/70">
          🌸 {assistant} — your personal WhatsApp AI assistant
        </p>
      </div>
    </div>
  );
}
