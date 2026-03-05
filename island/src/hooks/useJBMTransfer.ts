import { useCallback, useState } from "react";
import { formatUnits, parseEventLogs, parseUnits } from "viem";
import { JBM_ADDRESS, TREASURY_ADDRESS } from "../utils/constants";
import { jbmAbi } from "../utils/jbmAbi";
import { usePrivyBaseWallet } from "./usePrivyBaseWallet";

function isHexAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function useJBMTransfer() {
  const { publicClient, requireWallet } = usePrivyBaseWallet();
  const [isTransferring, setIsTransferring] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);

  const transfer = useCallback(
    async (amountJbm: number | string) => {
      if (!isHexAddress(JBM_ADDRESS)) {
        throw new Error("Invalid VITE_JBM_ADDRESS");
      }

      if (!isHexAddress(TREASURY_ADDRESS)) {
        throw new Error("Set a valid VITE_TREASURY_ADDRESS");
      }

      if (!publicClient) {
        throw new Error("Missing Base public client");
      }

      const code = await publicClient.getCode({ address: JBM_ADDRESS });
      if (!code || code === "0x") {
        throw new Error(
          "VITE_JBM_ADDRESS must be a deployed ERC-20 contract on Base",
        );
      }

      const decimals = await publicClient.readContract({
        address: JBM_ADDRESS,
        abi: jbmAbi,
        functionName: "decimals",
      });
      const normalizedDecimals = Number(decimals);
      const amountBaseUnits = parseUnits(String(amountJbm), normalizedDecimals);
      if (amountBaseUnits <= 0n) {
        throw new Error("Transfer amount must be greater than zero");
      }

      const { address, walletClient } = await requireWallet();
      const currentBalance = await publicClient.readContract({
        address: JBM_ADDRESS,
        abi: jbmAbi,
        functionName: "balanceOf",
        args: [address],
      });

      if (currentBalance < amountBaseUnits) {
        const available = Number(
          formatUnits(currentBalance, normalizedDecimals),
        ).toLocaleString(undefined, {
          maximumFractionDigits: 4,
        });
        const required = Number(
          formatUnits(amountBaseUnits, normalizedDecimals),
        ).toLocaleString(undefined, {
          maximumFractionDigits: 4,
        });

        throw new Error(
          `Insufficient JBM balance on ${address.slice(0, 6)}...${address.slice(-4)}. Available: ${available} JBM. Required: ${required} JBM.`,
        );
      }

      setIsTransferring(true);

      let hash: `0x${string}`;
      try {
        hash = await walletClient.writeContract({
          address: JBM_ADDRESS,
          abi: jbmAbi,
          functionName: "transfer",
          args: [TREASURY_ADDRESS, amountBaseUnits],
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

        const transferEvents = parseEventLogs({
          abi: jbmAbi,
          eventName: "Transfer",
          logs: receipt.logs,
        });

        const hasExpectedTransfer = transferEvents.some(
          (event) =>
            event.address.toLowerCase() === JBM_ADDRESS.toLowerCase() &&
            event.args.from?.toLowerCase() === address.toLowerCase() &&
            event.args.to?.toLowerCase() === TREASURY_ADDRESS.toLowerCase() &&
            event.args.value === amountBaseUnits,
        );

        if (!hasExpectedTransfer) {
          throw new Error(
            "Transaction confirmed but no JBM Transfer event was found",
          );
        }

        return { from: address, hash, receipt };
      } finally {
        setIsWaiting(false);
      }
    },
    [publicClient, requireWallet],
  );

  return {
    transfer,
    isTransferring: isTransferring || isWaiting,
  };
}
