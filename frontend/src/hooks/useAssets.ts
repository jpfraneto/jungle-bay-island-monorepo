import { useMutation, useQuery } from '@tanstack/react-query';
import { useApi } from './useApi';
import type { AssetCatalogItem, AssetPurchaseRecord } from '../lib/scene-types';
import type { AssetCatalogResponse, AssetPurchasePayload, AssetPurchaseResponse } from '../lib/types';

export function useAssetsCatalog() {
  const api = useApi();

  return useQuery({
    queryKey: ['assets-catalog'],
    queryFn: async (): Promise<AssetCatalogItem[]> => {
      const response = await api.get<AssetCatalogResponse>('/api/assets/catalog');
      return response.items;
    },
  });
}

export function usePurchaseAsset() {
  const api = useApi();

  return useMutation({
    mutationFn: async (payload: AssetPurchasePayload): Promise<AssetPurchaseRecord> => {
      const response = await api.post<AssetPurchaseResponse>('/api/assets/purchase', payload);
      return response.purchase;
    },
  });
}
