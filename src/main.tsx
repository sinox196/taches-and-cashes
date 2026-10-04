import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './context/AuthContext';
import { PresenceProvider } from './context/PresenceContext';
import { LanguageProvider } from './context/LanguageContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import './styles/frontend-refresh.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <AuthProvider>
          <PresenceProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </PresenceProvider>
        </AuthProvider>
      </LanguageProvider>
    </ErrorBoundary>
  </StrictMode>,
);
