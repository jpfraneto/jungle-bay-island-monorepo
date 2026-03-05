import { useCallback, useState } from "react";
import { useLinkWithSiwe, usePrivy } from "@privy-io/react-auth";
import { base } from "viem/chains";
import { usePrivyBaseWallet } from "./usePrivyBaseWallet";

interface LinkWalletResponse {
  wallets?: unknown;
  error?: unknown;
}

const CHAIN_ID = `eip155:${base.id}`;

export function useSiweWalletLink() {
  const { authenticated, getAccessToken, login } = usePrivy();
  const { requireWallet } = usePrivyBaseWallet();
  const { generateSiweMessage, linkWithSiwe } = useLinkWithSiwe();

  const [isLinking, setIsLinking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const linkCurrentWallet = useCallback(async () => {
    if (!authenticated) {
      login();
      throw new Error("Login required");
    }

    setIsLinking(true);
    setError(null);
    setStatus(null);

    try {
      const { address, wallet } = await requireWallet();
      const message = await generateSiweMessage({
        address,
        chainId: CHAIN_ID,
      });

      setStatus("Check your wallet — a signature request has been sent.");
      const signature = await wallet.sign(message);

      await linkWithSiwe({
        signature,
        message,
        chainId: CHAIN_ID,
        walletClientType: wallet.walletClientType,
        connectorType: wallet.connectorType,
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch("/api/user/link-wallet", {
        method: "POST",
        headers,
        body: JSON.stringify({
          address,
          signature,
          message,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | LinkWalletResponse
        | null;
      const apiError =
        typeof data?.error === "string" && data.error.trim().length > 0
          ? data.error
          : null;

      if (!response.ok) {
        throw new Error(apiError ?? `Request failed (${response.status})`);
      }

      setStatus("Wallet linked successfully.");
      return {
        address,
        wallets: Array.isArray(data?.wallets) ? data.wallets : [],
      };
    } catch {
      const message =
        "Linking failed. Make sure you signed with the correct wallet and try again.";
      setError(message);
      setStatus(null);
      throw new Error(message);
    } finally {
      setIsLinking(false);
    }
  }, [
    authenticated,
    generateSiweMessage,
    getAccessToken,
    linkWithSiwe,
    login,
    requireWallet,
  ]);

  return {
    linkCurrentWallet,
    isLinking,
    status,
    error,
    setStatus,
    setError,
  };
}
