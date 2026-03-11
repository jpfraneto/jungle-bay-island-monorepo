import { useCallback, useEffect, useRef, useState } from "react";
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

interface UserWalletLinksCacheEntry {
  wallets: LinkedWallet[];
  fetchedAt: number;
  promise: Promise<LinkedWallet[]> | null;
}

const USER_WALLET_LINKS_CACHE_TTL_MS = 60_000;
const userWalletLinksCache = new Map<string, UserWalletLinksCacheEntry>();

function getUserWalletLinksCacheKey(userId: string | null | undefined): string {
  const trimmed = userId?.trim();
  return trimmed ? trimmed : "__pending_authenticated_user__";
}

function getUserWalletLinksCacheEntry(
  userId: string | null | undefined,
): UserWalletLinksCacheEntry | null {
  return userWalletLinksCache.get(getUserWalletLinksCacheKey(userId)) ?? null;
}

function ensureUserWalletLinksCacheEntry(
  userId: string | null | undefined,
): UserWalletLinksCacheEntry {
  const cacheKey = getUserWalletLinksCacheKey(userId);
  const existing = userWalletLinksCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const created: UserWalletLinksCacheEntry = {
    wallets: [],
    fetchedAt: 0,
    promise: null,
  };
  userWalletLinksCache.set(cacheKey, created);
  return created;
}

function isUserWalletLinksCacheFresh(
  entry: UserWalletLinksCacheEntry | null,
): boolean {
  if (!entry || entry.fetchedAt <= 0) {
    return false;
  }

  return Date.now() - entry.fetchedAt < USER_WALLET_LINKS_CACHE_TTL_MS;
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
  const { authenticated, getAccessToken, user } = usePrivy();
  const [wallets, setWallets] = useState<LinkedWallet[]>(
    () =>
      authenticated && enabled
        ? getUserWalletLinksCacheEntry(user?.id)?.wallets ?? []
        : [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeCacheKeyRef = useRef<string | null>(
    authenticated ? getUserWalletLinksCacheKey(user?.id) : null,
  );

  useEffect(() => {
    if (!enabled || !authenticated) {
      setWallets([]);
      setIsLoading(false);
      setError(null);
      activeCacheKeyRef.current = null;
      return;
    }

    activeCacheKeyRef.current = getUserWalletLinksCacheKey(user?.id);
    setError(null);
    setWallets(getUserWalletLinksCacheEntry(user?.id)?.wallets ?? []);
  }, [authenticated, enabled, user?.id]);

  const refetch = useCallback(async (options?: { force?: boolean }) => {
    if (!enabled || !authenticated) {
      setWallets([]);
      setIsLoading(false);
      setError(null);
      activeCacheKeyRef.current = null;
      return [];
    }

    const cacheKey = getUserWalletLinksCacheKey(user?.id);
    const cacheEntry = ensureUserWalletLinksCacheEntry(user?.id);
    const hasCachedWallets = cacheEntry.fetchedAt > 0;
    const useCachedWallets =
      !options?.force && isUserWalletLinksCacheFresh(cacheEntry);

    activeCacheKeyRef.current = cacheKey;
    setError(null);
    if (useCachedWallets) {
      setWallets(cacheEntry.wallets);
      setIsLoading(false);
      return cacheEntry.wallets;
    }

    if (hasCachedWallets) {
      setWallets(cacheEntry.wallets);
    } else {
      setWallets([]);
    }
    setIsLoading(!hasCachedWallets);

    let request =
      !options?.force && cacheEntry.promise ? cacheEntry.promise : null;

    try {
      if (!request) {
        request = (async () => {
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

          const normalizedWallets = normalizeWalletRows(data?.wallets);
          cacheEntry.wallets = normalizedWallets;
          cacheEntry.fetchedAt = Date.now();
          return normalizedWallets;
        })();
        cacheEntry.promise = request;
      }

      const nextWallets = await request;
      if (activeCacheKeyRef.current === cacheKey) {
        setWallets(nextWallets);
      }
      return nextWallets;
    } catch (err) {
      if (!hasCachedWallets && activeCacheKeyRef.current === cacheKey) {
        setWallets([]);
      }
      if (activeCacheKeyRef.current === cacheKey) {
        setError(err instanceof Error ? err.message : "Failed to load wallets");
      }
      throw err;
    } finally {
      if (cacheEntry.promise === request) {
        cacheEntry.promise = null;
      }
      if (activeCacheKeyRef.current === cacheKey) {
        setIsLoading(false);
      }
    }
  }, [authenticated, enabled, getAccessToken, user?.id]);

  useEffect(() => {
    void refetch().catch(() => undefined);
  }, [refetch]);

  return {
    wallets,
    isLoading,
    error,
    refetch,
  };
}
