import { useQuery } from '@tanstack/react-query';
import { useApi } from './useApi';

export interface BungalowDirectoryItem {
  chain: string;
  ca: string;
  token_name: string;
  token_symbol: string;
  holder_count?: number;
  claimed?: boolean;
  scanned?: boolean;
}

interface BungalowDirectoryResponse {
  items: BungalowDirectoryItem[];
  total: number;
}

function normalizeDirectory(raw: any): BungalowDirectoryResponse {
  const rows = Array.isArray(raw?.bungalows)
    ? raw.bungalows
    : Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw)
        ? raw
        : [];

  const items = rows
    .map((row: any, index: number) => {
      const chain = row.chain || row.network || 'base';
      const ca = row.ca || row.token_address || row.address;
      if (!ca) return null;

      return {
        chain,
        ca,
        token_name: row.token_name || row.name || `Token ${index + 1}`,
        token_symbol: row.token_symbol || row.symbol || 'UNK',
        holder_count: row.holder_count !== undefined ? Number(row.holder_count) || 0 : undefined,
        claimed: row.claimed !== undefined ? Boolean(row.claimed) : undefined,
        scanned: row.scanned !== undefined ? Boolean(row.scanned) : undefined,
      } as BungalowDirectoryItem;
    })
    .filter((item: BungalowDirectoryItem | null): item is BungalowDirectoryItem => Boolean(item));

  return {
    items,
    total: Number(raw?.total) || items.length,
  };
}

export function useBungalows(limit = 200, offset = 0) {
  const api = useApi();

  const search = new URLSearchParams();
  search.set('limit', String(limit));
  search.set('offset', String(offset));

  return useQuery({
    queryKey: ['bungalows-directory', limit, offset, api.walletAddress],
    queryFn: async () => normalizeDirectory(await api.get<any>(`/api/bungalows?${search.toString()}`)),
  });
}
