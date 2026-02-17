import { useCallback, useMemo } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { apiFetch } from '../lib/api';

export function useApi() {
  const { authenticated, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const walletAddress = wallets.find((wallet: { address?: string }) => !!wallet.address)?.address;

  const loadAccessToken = useCallback(async () => {
    if (!authenticated) return undefined;
    return (await getAccessToken()) ?? undefined;
  }, [authenticated, getAccessToken]);

  const get = useCallback(
    async <T,>(path: string) =>
      apiFetch<T>(path, {
        accessToken: await loadAccessToken(),
        walletAddress,
      }),
    [loadAccessToken, walletAddress],
  );

  const post = useCallback(
    async <T,>(path: string, body?: unknown) =>
      apiFetch<T>(path, {
        method: 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
        accessToken: await loadAccessToken(),
        walletAddress,
      }),
    [loadAccessToken, walletAddress],
  );

  const put = useCallback(
    async <T,>(path: string, body?: unknown) =>
      apiFetch<T>(path, {
        method: 'PUT',
        body: body === undefined ? undefined : JSON.stringify(body),
        accessToken: await loadAccessToken(),
        walletAddress,
      }),
    [loadAccessToken, walletAddress],
  );

  return useMemo(
    () => ({
      walletAddress,
      authenticated,
      get,
      post,
      put,
    }),
    [authenticated, get, post, put, walletAddress],
  );
}
