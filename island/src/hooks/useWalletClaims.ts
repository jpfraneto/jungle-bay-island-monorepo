import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

export interface WalletClaimItem {
  chain: string;
  token_address: string;
  token_name: string | null;
  token_symbol: string | null;
  heat_degrees: number;
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
  daily_cap_jbm: string;
  daily_distributed_jbm: string;
  daily_remaining_jbm: string;
  items: WalletClaimItem[];
}

export function useWalletClaims(walletAddress?: string) {
  const { authenticated, getAccessToken } = usePrivy();
  const [claims, setClaims] = useState<WalletClaimsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchClaims = useCallback(async () => {
    if (!walletAddress) {
      setClaims(null);
      setError(null);
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

      const response = await fetch(`/api/claims/wallet/${walletAddress}`, {
        headers,
      });
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const data = (await response.json()) as WalletClaimsData;
      setClaims(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load wallet rewards");
      setClaims(null);
    } finally {
      setIsLoading(false);
    }
  }, [authenticated, getAccessToken, walletAddress]);

  useEffect(() => {
    void fetchClaims();
  }, [fetchClaims]);

  return {
    claims,
    isLoading,
    error,
    refetch: fetchClaims,
  };
}
