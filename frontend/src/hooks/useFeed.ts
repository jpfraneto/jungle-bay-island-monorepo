import { useQuery } from '@tanstack/react-query';
import { useApi } from './useApi';
import type { BulletinPost } from '../lib/types';

interface FeedResponse {
  posts: BulletinPost[];
  total: number;
}

export function useFeed(limit = 20, offset = 0) {
  const api = useApi();

  return useQuery({
    queryKey: ['global-feed', limit, offset],
    queryFn: () => api.get<FeedResponse>(`/api/feed?limit=${limit}&offset=${offset}`),
    staleTime: 30_000,
  });
}
