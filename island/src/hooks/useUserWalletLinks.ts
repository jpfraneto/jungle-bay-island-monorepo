import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

export interface LinkedWallet {
  id: string;
  address: string;
  source: string;
  linked_at: string;
}

interface WalletsResponse {
  wallets?: unknown[];
  error?: unknown;
}

function normalizeWalletRows(input: unknown): LinkedWallet[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((row) => {
      const item = row as {
        id?: unknown;
        address?: unknown;
        source?: unknown;
        linked_at?: unknown;
      };

      if (
        typeof item.id !== "string" ||
        typeof item.address !== "string" ||
        typeof item.source !== "string" ||
        typeof item.linked_at !== "string"
      ) {
        return null;
      }

      return {
        id: item.id,
        address: item.address,
        source: item.source,
        linked_at: item.linked_at,
      };
    })
    .filter((row): row is LinkedWallet => row !== null);
}

export function useUserWalletLinks(enabled = true) {
  const { authenticated, getAccessToken } = usePrivy();
  const [wallets, setWallets] = useState<LinkedWallet[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled || !authenticated) {
      setWallets([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {};
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch("/api/user/wallets", {
        headers,
        cache: "no-store",
      });

      const data = (await response.json().catch(() => null)) as
        | WalletsResponse
        | null;

      const apiError =
        typeof data?.error === "string" && data.error.trim().length > 0
          ? data.error
          : null;

      if (!response.ok) {
        throw new Error(apiError ?? `Request failed (${response.status})`);
      }

      setWallets(normalizeWalletRows(data?.wallets));
    } catch (err) {
      setWallets([]);
      setError(err instanceof Error ? err.message : "Failed to load wallets");
    } finally {
      setIsLoading(false);
    }
  }, [authenticated, enabled, getAccessToken]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    wallets,
    isLoading,
    error,
    refetch,
  };
}
