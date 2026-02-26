import { useCallback, useEffect, useState } from "react";

export interface BungalowDetails {
  token_address: string;
  chain: string;
  name: string | null;
  symbol: string;
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
}

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
      setBungalow(data);
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
