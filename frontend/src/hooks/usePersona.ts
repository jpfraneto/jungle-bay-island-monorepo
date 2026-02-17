import { useQuery } from '@tanstack/react-query';
import { useApi } from './useApi';
import type { PersonaResponse } from '../lib/types';
import { normalizeTier } from '../lib/heat';

function normalizePersona(raw: any): PersonaResponse {
  const tokenBreakdown = Array.isArray(raw?.token_breakdown)
    ? raw.token_breakdown.map((token: any, index: number) => ({
        chain: token.chain || 'base',
        ca: token.ca || token.token_address || token.token || `unknown-${index}`,
        token_name: token.token_name || token.name || 'Unknown',
        token_symbol: token.token_symbol || token.symbol || token.token_name || 'UNK',
        heat_degrees: Number(token.heat_degrees) || 0,
      }))
    : [];

  const scans = Array.isArray(raw?.scans)
    ? raw.scans.map((scan: any, index: number) => ({
        id: `${scan.token_address || scan.ca || 'token'}-${scan.scanned_at || index}`,
        chain: scan.chain || 'base',
        ca: scan.ca || scan.token_address || '',
        created_at: scan.created_at || scan.scanned_at || new Date().toISOString(),
      }))
    : [];

  return {
    profile: {
      fid: Number(raw?.fid) || 0,
      username: raw?.username || `fid_${raw?.fid || 'unknown'}`,
      display_name: raw?.display_name,
      pfp_url: raw?.pfp_url,
    },
    island_heat: Number(raw?.island_heat) || 0,
    tier: normalizeTier(raw?.tier),
    wallet_count: Number(raw?.wallet_count) || 0,
    wallets: Array.isArray(raw?.wallets)
      ? raw.wallets
          .map((wallet: any) => {
            if (typeof wallet === 'string') {
              return { wallet };
            }

            if (wallet && typeof wallet === 'object' && wallet.wallet) {
              return {
                wallet: wallet.wallet,
                heat_degrees:
                  wallet.heat_degrees !== undefined ? Number(wallet.heat_degrees) || 0 : undefined,
              };
            }

            return null;
          })
          .filter(
            (wallet: { wallet: string; heat_degrees?: number } | null): wallet is { wallet: string; heat_degrees?: number } =>
              Boolean(wallet),
          )
      : [],
    token_breakdown: tokenBreakdown,
    scan_log: scans,
    bungalows_claimed: Array.isArray(raw?.bungalows_claimed) ? raw.bungalows_claimed : [],
  };
}

export function usePersona(fid?: string) {
  const api = useApi();

  return useQuery({
    queryKey: ['persona', fid, api.walletAddress],
    enabled: Boolean(fid),
    queryFn: async () => normalizePersona(await api.get<any>(`/api/persona/${fid}`)),
  });
}
