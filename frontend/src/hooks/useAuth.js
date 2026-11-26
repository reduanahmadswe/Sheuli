import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api.js';

export function useAuth() {
  const [authenticated, setAuthenticated] = useState(null); // null = loading
  const [checking, setChecking] = useState(true);

  const checkAuth = useCallback(async () => {
    setChecking(true);
    try {
      const { data } = await api.get('/auth/me');
      setAuthenticated(Boolean(data.authenticated));
    } catch {
      setAuthenticated(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (password) => {
    await api.post('/auth/login', { password });
    setAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setAuthenticated(false);
  }, []);

  return { authenticated, checking, login, logout, refresh: checkAuth };
}

export default useAuth;
