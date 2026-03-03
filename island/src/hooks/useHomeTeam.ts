import { useCallback, useEffect, useState } from "react";

export interface HomeTeamBungalow {
  token_address: string;
  chain: string;
  canonical_slug?: string | null;
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

export const SEEDED_HOME_TEAM: HomeTeamBungalow[] = [
  {
    token_address: "0xd37264c71e9af940e49795f0d3a8336afaafdda9",
    chain: "ethereum",
    name: "Jungle Bay Collection",
    symbol: "JBAC",
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
    name: "Jungle Bay Memes",
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
    token_address: "0x570b1533f6daa82814b25b62b5c7c4c55eb83947",
    chain: "base",
    name: "BOBO",
    symbol: "BOBO",
    holder_count: 0,
    image_url: null,
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "0xb90b2a35c65dbc466b04240097ca756ad2005295",
    chain: "ethereum",
    name: "BOBO",
    symbol: "BOBO",
    holder_count: 0,
    image_url: null,
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "8NNXWrWVctNw1UFeaBypffimTdcLCcD8XJzHvYsmgwpF",
    chain: "solana",
    name: "BRAINLET",
    symbol: "BRAINLET",
    holder_count: 0,
    image_url: null,
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "0xe3086852a4b125803c815a158249ae468a3254ca",
    chain: "base",
    name: "mfer",
    symbol: "MFER",
    holder_count: 0,
    image_url: null,
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
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
    token_address: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
    chain: "ethereum",
    name: "PEPE",
    symbol: "PEPE",
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
    token_address: "5ad4puH6yDBoeCcrQfwV5s9bxvPnAeWDoYDj3uLyBS8k",
    chain: "solana",
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
    token_address: "0x3ec2156d4c0a9cbdab4a016633b7bcf6a8d68ea2",
    chain: "base",
    name: "DebtReliefBot",
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
    token_address: "0x420698cfdeddea6bc78d59bc17798113ad278f9d",
    chain: "ethereum",
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
];

interface BungalowsListResponse {
  items?: Array<{
    chain?: string;
    token_address?: string;
    canonical_slug?: string | null;
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
      canonical_slug: item.canonical_slug ?? null,
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

function isPlaceholderLabel(value: string | null | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === "unknown" ||
    normalized === "?" ||
    normalized === "token" ||
    normalized === "null"
  );
}

function mergeWithSeededFallback(items: HomeTeamBungalow[]): HomeTeamBungalow[] {
  const fallbackByKey = new Map<string, HomeTeamBungalow>();
  for (const seeded of SEEDED_HOME_TEAM) {
    fallbackByKey.set(`${seeded.chain}:${seeded.token_address.toLowerCase()}`, seeded);
  }

  return items.map((item) => {
    const fallback = fallbackByKey.get(`${item.chain}:${item.token_address.toLowerCase()}`);
    if (!fallback) return item;

    return {
      ...item,
      name: isPlaceholderLabel(item.name) ? fallback.name : item.name,
      symbol: isPlaceholderLabel(item.symbol) ? fallback.symbol : item.symbol,
    };
  });
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
        setBungalows(mergeWithSeededFallback(homeTeam));
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
        setBungalows(mergeWithSeededFallback(normalized));
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
