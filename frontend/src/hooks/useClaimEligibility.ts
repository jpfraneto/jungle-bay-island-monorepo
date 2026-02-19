import { useQuery } from '@tanstack/react-query';
import { useApi } from './useApi';

export interface ClaimEligibility {
  eligible: boolean;
  heat: number;
  minimum_heat: number;
  wallets_checked: number;
  farcaster: {
    fid: number;
    username: string;
    display_name: string;
    pfp_url: string;
    wallets_found: number;
  } | null;
  x_username: string | null;
  holdings: Array<{
    address: string;
    heat_degrees: number;
  }>;
  wallet_map?: Array<{
    address: string;
    wallet_kind: 'evm' | 'solana';
    linked_via_privy: boolean;
    linked_via_farcaster: boolean;
    farcaster_verified: boolean;
    is_requester_wallet: boolean;
  }>;
  wallet_map_summary?: {
    total_wallets: number;
    evm_wallets: number;
    solana_wallets: number;
    farcaster_verified_wallets: number;
  };
  scan_pending: boolean;
  scan_status: 'scanning' | 'complete';
  scan_id: number | null;
  scan_progress: {
    phase: string | null;
    pct: number | null;
    scanStatus: string | null;
    startedAt: string | null;
    eventsFetched: number;
    holdersFound: number;
    rpcCallsMade: number;
  } | null;
  estimated_seconds?: number;
}

export function useClaimEligibility(chain: string, ca: string) {
  const api = useApi();

  return useQuery({
    queryKey: ['claim-eligibility', chain, ca, api.walletAddress],
    enabled: Boolean(chain && ca && ca.length > 5 && api.authenticated && api.authTokenReady),
    queryFn: () => api.get<ClaimEligibility>(`/api/claim-eligibility/${chain}/${ca}`),
    retry: (failureCount, error: unknown) => {
      if (failureCount >= 4) return false;
      if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = (error as { code?: string }).code;
        if (code === 'auth_required' || code === 'invalid_token') return true;
      }
      return failureCount < 2;
    },
    retryDelay: 1200,
    staleTime: 60_000, // 1 minute
    refetchInterval: (query) => (query.state.data?.scan_pending ? 3000 : false),
  });
}
