import { useCallback, useEffect, useState } from "react";
export interface BungalowItem {
  id: number;
  token_address: string;
  chain: string;
  item_type:
    | "link"
    | "frame"
    | "image"
    | "portal"
    | "decoration"
    | "miniapp"
    | "game";
  content: Record<string, unknown>;
  placed_by: string;
  placed_by_heat_degrees: number | null;
  tx_hash: string;
  jbm_amount: string;
  source?: "legacy" | "bodega";
  catalog_item_id?: number | null;
  install_count?: number;
  created_at: string;
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

function normalizeItems(input: unknown): BungalowItem[] {
  if (!Array.isArray(input)) return [];

  return input.map((raw) => {
    const item = raw as BungalowItem;
    const parsedHeat = Number(
      (item as unknown as { placed_by_heat_degrees?: string | number | null }).placed_by_heat_degrees ?? NaN,
    );

    return {
      ...item,
      content: normalizeContent(item.content),
      placed_by_heat_degrees: Number.isFinite(parsedHeat) ? parsedHeat : null,
      install_count: Number(
        (item as unknown as { install_count?: string | number | null }).install_count ??
          0,
      ),
    };
  });
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
      setItems(normalizeItems(data.items));
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
