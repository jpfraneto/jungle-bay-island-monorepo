import { useCallback, useEffect, useState } from "react";
import { SEEDED_HOME_TEAM } from "./useHomeTeam";

export interface BungalowDeployment {
  chain: string;
  token_address: string;
  route_path: string;
  name: string | null;
  symbol: string | null;
  decimals?: number | null;
  is_nft?: boolean;
  exists: boolean;
  is_claimed: boolean;
  is_verified: boolean;
  current_owner: string | null;
  description: string | null;
  origin_story: string | null;
  image_url: string | null;
  holder_count: number;
  total_supply: string | null;
  market_data: {
    price_usd: number | null;
    market_cap: number | null;
    volume_24h: number | null;
    liquidity_usd: number | null;
    updated_at: string | null;
  } | null;
  heat_stats?: {
    sample_size: number;
    top_50_average: number | null;
    top_50_stddev: number | null;
  };
  is_primary: boolean;
  is_active: boolean;
}

export interface CanonicalProjectSummary {
  id: string;
  slug: string | null;
  name: string | null;
  symbol: string | null;
  asset_count: number;
  chain_count: number;
  deployment_count: number;
  total_holder_count: number;
  primary_deployment: {
    chain: string;
    token_address: string;
  };
  active_deployment: {
    chain: string;
    token_address: string;
  };
}

export interface BungalowAsset {
  id: string;
  kind: "fungible_token" | "nft_collection";
  name: string;
  symbol: string | null;
  aggregate_holder_count: number;
  deployment_count: number;
  chain_count: number;
  is_primary: boolean;
  is_active: boolean;
  primary_deployment: {
    chain: string;
    token_address: string;
  };
  deployments: BungalowDeployment[];
}

export interface BungalowDetails {
  token_address: string;
  chain: string;
  name: string | null;
  symbol: string | null;
  decimals?: number | null;
  is_nft?: boolean;
  exists: boolean;
  is_claimed: boolean;
  is_verified: boolean;
  current_owner: string | null;
  description: string | null;
  image_url: string | null;
  holder_count: number;
  market_data: {
    price_usd: number | null;
    market_cap: number | null;
    volume_24h: number | null;
    liquidity_usd: number | null;
    updated_at: string | null;
  } | null;
  heat_stats?: {
    sample_size: number;
    top_50_average: number | null;
    top_50_stddev: number | null;
  };
  viewer_context?: {
    wallet: string;
    is_owner: boolean;
    holds_token: boolean;
    token_heat_degrees: number;
    island_heat: number;
    tier: string;
  };
  canonical_project?: CanonicalProjectSummary;
  assets?: BungalowAsset[];
  active_asset?: BungalowAsset | null;
  deployments?: BungalowDeployment[];
  active_deployment?: BungalowDeployment | null;
}

function isPlaceholderLabel(value: string | null | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === "unknown" ||
    normalized === "$unknown" ||
    normalized === "?" ||
    normalized === "token" ||
    normalized === "null"
  );
}

const SEEDED_BY_KEY = new Map(
  SEEDED_HOME_TEAM.map((item) => [
    `${item.chain}:${item.token_address.toLowerCase()}`,
    item,
  ]),
);

export function useBungalow(chain?: string, ca?: string) {
  const [bungalow, setBungalow] = useState<BungalowDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBungalow = useCallback(async () => {
    if (!chain || !ca) {
      setBungalow(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/bungalow/${chain}/${ca}`);
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const data = (await response.json()) as BungalowDetails;
      const seeded = SEEDED_BY_KEY.get(
        `${data.chain}:${data.token_address.toLowerCase()}`,
      );

      setBungalow({
        ...data,
        name: isPlaceholderLabel(data.name) ? seeded?.name ?? null : data.name,
        symbol: isPlaceholderLabel(data.symbol)
          ? seeded?.symbol ?? null
          : data.symbol,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bungalow");
      setBungalow(null);
    } finally {
      setIsLoading(false);
    }
  }, [ca, chain]);

  useEffect(() => {
    void fetchBungalow();
  }, [fetchBungalow]);

  return {
    bungalow,
    isLoading,
    error,
    refetch: fetchBungalow,
  };
}
