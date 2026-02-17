import { useQuery } from '@tanstack/react-query';
import { useApi } from './useApi';

export interface ClaimEligibility {
  eligible: boolean;
  heat: number;
  minimum_heat: number;
  total_balance: string;
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
    balance: string;
  }>;
}

export function useClaimEligibility(chain: string, ca: string) {
  const api = useApi();

  return useQuery({
    queryKey: ['claim-eligibility', chain, ca, api.walletAddress],
    enabled: Boolean(chain && ca && ca.length > 5 && api.authenticated),
    queryFn: () => api.get<ClaimEligibility>(`/api/claim-eligibility/${chain}/${ca}`),
    retry: false,
    staleTime: 60_000, // 1 minute
  });
}
