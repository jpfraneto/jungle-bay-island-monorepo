import { useCallback, useEffect, useState } from "react";

export interface ClaimableData {
  heat_degrees: number;
  claimable_jbm: string;
  last_claimed_at: string | null;
  can_claim: boolean;
  claimed_today?: boolean;
}

export function useClaimable(chain?: string, ca?: string, walletAddress?: string) {
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
      const response = await fetch(`/api/claims/${chain}/${ca}/${walletAddress}`);
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
  }, [ca, chain, walletAddress]);

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
