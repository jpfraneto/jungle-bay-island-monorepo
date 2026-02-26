import { useCallback, useState } from "react";
import { erc20Abi, parseUnits } from "viem";
import { JBM_ADDRESS, TREASURY_ADDRESS } from "../utils/constants";
import { usePrivyBaseWallet } from "./usePrivyBaseWallet";

function isHexAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function useJBMTransfer() {
  const { publicClient, requireWallet } = usePrivyBaseWallet();
  const [isTransferring, setIsTransferring] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);

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

    const { address, walletClient } = await requireWallet();
    setIsTransferring(true);

    let hash: `0x${string}`;
    try {
      hash = await walletClient.writeContract({
        address: JBM_ADDRESS,
        abi: erc20Abi,
        functionName: "transfer",
        args: [TREASURY_ADDRESS, parseUnits(String(amountJbm), 18)],
        account: address,
      });
    } finally {
      setIsTransferring(false);
    }

    setIsWaiting(true);
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("JBM transfer failed");
      }
      return { from: address, hash, receipt };
    } finally {
      setIsWaiting(false);
    }
  }, [publicClient, requireWallet]);

  return {
    transfer,
    isTransferring: isTransferring || isWaiting,
  };
}
