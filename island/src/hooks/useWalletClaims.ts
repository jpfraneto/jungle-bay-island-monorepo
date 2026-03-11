import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

export interface WalletClaimItem {
  chain: string;
  token_address: string;
  token_name: string | null;
  token_symbol: string | null;
  heat_degrees: number;
  period_reward_jbm: string;
  claimable_jbm: string;
  claimable_wei: string;
  can_claim: boolean;
  claimed_today: boolean;
  last_claimed_at: string | null;
  claim_nonce: number | null;
  has_reservation: boolean;
  deadline: string | null;
}

export interface WalletClaimsData {
  payout_wallet: string | null;
  period_id: number;
  period_start_at: string;
  period_end_at: string;
  claimable_count: number;
  total_claimable_jbm: string;
  claimed_today_total_jbm: string;
  daily_cap_jbm: string;
  daily_distributed_jbm: string;
  daily_remaining_jbm: string;
  items: WalletClaimItem[];
}

interface WalletClaimsCacheEntry {
  claims: WalletClaimsData | null;
  fetchedAt: number;
  promise: Promise<WalletClaimsData> | null;
}

const WALLET_CLAIMS_CACHE_TTL_MS = 60_000;
const walletClaimsCache = new Map<string, WalletClaimsCacheEntry>();

function getWalletClaimsCacheKey(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
}

function getWalletClaimsCacheEntry(
  walletAddress?: string,
): WalletClaimsCacheEntry | null {
  if (!walletAddress) {
    return null;
  }

  return walletClaimsCache.get(getWalletClaimsCacheKey(walletAddress)) ?? null;
}

function ensureWalletClaimsCacheEntry(
  walletAddress: string,
): WalletClaimsCacheEntry {
  const cacheKey = getWalletClaimsCacheKey(walletAddress);
  const existing = walletClaimsCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const created: WalletClaimsCacheEntry = {
    claims: null,
    fetchedAt: 0,
    promise: null,
  };
  walletClaimsCache.set(cacheKey, created);
  return created;
}

function isWalletClaimsCacheFresh(entry: WalletClaimsCacheEntry | null): boolean {
  if (!entry?.claims || entry.fetchedAt <= 0) {
    return false;
  }

  return Date.now() - entry.fetchedAt < WALLET_CLAIMS_CACHE_TTL_MS;
}

export function useWalletClaims(walletAddress?: string) {
  const { authenticated, getAccessToken } = usePrivy();
  const [claims, setClaims] = useState<WalletClaimsData | null>(
    () => getWalletClaimsCacheEntry(walletAddress)?.claims ?? null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousWalletRef = useRef<string | undefined>(undefined);
  const activeWalletKeyRef = useRef<string | null>(
    walletAddress ? getWalletClaimsCacheKey(walletAddress) : null,
  );

  useEffect(() => {
    if (!walletAddress) {
      setClaims(null);
      setError(null);
      setIsLoading(false);
      previousWalletRef.current = undefined;
      activeWalletKeyRef.current = null;
      return;
    }

    const cachedClaims = getWalletClaimsCacheEntry(walletAddress)?.claims ?? null;
    activeWalletKeyRef.current = getWalletClaimsCacheKey(walletAddress);
    setError(null);
    setClaims(cachedClaims);
  }, [walletAddress]);

  const fetchClaims = useCallback(
    async (options?: { force?: boolean }) => {
      if (!walletAddress) {
        setClaims(null);
        setError(null);
        setIsLoading(false);
        previousWalletRef.current = undefined;
        activeWalletKeyRef.current = null;
        return;
      }

      const cacheKey = getWalletClaimsCacheKey(walletAddress);
      const cacheEntry = ensureWalletClaimsCacheEntry(walletAddress);
      const cachedClaims = cacheEntry.claims;
      const hasCachedClaims = Boolean(cachedClaims);
      const useCachedClaims =
        !options?.force && isWalletClaimsCacheFresh(cacheEntry);
      const previousWallet = previousWalletRef.current;
      const walletChanged =
        !previousWallet ||
        previousWallet.toLowerCase() !== walletAddress.toLowerCase();

      previousWalletRef.current = walletAddress;
      activeWalletKeyRef.current = cacheKey;
      setError(null);
      if (useCachedClaims) {
        setClaims(cachedClaims);
        setIsLoading(false);
        return cachedClaims;
      }

      if (walletChanged && !hasCachedClaims) {
        setClaims(null);
      }
      if (hasCachedClaims) {
        setClaims(cachedClaims);
      }
      setIsLoading(!hasCachedClaims);

      let request =
        !options?.force && cacheEntry.promise ? cacheEntry.promise : null;

      try {
        if (!request) {
          request = (async () => {
            const headers: Record<string, string> = {};
            if (authenticated) {
              const token = await getAccessToken();
              if (token) {
                headers.Authorization = `Bearer ${token}`;
              }
            }

            const response = await fetch(`/api/claims/wallet/${walletAddress}`, {
              headers,
            });
            if (!response.ok) {
              throw new Error(`Request failed (${response.status})`);
            }

            const data = (await response.json()) as WalletClaimsData;
            cacheEntry.claims = data;
            cacheEntry.fetchedAt = Date.now();
            return data;
          })();
          cacheEntry.promise = request;
        }

        const data = await request;
        if (activeWalletKeyRef.current === cacheKey) {
          setClaims(data);
        }
        return data;
      } catch (err) {
        if (activeWalletKeyRef.current === cacheKey) {
          setError(
            err instanceof Error ? err.message : "Failed to load wallet rewards",
          );
        }
        if (
          walletChanged &&
          !hasCachedClaims &&
          activeWalletKeyRef.current === cacheKey
        ) {
          setClaims(null);
        }
        throw err;
      } finally {
        if (cacheEntry.promise === request) {
          cacheEntry.promise = null;
        }
        if (activeWalletKeyRef.current === cacheKey) {
          setIsLoading(false);
        }
      }
    },
    [authenticated, getAccessToken, walletAddress],
  );

  useEffect(() => {
    void fetchClaims().catch(() => undefined);
  }, [fetchClaims]);

  return {
    claims,
    isLoading,
    error,
    refetch: fetchClaims,
  };
}
