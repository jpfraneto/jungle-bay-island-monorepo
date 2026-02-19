import { useCallback, useMemo } from 'react';
import { useIdentityToken, usePrivy, useWallets } from '@privy-io/react-auth';
import { apiFetch } from '../lib/api';

export function useApi() {
  const { authenticated } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { wallets } = useWallets();
  const walletAddress = wallets.find((wallet: { address?: string }) => !!wallet.address)?.address;
  const hasAuthToken = Boolean(identityToken);

  const loadAuthToken = useCallback(async () => {
    if (!authenticated) return undefined;
    return identityToken ?? undefined;
  }, [authenticated, identityToken]);

  const get = useCallback(
    async <T,>(path: string) =>
      apiFetch<T>(path, {
        accessToken: await loadAuthToken(),
        walletAddress,
      }),
    [loadAuthToken, walletAddress],
  );

  const post = useCallback(
    async <T,>(path: string, body?: unknown) =>
      apiFetch<T>(path, {
        method: 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
        accessToken: await loadAuthToken(),
        walletAddress,
      }),
    [loadAuthToken, walletAddress],
  );

  const put = useCallback(
    async <T,>(path: string, body?: unknown) =>
      apiFetch<T>(path, {
        method: 'PUT',
        body: body === undefined ? undefined : JSON.stringify(body),
        accessToken: await loadAuthToken(),
        walletAddress,
      }),
    [loadAuthToken, walletAddress],
  );

  return useMemo(
    () => ({
      walletAddress,
      authenticated,
      hasAuthToken,
      get,
      post,
      put,
    }),
    [authenticated, get, hasAuthToken, post, put, walletAddress],
  );
}
