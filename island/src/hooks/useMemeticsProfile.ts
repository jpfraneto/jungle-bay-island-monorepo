import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { MemeticsMeResponse } from "../utils/memetics";

export function useMemeticsProfile(enabled = true) {
  const { authenticated, getAccessToken } = usePrivy();
  const [data, setData] = useState<MemeticsMeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(enabled && authenticated);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled || !authenticated) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {};
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch("/api/memetics/me", {
        headers,
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | (MemeticsMeResponse & { error?: string })
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed (${response.status})`);
      }

      setData(payload);
      return payload;
    } catch (fetchError) {
      const message =
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to load onchain profile";
      setError(message);
      throw fetchError;
    } finally {
      setIsLoading(false);
    }
  }, [authenticated, enabled, getAccessToken]);

  useEffect(() => {
    void refetch().catch(() => undefined);
  }, [refetch]);

  return {
    data,
    isLoading,
    error,
    refetch,
  };
}
