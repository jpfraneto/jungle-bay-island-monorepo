import { useQuery } from '@tanstack/react-query';
import { useApi } from './useApi';
import type { Tier } from '../lib/types';
import { normalizeTier } from '../lib/heat';

interface UserToken {
  chain: string;
  ca: string;
  token_name: string;
  token_symbol: string;
  heat_degrees?: number;
}

export interface UserProfile {
  wallet: string;
  island_heat?: number;
  tier?: Tier;
  farcaster?: {
    fid?: number;
    username?: string;
    display_name?: string;
    pfp_url?: string;
  };
  tokens: UserToken[];
  scans: Array<{ chain: string; ca: string; scanned_at?: string }>;
}

function normalizeUser(raw: any, wallet: string): UserProfile {
  const farcaster = raw?.farcaster || raw?.profile || undefined;

  const tokensRaw = Array.isArray(raw?.token_breakdown)
    ? raw.token_breakdown
    : Array.isArray(raw?.tokens)
      ? raw.tokens
      : [];

  const scansRaw = Array.isArray(raw?.scans) ? raw.scans : [];

  return {
    wallet: raw?.wallet || wallet,
    island_heat: raw?.island_heat !== undefined ? Number(raw.island_heat) || 0 : undefined,
    tier: raw?.tier ? normalizeTier(raw.tier) : undefined,
    farcaster: farcaster
      ? {
          fid: farcaster.fid !== undefined ? Number(farcaster.fid) : undefined,
          username: farcaster.username,
          display_name: farcaster.display_name,
          pfp_url: farcaster.pfp_url,
        }
      : undefined,
    tokens: tokensRaw
      .map((token: any, index: number) => {
        const ca = token.ca || token.token || token.token_address || token.address;
        if (!ca) return null;
        return {
          chain: token.chain || 'base',
          ca,
          token_name: token.token_name || token.name || `Token ${index + 1}`,
          token_symbol: token.token_symbol || token.symbol || token.token_name || 'UNK',
          heat_degrees:
            token.heat_degrees !== undefined ? Number(token.heat_degrees) || 0 : undefined,
        };
      })
      .filter((token: UserToken | null): token is UserToken => Boolean(token)),
    scans: scansRaw
      .map((scan: any) => {
        const ca = scan.ca || scan.token || scan.token_address;
        if (!ca) return null;
        return {
          chain: scan.chain || 'base',
          ca,
          scanned_at: scan.scanned_at || scan.created_at,
        };
      })
      .filter(
        (scan: { chain: string; ca: string; scanned_at?: string } | null): scan is { chain: string; ca: string; scanned_at?: string } =>
          Boolean(scan),
      ),
  };
}

export function useUser(wallet?: string) {
  const api = useApi();

  return useQuery({
    queryKey: ['user', wallet, api.walletAddress],
    enabled: Boolean(wallet),
    queryFn: async () => normalizeUser(await api.get<any>(`/api/user/${wallet}`), wallet || ''),
  });
}
