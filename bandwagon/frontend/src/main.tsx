import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import { queryClient } from './lib/queryClient';
import { AuthProvider } from './context/AuthContext';
import { App } from './App';
import { initSentry } from './lib/sentry';
import './index.css';

initSentry();

function ErrorFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-center bg-gray-950">
      <div>
        <p className="text-lg font-semibold text-white">Something went wrong.</p>
        <p className="mt-1 text-sm text-gray-400">Please refresh the page and try again.</p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
