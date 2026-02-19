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
  scan_pending: boolean;
  scan_status: 'scanning' | 'complete';
  scan_id: number | null;
  estimated_seconds?: number;
}

export function useClaimEligibility(chain: string, ca: string) {
  const api = useApi();

  return useQuery({
    queryKey: ['claim-eligibility', chain, ca, api.walletAddress],
    enabled: Boolean(chain && ca && ca.length > 5 && api.authenticated),
    queryFn: () => api.get<ClaimEligibility>(`/api/claim-eligibility/${chain}/${ca}`),
    retry: false,
    staleTime: 60_000, // 1 minute
    refetchInterval: (query) => (query.state.data?.scan_pending ? 3000 : false),
  });
}
