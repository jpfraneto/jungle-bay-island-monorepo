import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIdentityToken, usePrivy, useToken, useWallets } from '@privy-io/react-auth';
import { apiFetch } from '../lib/api';

async function getAccessTokenWithTimeout(
  getAccessToken: () => Promise<string | null>,
  timeoutMs = 7000,
): Promise<string | null> {
  return await Promise.race([
    getAccessToken(),
    new Promise<string | null>((resolve) => {
      window.setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
}

export function useApi() {
  const { authenticated } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { getAccessToken } = useToken();
  const { wallets } = useWallets();
  const walletAddress = wallets.find((wallet: { address?: string }) => !!wallet.address)?.address;
  const [resolvedToken, setResolvedToken] = useState<string | null>(null);
  const [authTokenReady, setAuthTokenReady] = useState(false);

  useEffect(() => {
    let canceled = false;

    if (!authenticated) {
      setResolvedToken(null);
      setAuthTokenReady(true);
      return () => {
        canceled = true;
      };
    }

    if (identityToken) {
      setResolvedToken(identityToken);
      setAuthTokenReady(true);
      return () => {
        canceled = true;
      };
    }

    setAuthTokenReady(false);
    void (async () => {
      try {
        const token = await getAccessTokenWithTimeout(getAccessToken);
        if (canceled) return;
        setResolvedToken(token ?? null);
      } catch {
        if (canceled) return;
        setResolvedToken(null);
      } finally {
        if (!canceled) setAuthTokenReady(true);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [authenticated, getAccessToken, identityToken]);

  const hasAuthToken = Boolean(identityToken || resolvedToken);

  const loadAuthToken = useCallback(async () => {
    if (!authenticated) return undefined;
    if (identityToken) return identityToken;
    if (resolvedToken) return resolvedToken;

    const fetched = await getAccessTokenWithTimeout(getAccessToken);
    if (fetched) setResolvedToken(fetched);
    return fetched ?? undefined;
  }, [authenticated, getAccessToken, identityToken, resolvedToken]);

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
      authTokenReady,
      get,
      post,
      put,
    }),
    [authTokenReady, authenticated, get, hasAuthToken, post, put, walletAddress],
  );
}
