import { useCallback, useEffect, useState } from "react";

export interface ResolvedBungalowTarget {
  found: boolean;
  identifier: string;
  identifier_type: "slug" | "address";
  canonical_slug: string | null;
  chain: string;
  token_address: string;
  canonical_path: string;
}

export function useBungalowResolver(
  identifier?: string,
  preferredChain?: string,
) {
  const [target, setTarget] = useState<ResolvedBungalowTarget | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(identifier));
  const [error, setError] = useState<string | null>(null);

  const resolveTarget = useCallback(async () => {
    if (!identifier) {
      setTarget(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (preferredChain) {
        params.set("chain", preferredChain);
      }
      const query = params.toString();
      const response = await fetch(
        `/api/bungalow/resolve/${encodeURIComponent(identifier)}${
          query ? `?${query}` : ""
        }`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const data = (await response.json()) as ResolvedBungalowTarget;
      setTarget(data);
    } catch (err) {
      setTarget(null);
      setError(
        err instanceof Error ? err.message : "Failed to resolve bungalow",
      );
    } finally {
      setIsLoading(false);
    }
  }, [identifier, preferredChain]);

  useEffect(() => {
    void resolveTarget();
  }, [resolveTarget]);

  return {
    target,
    isLoading,
    error,
    refetch: resolveTarget,
  };
}
