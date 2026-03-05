import { useCallback, useState } from "react";
import { useLinkWithSiwe, usePrivy } from "@privy-io/react-auth";
import { base } from "viem/chains";
import { usePrivyBaseWallet } from "./usePrivyBaseWallet";

interface LinkWalletResponse {
  wallets?: unknown;
  error?: unknown;
}

const CHAIN_ID = `eip155:${base.id}`;
const SIWE_DOMAIN_SUFFIX = " wants you to sign in with your Ethereum account:";
const SIWE_DEBUG =
  typeof window !== "undefined" &&
  (import.meta.env.DEV || window.localStorage.getItem("debug:siwe") === "1");

interface SiweOrigin {
  domain: string;
  host: string;
  uri: string;
}

function getCurrentSiweOrigin(): SiweOrigin {
  if (typeof window === "undefined") {
    return {
      domain: "",
      host: "",
      uri: "",
    };
  }

  return {
    domain: window.location.hostname.toLowerCase(),
    host: window.location.host.toLowerCase(),
    uri: window.location.origin.toLowerCase(),
  };
}

function extractSiweDomain(message: string): string | null {
  const firstLine = message.split("\n", 1)[0]?.trim() ?? "";
  if (!firstLine.endsWith(SIWE_DOMAIN_SUFFIX)) return null;

  const domain = firstLine.slice(0, -SIWE_DOMAIN_SUFFIX.length).trim();
  return domain ? domain.toLowerCase() : null;
}

function extractSiweUri(message: string): string | null {
  const match = message.match(/^URI:\s*(.+)$/m);
  if (!match?.[1]) return null;
  return match[1].trim().toLowerCase();
}

function normalizeOrigin(value: string): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

function assertSiweMessageMatchesCurrentOrigin(message: string, origin: SiweOrigin): void {
  const messageDomain = extractSiweDomain(message);
  const messageUri = extractSiweUri(message);
  const messageOrigin = normalizeOrigin(messageUri ?? "");
  const expectedOrigins = new Set([origin.uri].filter(Boolean));
  const domainMatches = Boolean(
    messageDomain && (messageDomain === origin.domain || messageDomain === origin.host),
  );
  const uriMatches = Boolean(messageOrigin && expectedOrigins.has(messageOrigin));

  if (domainMatches && uriMatches) return;

  throw new Error(
    `SIWE origin mismatch. Expected domain ${origin.domain || "(unknown)"} and URI ${
      origin.uri || "(unknown)"
    }, got domain ${messageDomain || "(missing)"} and URI ${messageUri || "(missing)"}.`,
  );
}

async function generateSiweMessageForOrigin({
  generateSiweMessage,
  address,
  chainId,
  origin,
}: {
  generateSiweMessage: (input: unknown) => Promise<string>;
  address: string;
  chainId: string;
  origin: SiweOrigin;
}): Promise<string> {
  const candidates: unknown[] = [
    {
      wallet: {
        address,
        chainId,
      },
      from: {
        domain: origin.domain,
        uri: origin.uri,
      },
    },
    {
      address,
      chainId,
      from: {
        domain: origin.domain,
        uri: origin.uri,
      },
    },
    {
      address,
      chainId,
    },
  ];

  let lastError: unknown = null;

  for (const payload of candidates) {
    try {
      return await generateSiweMessage(payload);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Failed to generate SIWE message");
}

function extractSiweNonce(message: string): string | null {
  const match = message.match(/^Nonce:\s*(.+)$/m);
  if (!match?.[1]) return null;
  return match[1].trim();
}

function extractSiweIssuedAt(message: string): string | null {
  const match = message.match(/^Issued At:\s*(.+)$/m);
  if (!match?.[1]) return null;
  return match[1].trim();
}

function debugSiwe(step: string, payload?: unknown): void {
  if (!SIWE_DEBUG) return;
  if (payload === undefined) {
    console.info(`[SIWE LINK] ${step}`);
    return;
  }
  console.info(`[SIWE LINK] ${step}`, payload);
}

function debugSiweError(step: string, error: unknown): void {
  if (!SIWE_DEBUG) return;

  if (error instanceof Error) {
    const ownProps = Object.getOwnPropertyNames(error).reduce<Record<string, unknown>>(
      (acc, key) => {
        acc[key] = (error as unknown as Record<string, unknown>)[key];
        return acc;
      },
      {},
    );

    console.error(`[SIWE LINK] ${step}`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...ownProps,
    });
    return;
  }

  console.error(`[SIWE LINK] ${step}`, { error });
}

function getPrivyErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const value = (error as Record<string, unknown>).privyErrorCode;
  return typeof value === "string" ? value : null;
}

function mapSiweLinkError(error: unknown): string {
  const fallback =
    "Linking failed. Make sure you signed with the correct wallet and try again.";

  if (!(error instanceof Error)) {
    return fallback;
  }

  const code = getPrivyErrorCode(error);
  if (code === "linked_to_another_user" || /already linked this wallet/i.test(error.message)) {
    return "This wallet is already linked to another account. Log in with that account and unlink it first, then try again.";
  }

  if (
    error.message.includes("SIWE origin mismatch") ||
    error.message.includes("Embedded Privy wallets are disabled")
  ) {
    return error.message;
  }

  return fallback;
}

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

    debugSiwe("linkCurrentWallet:start", {
      href: typeof window !== "undefined" ? window.location.href : null,
    });

    setIsLinking(true);
    setError(null);
    setStatus(null);

    try {
      const { address, wallet } = await requireWallet();
      debugSiwe("wallet:resolved", {
        address,
        chainId: wallet.chainId,
        walletClientType: wallet.walletClientType,
        connectorType: wallet.connectorType,
      });

      const walletClientType = (wallet.walletClientType ?? "").toLowerCase();
      const connectorType = (wallet.connectorType ?? "").toLowerCase();
      if (walletClientType.startsWith("privy") || connectorType === "embedded") {
        throw new Error(
          "Embedded Privy wallets are disabled. Connect an external wallet (MetaMask, Rainbow, etc.) to continue.",
        );
      }

      const origin = getCurrentSiweOrigin();
      debugSiwe("origin:resolved", origin);

      const message = await generateSiweMessageForOrigin({
        generateSiweMessage: generateSiweMessage as (input: unknown) => Promise<string>,
        address,
        chainId: CHAIN_ID,
        origin,
      });
      debugSiwe("message:generated", {
        domain: extractSiweDomain(message),
        uri: extractSiweUri(message),
        nonce: extractSiweNonce(message),
        issuedAt: extractSiweIssuedAt(message),
        chainId: CHAIN_ID,
      });
      assertSiweMessageMatchesCurrentOrigin(message, origin);

      setStatus("Check your wallet — a signature request has been sent.");
      debugSiwe("wallet:sign:requested");
      const signature = await wallet.sign(message);
      debugSiwe("wallet:sign:success", {
        signatureLength: signature.length,
        signaturePrefix: signature.slice(0, 12),
      });

      debugSiwe("privy:siwe-link:request", {
        chainId: CHAIN_ID,
        walletClientType: wallet.walletClientType,
        connectorType: wallet.connectorType,
      });
      await linkWithSiwe({
        signature,
        message,
        chainId: CHAIN_ID,
        walletClientType: wallet.walletClientType,
        connectorType: wallet.connectorType,
      });
      debugSiwe("privy:siwe-link:success");

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
      debugSiwe("backend:link-wallet:response", {
        status: response.status,
        ok: response.ok,
        body: data,
      });
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
    } catch (error) {
      const message = mapSiweLinkError(error);
      debugSiweError("linkCurrentWallet:error", error);
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
