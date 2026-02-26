import { useCallback, useEffect, useState } from "react";
import type { WallItemType } from "../utils/constants";

export interface AddressContributionItem {
  id: number;
  token_address: string;
  chain: string;
  bungalow_name: string | null;
  bungalow_symbol: string | null;
  bungalow_image_url: string | null;
  item_type: WallItemType;
  content: Record<string, unknown>;
  placed_by: string;
  placed_by_heat_degrees: number | null;
  tx_hash: string;
  jbm_amount: string;
  created_at: string;
}

export interface AddressProfile {
  wallet: string;
  island_heat: number;
  tier: string;
  x_username?: string | null;
  wallet_map_summary?: {
    total_wallets: number;
    evm_wallets: number;
    solana_wallets: number;
    farcaster_verified_wallets: number;
  } | null;
  farcaster: {
    fid: number | null;
    username: string | null;
    display_name: string | null;
    pfp_url: string | null;
  } | null;
}

function normalizeContent(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function normalizeItems(input: unknown): AddressContributionItem[] {
  if (!Array.isArray(input)) return [];

  return input.map((raw) => {
    const item = raw as AddressContributionItem;
    const parsedHeat = Number(
      (
        item as unknown as {
          placed_by_heat_degrees?: string | number | null;
        }
      ).placed_by_heat_degrees ?? NaN,
    );

    return {
      ...item,
      content: normalizeContent(item.content),
      placed_by_heat_degrees: Number.isFinite(parsedHeat) ? parsedHeat : null,
    };
  });
}

export function useAddressProfile(walletAddress?: string) {
  const [profile, setProfile] = useState<AddressProfile | null>(null);
  const [items, setItems] = useState<AddressContributionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!walletAddress) {
      setProfile(null);
      setItems([]);
      setTotal(0);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const encodedWallet = encodeURIComponent(walletAddress);
      const [profileResponse, itemsResponse] = await Promise.all([
        fetch(`/api/wallet/${encodedWallet}?aggregate=true`),
        fetch(`/api/address/${encodedWallet}/items?limit=200`),
      ]);

      if (!itemsResponse.ok) {
        throw new Error(`Failed to load profile feed (${itemsResponse.status})`);
      }

      const itemsData = (await itemsResponse.json()) as {
        items?: AddressContributionItem[];
        total?: number;
      };

      setItems(normalizeItems(itemsData.items));
      setTotal(Number(itemsData.total ?? 0));

      if (profileResponse.ok) {
        const profileData = (await profileResponse.json()) as AddressProfile;
        setProfile(profileData);
      } else {
        setProfile(null);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load address profile",
      );
      setProfile(null);
      setItems([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return {
    profile,
    items,
    total,
    isLoading,
    error,
    refetch: fetchData,
  };
}
