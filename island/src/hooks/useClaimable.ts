import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

export interface ClaimableData {
  heat_degrees: number;
  claimable_jbm: string;
  last_claimed_at: string | null;
  can_claim: boolean;
  claimed_today?: boolean;
}

export function useClaimable(chain?: string, ca?: string, walletAddress?: string) {
  const { authenticated, getAccessToken } = usePrivy();
  const [claimable, setClaimable] = useState<ClaimableData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchClaimable = useCallback(async () => {
    if (!chain || !ca || !walletAddress) {
      setClaimable(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {};
      if (authenticated) {
        const token = await getAccessToken();
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
      }

      const response = await fetch(`/api/claims/${chain}/${ca}/${walletAddress}`, {
        headers,
      });
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const data = (await response.json()) as ClaimableData;
      setClaimable(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load claimable rewards");
      setClaimable(null);
    } finally {
      setIsLoading(false);
    }
  }, [authenticated, ca, chain, getAccessToken, walletAddress]);

  useEffect(() => {
    void fetchClaimable();
  }, [fetchClaimable]);

  return {
    claimable,
    isLoading,
    error,
    refetch: fetchClaimable,
  };
}
