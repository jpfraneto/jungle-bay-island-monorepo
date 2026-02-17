import { useQuery } from '@tanstack/react-query';
import { useApi } from './useApi';

export interface ClaimPriceData {
  price_usdc: number;
  market_cap: number;
  token_name: string | null;
  token_symbol: string | null;
  image_url: string | null;
  price_usd: number | null;
  liquidity_usd: number | null;
  volume_24h: number | null;
}

export function useClaimPrice(chain: string, ca: string) {
  const api = useApi();

  return useQuery({
    queryKey: ['claim-price', chain, ca],
    enabled: Boolean(chain && ca && ca.length > 5),
    queryFn: () => api.get<ClaimPriceData>(`/api/claim-price/${chain}/${ca}`),
    retry: false,
  });
}
