import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { PairingPage } from './pages/Pairing';
import { ConversationsPage } from './pages/Conversations';
import { ContactsPage } from './pages/Contacts';
import { ProvidersPage } from './pages/Providers';
import { SoulPage } from './pages/Soul';
import { SystemPromptPage } from './pages/SystemPrompt';
import { RAGPage } from './pages/RAG';
import { MCPPage } from './pages/MCP';
import './styles.css';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="loading">
          <div className="spinner" />
          Loading...
        </div>
      </div>
    );
  }

  return isAuthenticated ? <Layout>{children}</Layout> : <Navigate to="/login" />;
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" /> : <LoginPage />}
      />
      <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/pairing" element={<ProtectedRoute><PairingPage /></ProtectedRoute>} />
      <Route path="/conversations" element={<ProtectedRoute><ConversationsPage /></ProtectedRoute>} />
      <Route path="/contacts" element={<ProtectedRoute><ContactsPage /></ProtectedRoute>} />
      <Route path="/providers" element={<ProtectedRoute><ProvidersPage /></ProtectedRoute>} />
      <Route path="/soul" element={<ProtectedRoute><SoulPage /></ProtectedRoute>} />
      <Route path="/system-prompt" element={<ProtectedRoute><SystemPromptPage /></ProtectedRoute>} />
      <Route path="/rag" element={<ProtectedRoute><RAGPage /></ProtectedRoute>} />
      <Route path="/mcp" element={<ProtectedRoute><MCPPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'var(--bg-raised)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
            },
          }}
        />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
