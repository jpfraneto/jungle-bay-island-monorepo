import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './useApi';
import type { BulletinResponse } from '../lib/types';

export function useBulletin(chain: string, ca: string) {
  const api = useApi();
  const queryClient = useQueryClient();

  const bulletinQuery = useQuery({
    queryKey: ['bulletin', chain, ca],
    enabled: Boolean(chain && ca),
    queryFn: () => api.get<BulletinResponse>(`/api/bungalow/${chain}/${ca}/bulletin`),
  });

  const createPost = useMutation({
    mutationFn: async (input: { content: string; image_url?: string }) =>
      api.post(`/api/bungalow/${chain}/${ca}/bulletin`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bulletin', chain, ca] });
    },
  });

  return {
    bulletinQuery,
    createPost,
  };
}
