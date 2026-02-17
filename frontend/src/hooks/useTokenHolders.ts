import { useQuery } from '@tanstack/react-query';
import { useApi } from './useApi';
import type { Holder } from '../lib/types';
import { normalizeTier } from '../lib/heat';

interface TokenHolderResponse {
  holders: Holder[];
  total: number;
}

function normalizeTokenHolders(raw: any): TokenHolderResponse {
  const holders = Array.isArray(raw?.holders)
    ? raw.holders.map((holder: any, index: number) => ({
        rank: Number(holder.rank) || index + 1,
        wallet: holder.wallet,
        heat_degrees: Number(holder.heat_degrees) || 0,
        tier: normalizeTier(holder.tier),
        farcaster: holder.farcaster
          ? {
              fid: Number(holder.farcaster.fid) || 0,
              username: holder.farcaster.username,
              pfp_url: holder.farcaster.pfp_url,
              display_name: holder.farcaster.display_name,
            }
          : undefined,
        island_heat: holder.island_heat !== undefined ? Number(holder.island_heat) : undefined,
      }))
    : [];

  return {
    holders,
    total: Number(raw?.total) || holders.length,
  };
}

export function useTokenHolders(ca?: string, limit = 50, offset = 0) {
  const api = useApi();
  const search = new URLSearchParams();
  search.set('limit', String(limit));
  search.set('offset', String(offset));

  return useQuery({
    queryKey: ['token-holders', ca, limit, offset, api.walletAddress],
    enabled: Boolean(ca),
    queryFn: async () => normalizeTokenHolders(await api.get<any>(`/api/token/${ca}/holders?${search.toString()}`)),
  });
}
