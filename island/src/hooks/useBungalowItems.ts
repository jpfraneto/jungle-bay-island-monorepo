import { useCallback, useEffect, useState } from "react";
import type { WallItemType } from "../utils/constants";

export interface BungalowItem {
  id: number;
  token_address: string;
  chain: string;
  item_type: WallItemType;
  content: Record<string, unknown>;
  placed_by: string;
  tx_hash: string;
  jbm_amount: string;
  created_at: string;
}

export function useBungalowItems(chain?: string, ca?: string) {
  const [items, setItems] = useState<BungalowItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!chain || !ca) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/bungalow/${chain}/${ca}/items`);
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const data = (await response.json()) as { items?: BungalowItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load wall items");
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [ca, chain]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  return {
    items,
    isLoading,
    error,
    refetch: fetchItems,
  };
}
