import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import useAuth from './hooks/useAuth.js';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import LiveMessages from './pages/LiveMessages.jsx';
import Contacts from './pages/Contacts.jsx';
import Settings from './pages/Settings.jsx';
import Logs from './pages/Logs.jsx';

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-night text-petal-dim">
      <p className="animate-pulse">Blooming…</p>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { authenticated, checking } = useAuth();

  if (checking || authenticated === null) return <LoadingScreen />;
  if (!authenticated) return <Navigate to="/login" replace />;

  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Overview />
          </ProtectedRoute>
        }
      />
      <Route
        path="/messages"
        element={
          <ProtectedRoute>
            <LiveMessages />
          </ProtectedRoute>
        }
      />
      <Route
        path="/contacts"
        element={
          <ProtectedRoute>
            <Contacts />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/logs"
        element={
          <ProtectedRoute>
            <Logs />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
