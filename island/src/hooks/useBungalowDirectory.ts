import { useEffect, useState } from "react";
import {
  normalizeDirectoryBungalows,
  type DirectoryBungalow,
} from "../utils/bodega";

interface UseBungalowDirectoryOptions {
  walletAddress?: string | null;
  limit?: number;
  enabled?: boolean;
  fetchAll?: boolean;
}

interface UseBungalowDirectoryResult {
  bungalows: DirectoryBungalow[];
  isLoading: boolean;
  error: string | null;
}

export function useBungalowDirectory(
  options: UseBungalowDirectoryOptions = {},
): UseBungalowDirectoryResult {
  const {
    walletAddress = null,
    limit = 200,
    enabled = true,
    fetchAll = false,
  } = options;
  const [bungalows, setBungalows] = useState<DirectoryBungalow[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setBungalows([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        const hasWalletAddress = Boolean(walletAddress?.trim());
        if (hasWalletAddress) {
          const endpoint = `/api/address/${encodeURIComponent(walletAddress ?? "")}/bungalows`;
          const response = await fetch(endpoint, {
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(`Request failed (${response.status})`);
          }

          const data = (await response.json()) as unknown;
          setBungalows(normalizeDirectoryBungalows(data));
          return;
        }

        const pageSize = Math.min(Math.max(limit, 1), 200);
        const allItems: unknown[] = [];
        let offset = 0;
        let total = Number.POSITIVE_INFINITY;

        while (!controller.signal.aborted && offset < total) {
          const endpoint = `/api/bungalows?limit=${pageSize}&offset=${offset}`;
          const response = await fetch(endpoint, {
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(`Request failed (${response.status})`);
          }

          const data = (await response.json()) as
            | { items?: unknown[]; total?: unknown }
            | null;
          const pageItems = Array.isArray(data?.items) ? data.items : [];
          allItems.push(...pageItems);

          const parsedTotal = Number(data?.total ?? pageItems.length);
          total =
            Number.isFinite(parsedTotal) && parsedTotal > 0
              ? parsedTotal
              : allItems.length;

          if (!fetchAll || pageItems.length < pageSize) {
            break;
          }

          offset += pageSize;
        }

        const normalized = normalizeDirectoryBungalows(allItems);
        const deduped = new Map<string, DirectoryBungalow>();
        for (const bungalow of normalized) {
          deduped.set(
            `${bungalow.chain}:${bungalow.token_address.toLowerCase()}`,
            bungalow,
          );
        }
        setBungalows([...deduped.values()]);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error
            ? err.message
            : walletAddress
              ? "Failed to load your bungalows"
              : "Failed to load bungalow directory",
        );
        setBungalows([]);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [enabled, fetchAll, limit, walletAddress]);

  return { bungalows, isLoading, error };
}
