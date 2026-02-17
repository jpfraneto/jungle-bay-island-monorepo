import { useQuery } from '@tanstack/react-query';
import { useApi } from './useApi';
import type { BungalowResponse, Holder, Tier, TierCount } from '../lib/types';
import { tierFromHeat } from '../lib/heat';

function normalizeTier(raw: unknown): Tier {
  const value = String(raw ?? '').toLowerCase();
  if (value === 'elder' || value === 'builder' || value === 'resident' || value === 'observer' || value === 'drifter') {
    return value;
  }
  return 'drifter';
}

function normalizeTierDistribution(raw: unknown): TierCount[] {
  if (Array.isArray(raw)) return raw as TierCount[];
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw as Record<string, unknown>).map(([key, count]) => ({
    tier: normalizeTier(key.replace(/s$/, '')),
    count: Number(count) || 0,
  }));
}

function normalizeHolders(raw: unknown): Holder[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((holder, index) => {
    const item = (holder ?? {}) as Record<string, unknown>;
    const heat = Number(item.heat_degrees ?? 0) || 0;
    return {
      rank: index + 1,
      wallet: String(item.wallet ?? ''),
      heat_degrees: heat,
      tier: tierFromHeat(heat),
      farcaster: item.farcaster as Holder['farcaster'],
    };
  });
}

function normalizeBungalowResponse(raw: any): BungalowResponse {
  if (raw?.bungalow) return raw as BungalowResponse;

  const scanStatus = String(raw?.scan_status ?? 'not_scanned');
  const viewerContextRaw = raw?.viewer_context;

  return {
    bungalow: {
      chain: String(raw?.chain ?? 'base'),
      ca: String(raw?.token_address ?? ''),
      owner_wallet: raw?.current_owner ? String(raw.current_owner) : undefined,
      token_name: String(raw?.name ?? 'Unknown token'),
      token_symbol: String(raw?.symbol ?? ''),
      description: raw?.description ?? undefined,
      origin_story: raw?.origin_story ?? undefined,
      claimed: Boolean(raw?.is_claimed),
      verified: Boolean(raw?.is_verified),
      scanned: scanStatus === 'complete',
      scan_active: scanStatus === 'scanning',
      vitals: {
        total_supply: raw?.total_supply === null || raw?.total_supply === undefined ? undefined : String(raw.total_supply),
        holder_count: Number(raw?.holder_count ?? 0),
        dex_url: raw?.links?.dexscreener ?? undefined,
      },
      links: raw?.links ?? undefined,
      holders: normalizeHolders(raw?.holders),
      heat_distribution: normalizeTierDistribution(raw?.heat_distribution),
      image_url: raw?.image_url ?? undefined,
      market_data: raw?.market_data ?? undefined,
    },
    viewer_context: viewerContextRaw
        ? {
          wallet: String(viewerContextRaw.wallet ?? ''),
          is_owner: Boolean(viewerContextRaw.is_owner),
          holds_token: Boolean(viewerContextRaw.holds_token),
          token_heat_degrees:
            viewerContextRaw.token_heat_degrees ?? viewerContextRaw.heat_degrees ?? undefined,
          island_heat:
            viewerContextRaw.island_heat === null || viewerContextRaw.island_heat === undefined
              ? undefined
              : Number(viewerContextRaw.island_heat),
          tier: viewerContextRaw.tier ? normalizeTier(viewerContextRaw.tier) : undefined,
          scans_remaining:
            viewerContextRaw.scans_remaining ?? viewerContextRaw.scans_remaining_today ?? undefined,
        }
      : undefined,
  };
}

export function useBungalow(chain?: string, ca?: string) {
  const api = useApi();

  return useQuery({
    queryKey: ['bungalow', chain, ca, api.walletAddress],
    enabled: Boolean(chain && ca),
    queryFn: async () => normalizeBungalowResponse(await api.get<any>(`/api/bungalow/${chain}/${ca}`)),
  });
}
