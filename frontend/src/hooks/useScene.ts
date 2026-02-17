import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './useApi';
import type { SceneConfig, DecorationConfig } from '../lib/scene-types';
import type { SceneResponse } from '../lib/types';

const memorySceneCache = new Map<string, SceneConfig>();

export interface SaveSceneSlotPayload {
  chain: string;
  ca: string;
  slotId: string;
  decoration: DecorationConfig;
}

function createEmptyScene(chain: string, ca: string): SceneConfig {
  return {
    version: '1.0',
    bungalowId: `${chain}:${ca}`,
    slots: [],
  };
}

function localSceneKey(chain: string, ca: string): string {
  return `scene-cache:${chain}:${ca.toLowerCase()}`;
}

function readLocalScene(chain: string, ca: string): SceneConfig | null {
  const key = localSceneKey(chain, ca);
  const inMemory = memorySceneCache.get(key);
  if (inMemory) return inMemory;

  if (typeof window === 'undefined') return null;

  try {
    const value = window.localStorage.getItem(key);
    if (!value) return null;
    const parsed = JSON.parse(value) as SceneConfig;
    if (!parsed || !Array.isArray(parsed.slots)) return null;
    memorySceneCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalScene(chain: string, ca: string, scene: SceneConfig): void {
  const key = localSceneKey(chain, ca);
  memorySceneCache.set(key, scene);

  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(key, JSON.stringify(scene));
  } catch {
    // Storage can be blocked in private browsing; ignore.
  }
}

function inferSlotType(slotId: string): 'wall-frame' | 'shelf' | 'portal' | 'floor' | 'link' {
  if (slotId.includes('portal')) return 'portal';
  if (slotId.includes('shelf')) return 'shelf';
  if (slotId.includes('floor')) return 'floor';
  if (slotId.includes('link')) return 'link';
  return 'wall-frame';
}

function applyDecoration(
  scene: SceneConfig | undefined,
  chain: string,
  ca: string,
  slotId: string,
  decoration: DecorationConfig,
): SceneConfig {
  const base = scene ?? createEmptyScene(chain, ca);
  const slotType = inferSlotType(slotId);
  const slotIndex = base.slots.findIndex((slot) => slot.slotId === slotId);

  if (slotIndex === -1) {
    return {
      ...base,
      slots: [
        ...base.slots,
        {
          slotId,
          slotType,
          position: [0, 1.8, -3],
          rotation: [0, 0, 0],
          filled: true,
          decoration,
        },
      ],
    };
  }

  return {
    ...base,
    slots: base.slots.map((slot) =>
      slot.slotId === slotId
        ? {
            ...slot,
            filled: true,
            decoration,
          }
        : slot,
    ),
  };
}

export function useScene(chain?: string, ca?: string) {
  const api = useApi();

  return useQuery({
    queryKey: ['scene', chain, ca],
    enabled: Boolean(chain && ca),
    queryFn: async (): Promise<SceneConfig> => {
      if (!chain || !ca) {
        return createEmptyScene('base', 'unknown');
      }

      try {
        const response = await api.get<SceneResponse>(`/api/bungalow/${chain}/${ca}/scene`);
        writeLocalScene(chain, ca, response.scene);
        return response.scene;
      } catch {
        const fallback = readLocalScene(chain, ca);
        if (fallback) return fallback;
        return createEmptyScene(chain, ca);
      }
    },
  });
}

export function useSaveSceneSlot() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ chain, ca, slotId, decoration }: SaveSceneSlotPayload): Promise<SceneConfig> => {
      const queryKey = ['scene', chain, ca] as const;
      const current = queryClient.getQueryData<SceneConfig>(queryKey);
      const localCandidate = applyDecoration(current, chain, ca, slotId, decoration);

      try {
        const response = await api.put<SceneResponse>(`/api/bungalow/${chain}/${ca}/scene`, {
          slotId,
          decoration,
        });
        writeLocalScene(chain, ca, response.scene);
        return response.scene;
      } catch {
        writeLocalScene(chain, ca, localCandidate);
        return localCandidate;
      }
    },
    onSuccess: (scene, { chain, ca }) => {
      queryClient.setQueryData(['scene', chain, ca], scene);
    },
  });
}
