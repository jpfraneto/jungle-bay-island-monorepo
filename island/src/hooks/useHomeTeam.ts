import { useCallback, useEffect, useState } from "react";

export interface HomeTeamBungalow {
  token_address: string;
  chain: string;
  name: string | null;
  symbol: string | null;
  holder_count: number;
  image_url: string | null;
  is_claimed: boolean | null;
  current_owner: string | null;
  description: string | null;
  market_cap: string | null;
  price_usd: string | null;
}

const SEEDED_HOME_TEAM: HomeTeamBungalow[] = [
  {
    token_address: "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b",
    chain: "base",
    name: "BNKR",
    symbol: "BNKR",
    holder_count: 0,
    image_url: null,
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "0x58d6e314755c2668f3d7358cc7a7a06c4314b238",
    chain: "base",
    name: "RIZZ",
    symbol: "RIZZ",
    holder_count: 0,
    image_url: null,
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "0x279e7cff2dbc93ff1f5cae6cbd072f98d75987ca",
    chain: "base",
    name: "TOWELI",
    symbol: "TOWELI",
    holder_count: 0,
    image_url: null,
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "0x2b5050f01d64fbb3e4ac44dc07f0732bfb5ecadf",
    chain: "base",
    name: "QR",
    symbol: "QR",
    holder_count: 0,
    image_url: null,
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d",
    chain: "base",
    name: "JBM",
    symbol: "JBM",
    holder_count: 0,
    image_url: null,
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "0x3ec2156d4c0a9cbdab4a016633b7bcf6a8d68ea2",
    chain: "base",
    name: "DRB",
    symbol: "DRB",
    holder_count: 0,
    image_url: null,
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "0x3d01fe5a38ddbd307fdd635b4cb0e29681226d6f",
    chain: "base",
    name: "ALPHA",
    symbol: "ALPHA",
    holder_count: 0,
    image_url: null,
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "0xd37264c71e9af940e49795f0d3a8336afaafdda9",
    chain: "ethereum",
    name: "JBC",
    symbol: "JBC",
    holder_count: 0,
    image_url: null,
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
];

interface BungalowsListResponse {
  items?: Array<{
    chain?: string;
    token_address?: string;
    name?: string | null;
    symbol?: string | null;
    holder_count?: number;
    image_url?: string | null;
  }>;
}

function normalizeBungalowsList(
  items: BungalowsListResponse["items"],
): HomeTeamBungalow[] {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item) => typeof item?.token_address === "string" && typeof item?.chain === "string")
    .map((item) => ({
      token_address: item.token_address as string,
      chain: item.chain as string,
      name: item.name ?? item.symbol ?? null,
      symbol: item.symbol ?? null,
      holder_count: Number.isFinite(item.holder_count) ? Number(item.holder_count) : 0,
      image_url: item.image_url ?? null,
      is_claimed: null,
      current_owner: null,
      description: null,
      market_cap: null,
      price_usd: null,
    }));
}

export function useHomeTeam() {
  const [bungalows, setBungalows] = useState<HomeTeamBungalow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHomeTeam = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/home-team", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const data = (await response.json()) as { bungalows?: HomeTeamBungalow[] };
      const homeTeam = Array.isArray(data.bungalows) ? data.bungalows : [];

      if (homeTeam.length > 0) {
        setBungalows(homeTeam);
        return;
      }

      const fallbackResponse = await fetch("/api/bungalows?limit=60", {
        cache: "no-store",
      });

      if (!fallbackResponse.ok) {
        setBungalows(SEEDED_HOME_TEAM);
        setError(null);
        return;
      }

      const fallbackData = (await fallbackResponse.json()) as BungalowsListResponse;
      const normalized = normalizeBungalowsList(fallbackData.items);

      if (normalized.length > 0) {
        setBungalows(normalized);
        setError(null);
        return;
      }

      setBungalows(SEEDED_HOME_TEAM);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load home team");
      setBungalows(SEEDED_HOME_TEAM);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHomeTeam();
  }, [fetchHomeTeam]);

  return {
    bungalows,
    isLoading,
    error,
    refetch: fetchHomeTeam,
  };
}
