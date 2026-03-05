import type { WalletListEntry } from "@privy-io/react-auth";

const MOBILE_USER_AGENT_PATTERN =
  /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i;

export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return MOBILE_USER_AGENT_PATTERN.test(navigator.userAgent);
}

export function getPrivyWalletChainType():
  | "ethereum-only"
  | "ethereum-and-solana" {
  return isMobileBrowser() ? "ethereum-and-solana" : "ethereum-only";
}

export function getPrivyWalletList(): WalletListEntry[] {
  if (isMobileBrowser()) {
    return [
      "metamask",
      "rainbow",
      "phantom",
      "coinbase_wallet",
      "base_account",
      "wallet_connect_qr",
    ];
  }

  return [
    "metamask",
    "rainbow",
    "coinbase_wallet",
    "base_account",
    "wallet_connect_qr",
  ];
}
