import { useCallback, useEffect, useRef, useState } from "react";
import { useModalStatus, usePrivy } from "@privy-io/react-auth";
import {
  getPrivyWalletChainType,
  getPrivyWalletList,
} from "../utils/privyWalletOptions";
import { useUserWalletLinks } from "./useUserWalletLinks";

function asWalletAddress(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed) ? trimmed : null;
}

export interface LinkedWalletResult {
  didLinkWallet: boolean;
  walletCount: number | null;
  linkedAddress: string | null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function useSiweWalletLink() {
  const { authenticated, getAccessToken, linkWallet, login, user } = usePrivy();
  const hasXSession =
    typeof user?.twitter?.username === "string" &&
    user.twitter.username.trim().length > 0;
  const { isOpen: isPrivyModalOpen } = useModalStatus();
  const { wallets, refetch } = useUserWalletLinks(authenticated && hasXSession);

  const [isLinking, setIsLinking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingWalletLink, setPendingWalletLink] = useState(false);
  const [walletLinkModalOpened, setWalletLinkModalOpened] = useState(false);
  const [walletCountBeforeLink, setWalletCountBeforeLink] = useState(0);
  const [linkedAddressesBeforeLink, setLinkedAddressesBeforeLink] = useState<
    string[]
  >([]);
  const pendingPromiseRef = useRef<{
    resolve: (value: LinkedWalletResult) => void;
    reject: (reason?: unknown) => void;
  } | null>(null);

  const finishPendingPromise = useCallback(
    (result: LinkedWalletResult | null, failure?: unknown) => {
      const pending = pendingPromiseRef.current;
      pendingPromiseRef.current = null;

      if (!pending) {
        return;
      }

      if (failure !== undefined) {
        pending.reject(failure);
        return;
      }

      pending.resolve(
        result ?? {
          didLinkWallet: false,
          walletCount: null,
          linkedAddress: null,
        },
      );
    },
    [],
  );

  const syncLinkedWalletsFromPrivy = useCallback(async () => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = await getAccessToken();
    if (!token) {
      throw new Error("Authentication token unavailable");
    }

    headers.Authorization = `Bearer ${token}`;

    const response = await fetch("/api/user/sync-wallets", {
      method: "POST",
      headers,
    });

    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }

    const data = (await response.json().catch(() => null)) as {
      wallets?: unknown;
      error?: unknown;
    } | null;
    const apiError =
      typeof data?.error === "string" && data.error.trim().length > 0
        ? data.error
        : null;

    if (apiError) {
      throw new Error(apiError);
    }

    const syncedWallets = Array.isArray(data?.wallets) ? data.wallets : [];
    const linkedAddresses = syncedWallets
      .map((wallet) =>
        wallet && typeof wallet === "object"
          ? asWalletAddress((wallet as { address?: unknown }).address)
          : null,
      )
      .filter((address): address is string => Boolean(address));

    await refetch();
    return {
      walletCount: linkedAddresses.length,
      linkedAddresses,
    };
  }, [getAccessToken, refetch]);

  const waitForLinkedWalletSync = useCallback(
    async (previousCount: number, previousAddresses: string[]) => {
      let latestCount: number | null = null;
      let latestLinkedAddress: string | null = null;
      let lastError: unknown = null;
      const previousAddressSet = new Set(
        previousAddresses.map((address) => address.toLowerCase()),
      );

      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          const syncResult = await syncLinkedWalletsFromPrivy();
          latestCount = syncResult.walletCount;
          latestLinkedAddress =
            syncResult.linkedAddresses.find(
              (address) => !previousAddressSet.has(address.toLowerCase()),
            ) ?? null;

          if (
            (typeof latestCount === "number" && latestCount > previousCount) ||
            latestLinkedAddress
          ) {
            return {
              didLinkWallet: true,
              walletCount: latestCount,
              linkedAddress: latestLinkedAddress,
            };
          }
        } catch (nextError) {
          lastError = nextError;
        }

        if (attempt < 5) {
          await wait(1_000);
        }
      }

      if (lastError) {
        throw lastError;
      }

      return {
        didLinkWallet: false,
        walletCount: latestCount,
        linkedAddress: latestLinkedAddress,
      };
    },
    [syncLinkedWalletsFromPrivy],
  );

  useEffect(() => {
    if (!pendingWalletLink) {
      return;
    }

    if (isPrivyModalOpen) {
      if (!walletLinkModalOpened) {
        setWalletLinkModalOpened(true);
      }
      return;
    }

    if (!walletLinkModalOpened) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const result = await waitForLinkedWalletSync(
          walletCountBeforeLink,
          linkedAddressesBeforeLink,
        );
        if (cancelled) {
          return;
        }

        setStatus(
          result.didLinkWallet
            ? "Wallet linked successfully."
            : "No new wallet was linked.",
        );
        setError(null);
        finishPendingPromise(result);
      } catch (nextError) {
        if (cancelled) {
          return;
        }

        const message =
          nextError instanceof Error
            ? nextError.message
            : "Failed to sync linked wallets";
        setError(message);
        setStatus(null);
        finishPendingPromise(null, new Error(message));
      } finally {
        if (!cancelled) {
          setIsLinking(false);
          setPendingWalletLink(false);
          setWalletLinkModalOpened(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    finishPendingPromise,
    isPrivyModalOpen,
    linkedAddressesBeforeLink,
    pendingWalletLink,
    waitForLinkedWalletSync,
    walletCountBeforeLink,
    walletLinkModalOpened,
  ]);

  useEffect(() => {
    if (!pendingWalletLink || walletLinkModalOpened) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const message =
        "Wallet link modal did not open. Allow wallet popups and try again.";
      setPendingWalletLink(false);
      setIsLinking(false);
      setStatus(null);
      setError(message);
      finishPendingPromise(null, new Error(message));
    }, 8_000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [finishPendingPromise, pendingWalletLink, walletLinkModalOpened]);

  const linkCurrentWallet = useCallback(async () => {
    if (!authenticated) {
      login();
      throw new Error("Sign in with X first");
    }

    if (!hasXSession) {
      throw new Error("This session is no longer valid. Sign out and sign back in with X.");
    }

    if (pendingPromiseRef.current) {
      throw new Error("Wallet linking is already in progress");
    }

    setError(null);
    setStatus("Choose a wallet in Privy to link it.");
    setWalletCountBeforeLink(wallets.length);
    setLinkedAddressesBeforeLink(
      wallets.map((wallet) => wallet.address.toLowerCase()),
    );
    setPendingWalletLink(true);
    setWalletLinkModalOpened(false);
    setIsLinking(true);

    const promise = new Promise<LinkedWalletResult>((resolve, reject) => {
      pendingPromiseRef.current = {
        resolve,
        reject,
      };
    });

    try {
      linkWallet({
        walletChainType: getPrivyWalletChainType(),
        walletList: getPrivyWalletList(),
      });
    } catch (nextError) {
      setIsLinking(false);
      setPendingWalletLink(false);
      setWalletLinkModalOpened(false);
      setStatus(null);

      const message =
        nextError instanceof Error
          ? nextError.message
          : "Failed to open wallet link flow";
      setError(message);
      finishPendingPromise(null, new Error(message));
      throw new Error(message);
    }

    return promise;
  }, [authenticated, finishPendingPromise, hasXSession, linkWallet, login, wallets.length]);

  return {
    linkCurrentWallet,
    isLinking,
    status,
    error,
    setStatus,
    setError,
  };
}
