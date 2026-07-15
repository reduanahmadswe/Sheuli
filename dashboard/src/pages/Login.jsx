import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import useAuth from '../hooks/useAuth.js';

export default function Login() {
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
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo size={64} animated />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-petal">Sheuli</h1>
            <p className="mt-1 text-sm text-petal-dim">She blooms while you sleep.</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-white/10 bg-night-400/60 p-6 shadow-glow-sm backdrop-blur-xl"
        >
          <label htmlFor="password" className="mb-2 block text-sm font-medium text-petal-dim">
            Dashboard password
          </label>
          <input
            id="password"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-night-500/80 px-4 py-2.5 text-petal outline-none ring-sheuli/50 transition focus:ring-2"
            placeholder="••••••••"
          />

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading || !password}
            className="mt-5 w-full rounded-xl bg-sheuli px-4 py-2.5 font-semibold text-night-900 shadow-glow transition-all hover:bg-sheuli-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Waking Sheuli…' : 'Enter'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-petal-dim/70">
          🌸 Sheuli — your personal WhatsApp AI assistant
        </p>
      </div>
    </div>
  );
}
