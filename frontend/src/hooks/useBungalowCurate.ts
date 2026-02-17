import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from './useApi';

interface CurateFields {
  description?: string | null;
  origin_story?: string | null;
  link_x?: string | null;
  link_farcaster?: string | null;
  link_telegram?: string | null;
  link_website?: string | null;
}

export function useBungalowCurate(chain: string, ca: string) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fields: CurateFields) =>
      api.put<{ ok: boolean }>(`/api/bungalow/${chain}/${ca}/curate`, fields),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bungalow', chain, ca] });
    },
  });
}
