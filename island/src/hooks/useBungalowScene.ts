import { useState, useEffect, useCallback } from "react";
import type { SceneConfig, DecorationConfig } from "../types/scene";

export function useBungalowScene(chain: string | undefined, ca: string | undefined) {
  const [scene, setScene] = useState<SceneConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!chain || !ca) {
      setScene(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/bungalow/${chain}/${ca}/scene`);
      const data = (await response.json()) as { scene?: SceneConfig };
      setScene(data.scene ?? null);
    } catch (fetchError: unknown) {
      setScene(null);
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to load bungalow scene",
      );
    } finally {
      setLoading(false);
    }
  }, [ca, chain]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const updateSlot = useCallback(
    async (
      slotId: string,
      decoration: Omit<DecorationConfig, "placedAt">,
      authToken: string,
    ) => {
      if (!chain || !ca) return;
      const res = await fetch(`/api/bungalow/${chain}/${ca}/scene`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          slotId,
          decoration: {
            ...decoration,
            placedAt: new Date().toISOString(),
          },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { scene: SceneConfig };
      setScene(data.scene);
      return data.scene as SceneConfig;
    },
    [chain, ca],
  );

  return { scene, loading, error, updateSlot, refetch };
}
