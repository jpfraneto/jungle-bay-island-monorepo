import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './useApi';
import type {
  InstalledWidgetsResponse,
  WidgetCatalogItem,
  WidgetCatalogResponse,
  WidgetInstallRecord,
} from '../lib/types';

interface InstallWidgetResponse {
  install: WidgetInstallRecord;
  install_command: string;
  repo_steps: string[];
}

export function useWidgetCatalog(chain: string, ca: string) {
  const api = useApi();

  return useQuery({
    queryKey: ['widget-catalog', chain, ca],
    enabled: Boolean(chain && ca),
    queryFn: async (): Promise<WidgetCatalogItem[]> => {
      const response = await api.get<WidgetCatalogResponse>(`/api/bungalow/${chain}/${ca}/widgets/catalog`);
      return response.items;
    },
  });
}

export function useInstalledWidgets(chain: string, ca: string) {
  const api = useApi();

  return useQuery({
    queryKey: ['installed-widgets', chain, ca],
    enabled: Boolean(chain && ca),
    queryFn: () => api.get<InstalledWidgetsResponse>(`/api/bungalow/${chain}/${ca}/widgets`),
  });
}

export function useInstallWidget(chain: string, ca: string) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { widget_id: string; repo_url?: string }) =>
      api.post<InstallWidgetResponse>(`/api/bungalow/${chain}/${ca}/widgets/install`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['installed-widgets', chain, ca] });
    },
  });
}
