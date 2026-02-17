import { useQuery } from '@tanstack/react-query';
import { useApi } from './useApi';
import type { LeaderboardEntry, LeaderboardResponse, Tier, TierCount } from '../lib/types';
import { normalizeTier } from '../lib/heat';

interface LeaderboardParams {
  page?: number;
  tier?: Tier | 'all';
}

const PAGE_SIZE = 50;

const pluralTierMap: Record<string, Tier> = {
  elders: 'elder',
  builders: 'builder',
  residents: 'resident',
  observers: 'observer',
  drifters: 'drifter',
};

function normalizeTierDistribution(raw: unknown): TierCount[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => ({
        tier: normalizeTier((item as { tier?: unknown }).tier),
        count: Number((item as { count?: unknown }).count) || 0,
      }))
      .filter((item) => item.count >= 0);
  }

  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([tier, count]) => ({
      tier: pluralTierMap[tier.toLowerCase()] || normalizeTier(tier),
      count: Number(count) || 0,
    }));
  }

  return [
    { tier: 'elder', count: 0 },
    { tier: 'builder', count: 0 },
    { tier: 'resident', count: 0 },
    { tier: 'observer', count: 0 },
    { tier: 'drifter', count: 0 },
  ];
}

function normalizeRows(raw: unknown): LeaderboardEntry[] {
  if (Array.isArray(raw)) {
    return raw.map((row, index) => {
      const item = row as Record<string, any>;
      const topTokens = Array.isArray(item.top_tokens)
        ? item.top_tokens.map((token: any, tokenIndex: number) => ({
            chain: token.chain || 'base',
            ca: token.ca || `unknown-${index}-${tokenIndex}`,
            token_name: token.token_name || token.symbol || 'Unknown',
            token_symbol: token.token_symbol || token.symbol || token.token_name || 'UNK',
            heat_degrees: Number(token.heat_degrees) || 0,
          }))
        : [];

      return {
        rank: Number(item.rank) || index + 1,
        island_heat: Number(item.island_heat) || 0,
        tier: normalizeTier(item.tier),
        wallet_count: Number(item.wallet_count) || 0,
        profile: {
          fid: Number(item.fid) || 0,
          username: item.username || `fid_${item.fid || index + 1}`,
          pfp_url: item.pfp_url,
          display_name: item.display_name,
        },
        top_tokens: topTokens,
      };
    });
  }
  return [];
}

function normalizeResponse(raw: any): LeaderboardResponse {
  const page = Number(raw?.page) || 1;
  return {
    page,
    page_size: Number(raw?.page_size ?? raw?.pageSize ?? raw?.limit) || PAGE_SIZE,
    total: Number(raw?.total ?? raw?.total_count ?? raw?.count) || 0,
    total_wallets: raw?.total_wallets ?? raw?.totalWallets,
    tokens_scanned: raw?.tokens_scanned ?? raw?.tokensScanned,
    tier_distribution: normalizeTierDistribution(raw?.tier_distribution ?? raw?.tierDistribution ?? raw?.tiers),
    rows: normalizeRows(raw?.rows ?? raw?.data ?? raw?.leaderboard ?? raw?.personas ?? raw?.results),
  };
}

export function useLeaderboard(params: LeaderboardParams) {
  const api = useApi();
  const page = params.page ?? 1;
  const offset = (page - 1) * PAGE_SIZE;

  const search = new URLSearchParams();
  search.set('limit', String(PAGE_SIZE));
  search.set('offset', String(offset));
  if (params.tier && params.tier !== 'all') {
    search.set('tier', params.tier.charAt(0).toUpperCase() + params.tier.slice(1));
  }

  return useQuery({
    queryKey: ['leaderboard', params.page, params.tier, api.walletAddress],
    queryFn: async () => {
      const raw = await api.get<any>(`/api/leaderboard?${search.toString()}`);
      return normalizeResponse({ ...raw, page, limit: PAGE_SIZE });
    },
  });
}
