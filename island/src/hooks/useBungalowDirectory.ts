import { useEffect, useState } from "react";
import {
  normalizeDirectoryBungalows,
  type DirectoryBungalow,
} from "../utils/bodega";

interface UseBungalowDirectoryOptions {
  walletAddress?: string | null;
  limit?: number;
  enabled?: boolean;
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
        const endpoint = hasWalletAddress
          ? `/api/address/${encodeURIComponent(walletAddress ?? "")}/bungalows`
          : `/api/bungalows?limit=${limit}`;
        const response = await fetch(endpoint, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }

        const data = (await response.json()) as unknown;

        // Wallet-scoped selectors use /api/address/:wallet/bungalows.
        // Views without a wallet keep using the public directory.
        setBungalows(
          normalizeDirectoryBungalows(
            hasWalletAddress
              ? data
              : (data as { items?: unknown[] } | null)?.items,
          ),
        );
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
  }, [enabled, limit, walletAddress]);

  return { bungalows, isLoading, error };
}
