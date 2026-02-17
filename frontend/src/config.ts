import { QueryClient } from '@tanstack/react-query';
import { createConfig, http } from 'wagmi';
import { mainnet, base, polygon, optimism, arbitrum, linea, bsc } from 'wagmi/chains';
import { isRetryableApiError } from './lib/apiError';

function resolveApiUrl(): string {
  const configured = String(import.meta.env.VITE_API_URL ?? '').trim();
  if (configured) {
    return configured.endsWith('/') ? configured.slice(0, -1) : configured;
  }

  if (typeof window === 'undefined') {
    return 'http://localhost:3001';
  }

  const { hostname, origin } = window.location;

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:3001';
  }

  if (hostname.endsWith('anky.app')) {
    return 'https://poiesis.anky.app';
  }

  return origin;
}

export const API_URL = resolveApiUrl();

export const wagmiConfig = createConfig({
  chains: [base, mainnet, polygon, optimism, arbitrum, linea, bsc],
  transports: {
    [base.id]: http(import.meta.env.VITE_BASE_RPC_URL),
    [mainnet.id]: http(),
    [polygon.id]: http(),
    [optimism.id]: http(),
    [arbitrum.id]: http(),
    [linea.id]: http(),
    [bsc.id]: http(),
  },
  ssr: false,
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => failureCount < 1 && isRetryableApiError(error),
    },
  },
});

export const TIER_THRESHOLDS = {
  drifter: 0,
  observer: 30,
  resident: 80,
  builder: 150,
  elder: 250,
} as const;

export const HOME_TEAM_TICKERS = [
  'JBM',
  'BNKR',
  'DRB',
  'ALPHA',
  'QR',
  'RIZZ',
  'TOWELI',
  'JBC',
];
