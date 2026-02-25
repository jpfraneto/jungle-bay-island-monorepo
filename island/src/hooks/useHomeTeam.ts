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
    token_address: "0x2b5050f01d64fbb3e4ac44dc07f0732bfb5ecadf",
    chain: "base",
    name: "QR coin",
    symbol: "QR",
    holder_count: 140790,
    image_url: "https://cdn.dexscreener.com/cms/images/cb1ef7f414ce126c315d62988bf341b930d46733faee18eb4bb1f8ccff9f2c8f?width=800&height=800&quality=90",
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "0xe3086852a4b125803c815a158249ae468a3254ca",
    chain: "base",
    name: "mfercoin",
    symbol: "$mfer",
    holder_count: 134856,
    image_url: "https://cdn.dexscreener.com/cms/images/0f6a2a2bab359b6b098bcf82a676bba330d48ac38644ceb11fc7679f7c8d8a18?width=800&height=800&quality=90",
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
    holder_count: 95657,
    image_url: "https://cdn.dexscreener.com/cms/images/933f90e3132e6bf22153efc75938b732f0f1dc3a2fc2d9dbff614fe60ddf95b6?width=800&height=800&quality=90",
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "0x9f86db9fc6f7c9408e8fda3ff8ce4e78ac7a6b07",
    chain: "base",
    name: "clawd.atg.eth",
    symbol: "CLAWD",
    holder_count: 21665,
    image_url: "https://cdn.dexscreener.com/cms/images/-Rgo829S-B3_ZVNX?width=800&height=800&quality=90",
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "0xf30bf00edd0c22db54c9274b90d2a4c21fc09b07",
    chain: "base",
    name: "FELIX",
    symbol: "FELIX",
    holder_count: 9111,
    image_url: "https://cdn.dexscreener.com/cms/images/7680887c680187bf4dc86d0fd8c23f4e3db7a8304bdac81eeb8191800cc9e1d4?width=800&height=800&quality=90",
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
    holder_count: 8931,
    image_url: "https://cdn.dexscreener.com/cms/images/3857ad508b599c90ee7a35f341d96c8035d186a7abe43883178283f540769134?width=800&height=800&quality=90",
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "0x4e6c9f48f73e54ee5f3ab7e2992b2d733d0d0b07",
    chain: "base",
    name: "Juno Agent",
    symbol: "JUNO",
    holder_count: 7379,
    image_url: "https://cdn.dexscreener.com/cms/images/527e8043c8851064cf9a874a58ab1a290ab8b441370a36ee186cb20d7f7bbb88?width=800&height=800&quality=90",
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "0x3d01fe5a38ddbd307fdd635b4cb0e29681226d6f",
    chain: "base",
    name: "Alpha",
    symbol: "ALPHA",
    holder_count: 5765,
    image_url: "https://cdn.dexscreener.com/cms/images/f98d26ae0596db192f20e18b2fbd661494df4682c8ace93dd6dd84e884c19953?width=800&height=800&quality=90",
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "8NNXWrWVctNw1UFeaBypffimTdcLCcD8XJzHvYsmgwpF",
    chain: "solana",
    name: "Brainlet",
    symbol: "BRAINLET",
    holder_count: 2666,
    image_url: "https://cdn.dexscreener.com/cms/images/0a2c499e8fe3db005ff62b125901113007d947af30529dcd1287672ae70896ff?width=800&height=800&quality=90",
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "AWGCDT2gd8JadbYbYyZy1iKxfWokPNgrEQoU24zUpump",
    chain: "solana",
    name: "CLUDE",
    symbol: "Clude",
    holder_count: 2593,
    image_url: "https://cdn.dexscreener.com/cms/images/u3KkWN5ED0uAmCb2?width=800&height=800&quality=90",
    is_claimed: null,
    current_owner: null,
    description: null,
    market_cap: null,
    price_usd: null,
  },
  {
    token_address: "0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d",
    chain: "base",
    name: "jungle bay memes",
    symbol: "jungle bay memes",
    holder_count: 1932,
    image_url: "https://cdn.dexscreener.com/cms/images/7cc02a691d687c5eb0eb3adb7652f6a5772ad372bc340ed87471fbf39d6e1914?width=800&height=800&quality=90",
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
