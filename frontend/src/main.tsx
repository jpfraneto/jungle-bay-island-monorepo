import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import './styles/globals.css';
import { queryClient, wagmiConfig } from './config';
import { PrivyAuthProvider } from './lib/privy';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <PrivyAuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </PrivyAuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
