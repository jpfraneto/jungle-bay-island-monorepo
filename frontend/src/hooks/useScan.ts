import { useMutation, useQuery } from '@tanstack/react-query';
import { useApi } from './useApi';
import type { ScanCreateResponse, ScanStatusResponse } from '../lib/types';

export function useScan(chain: string, ca: string, scanId?: string) {
  const api = useApi();

  const createScan = useMutation({
    mutationFn: async () => api.post<ScanCreateResponse>(`/api/scan/${chain}/${ca}`),
  });

  const statusQuery = useQuery({
    queryKey: ['scan-status', scanId, api.walletAddress],
    enabled: Boolean(scanId),
    queryFn: () => api.get<ScanStatusResponse>(`/api/scan/${scanId}/status`),
    refetchInterval: (query) =>
      query.state.data?.status === 'completed' || query.state.data?.status === 'failed' ? false : 2000,
  });

  return {
    createScan,
    statusQuery,
  };
}
