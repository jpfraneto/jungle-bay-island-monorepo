import { useCallback, useState } from "react";
import { erc20Abi, parseUnits } from "viem";
import { useAccount, useConnect, usePublicClient, useWriteContract } from "wagmi";
import { JBM_ADDRESS, TREASURY_ADDRESS } from "../utils/constants";

function isHexAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function useJBMTransfer() {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient({ chainId: 8453 });
  const [isWaiting, setIsWaiting] = useState(false);

  const ensureConnected = useCallback(async () => {
    if (isConnected && address) return address;

    const connector = connectors.find((item) => item.id.includes("injected")) ?? connectors[0];
    if (!connector) {
      throw new Error("No injected wallet connector available");
    }

    const result = await connectAsync({ connector });
    if (!result.accounts[0]) {
      throw new Error("Wallet connection failed");
    }

    return result.accounts[0];
  }, [address, connectAsync, connectors, isConnected]);

  const transfer = useCallback(async (amountJbm: number | string) => {
    if (!isHexAddress(JBM_ADDRESS)) {
      throw new Error("Invalid VITE_JBM_ADDRESS");
    }

    if (!isHexAddress(TREASURY_ADDRESS)) {
      throw new Error("Set a valid VITE_TREASURY_ADDRESS");
    }

    if (!publicClient) {
      throw new Error("Missing Base public client");
    }

    await ensureConnected();

    const hash = await writeContractAsync({
      address: JBM_ADDRESS,
      abi: erc20Abi,
      functionName: "transfer",
      args: [TREASURY_ADDRESS, parseUnits(String(amountJbm), 18)],
      chainId: 8453,
    });

    setIsWaiting(true);
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("JBM transfer failed");
      }
      return { hash, receipt };
    } finally {
      setIsWaiting(false);
    }
  }, [ensureConnected, publicClient, writeContractAsync]);

  return {
    transfer,
    isTransferring: isPending || isWaiting,
  };
}
