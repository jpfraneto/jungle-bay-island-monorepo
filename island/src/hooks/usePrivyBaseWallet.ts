import { useCallback, useMemo } from "react";
import {
  useActiveWallet,
  usePrivy,
  useWallets,
  type ConnectedWallet,
} from "@privy-io/react-auth";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { base } from "viem/chains";

const BASE_CAIP_CHAIN_ID = `eip155:${base.id}`;
const BASE_RPC_URL = "https://mainnet.base.org";

function isHexAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isEmbeddedPrivyWallet(wallet: ConnectedWallet): boolean {
  const walletClientType = (wallet.walletClientType ?? "").toLowerCase();
  const connectorType = (wallet.connectorType ?? "").toLowerCase();

  return walletClientType.startsWith("privy") || connectorType === "embedded";
}

function pickFallbackWallet(
  wallets: ConnectedWallet[],
): ConnectedWallet | null {
  if (wallets.length === 0) return null;

  const orderedWallets = [...wallets].sort((a, b) => b.connectedAt - a.connectedAt);
  return orderedWallets.find((wallet) => wallet.linked) ?? orderedWallets[0] ?? null;
}

export function usePrivyBaseWallet() {
  const { authenticated, connectWallet, login } = usePrivy();
  const { wallets } = useWallets();
  const { wallet: sdkActiveWallet, setActiveWallet: setPrivyActiveWallet } =
    useActiveWallet();

  const ethereumWallets = useMemo(
    () =>
      wallets.filter(
        (wallet): wallet is ConnectedWallet =>
          wallet.type === "ethereum" && !isEmbeddedPrivyWallet(wallet),
      ),
    [wallets],
  );

  const sdkActiveAddress =
    sdkActiveWallet?.type === "ethereum"
      ? sdkActiveWallet.address.toLowerCase()
      : null;

  const activeWallet = useMemo(() => {
    if (sdkActiveAddress) {
      const sdkWallet = ethereumWallets.find(
        (wallet) => wallet.address.toLowerCase() === sdkActiveAddress,
      );
      if (sdkWallet) {
        return sdkWallet;
      }
    }

    return pickFallbackWallet(ethereumWallets);
  }, [ethereumWallets, sdkActiveAddress]);

  const walletAddress = activeWallet?.address ?? null;

  const publicClient = useMemo(
    () => createPublicClient({ chain: base, transport: http(BASE_RPC_URL) }),
    [],
  );

  const setActiveWallet = useCallback(
    (address: string) => {
      const next = ethereumWallets.find(
        (wallet) => wallet.address.toLowerCase() === address.toLowerCase(),
      );

      if (!next) {
        throw new Error("Wallet is not connected in Privy");
      }

      setPrivyActiveWallet(next);
    },
    [ethereumWallets, setPrivyActiveWallet],
  );

  const requireWallet = useCallback(async () => {
    if (!authenticated) {
      login();
      throw new Error("Connect your wallet first");
    }

    if (!activeWallet) {
      connectWallet({
        walletChainType: "ethereum-only",
      });
      throw new Error("Connect an external Ethereum wallet in Privy");
    }

    if (!isHexAddress(activeWallet.address)) {
      throw new Error("Connected wallet address is invalid");
    }

    if (activeWallet.chainId !== BASE_CAIP_CHAIN_ID) {
      await activeWallet.switchChain(base.id);
    }

    // Providers are chain-bound; fetch after switching.
    const provider = await activeWallet.getEthereumProvider();

    const walletClient = createWalletClient({
      account: activeWallet.address,
      chain: base,
      transport: custom(provider),
    });

    return {
      address: activeWallet.address,
      wallet: activeWallet,
      walletClient,
    };
  }, [activeWallet, authenticated, connectWallet, login]);

  return {
    activeWallet,
    wallets: ethereumWallets,
    publicClient,
    requireWallet,
    setActiveWallet,
    walletAddress,
  };
}
