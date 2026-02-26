import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { parseUnits } from "viem";
import { useClaimable } from "../hooks/useClaimable";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { CLAIM_CONTRACT_ADDRESS } from "../utils/constants";
import { formatJbmAmount, formatTimeAgo } from "../utils/formatters";
import styles from "../styles/claim-panel.module.css";

interface ClaimPanelProps {
  chain: string;
  ca: string;
  tokenSymbol: string;
}

const CLAIM_ABI = [
  {
    name: "claim",
    type: "function",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

function isHexAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isHexSignature(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]+$/.test(value);
}

function getNextClaimCountdown(
  claimedToday: boolean | undefined,
): string | null {
  if (!claimedToday) return null;

  const now = new Date();
  const nextUtcMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const diffMs = nextUtcMidnight.getTime() - now.getTime();
  const totalMinutes = Math.max(0, Math.floor(diffMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `Next claim in ${hours}h ${minutes}m`;
  }
  return `Next claim in ${minutes}m`;
}

export default function ClaimPanel({
  chain,
  ca,
  tokenSymbol,
}: ClaimPanelProps) {
  const { authenticated, login } = usePrivy();
  const { publicClient, requireWallet, walletAddress } = usePrivyBaseWallet();
  const { claimable, isLoading, refetch } = useClaimable(
    chain,
    ca,
    walletAddress ?? undefined,
  );

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const nextClaimText = getNextClaimCountdown(claimable?.claimed_today);

  const handleClaim = async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (!claimable?.can_claim || !claimable.claimable_jbm) {
      return;
    }

    if (!isHexAddress(CLAIM_CONTRACT_ADDRESS)) {
      setError("Set VITE_CLAIM_CONTRACT_ADDRESS to enable claims");
      return;
    }

    if (!publicClient) {
      setError("Missing Base public client");
      return;
    }

    setStatus(null);
    setError(null);
    setIsClaiming(true);

    try {
      const { address, walletClient } = await requireWallet();

      const signResponse = await fetch(`/api/claims/${chain}/${ca}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: address,
          amount: claimable.claimable_jbm,
        }),
      });

      const signData = (await signResponse.json()) as {
        signature?: string;
        amount?: string;
        nonce?: number;
        error?: string;
      };

      if (
        !signResponse.ok ||
        !signData.signature ||
        !signData.amount ||
        signData.nonce === undefined
      ) {
        throw new Error(
          signData.error ?? `Signing failed (${signResponse.status})`,
        );
      }

      if (!isHexSignature(signData.signature)) {
        throw new Error("Invalid signature from backend");
      }

      const hash = await walletClient.writeContract({
        address: CLAIM_CONTRACT_ADDRESS,
        abi: CLAIM_ABI,
        functionName: "claim",
        args: [
          parseUnits(signData.amount, 18),
          BigInt(signData.nonce),
          signData.signature,
        ],
        account: address,
      });

      setStatus("Claim transaction submitted...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("Claim transaction failed");
      }

      setStatus("Claim successful");
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim failed");
      setStatus(null);
    } finally {
      setIsClaiming(false);
    }
  };

  if (!authenticated) {
    return (
      <aside className={styles.panel}>
        <h3>Claim Rewards</h3>
        <p>Connect wallet to see your rewards</p>
        <button type="button" className={styles.actionButton} onClick={login}>
          Connect
        </button>
      </aside>
    );
  }

  if (isLoading) {
    return (
      <aside className={styles.panel}>
        <h3>Claim Rewards</h3>
        <p>Loading claim data...</p>
      </aside>
    );
  }

  if (!claimable || claimable.heat_degrees <= 0) {
    return (
      <aside className={styles.panel}>
        <h3>Claim Rewards</h3>
        <p>
          Your heat score for ${tokenSymbol} is 0 — no jungle bay memes to
          claim.
        </p>
      </aside>
    );
  }

  return (
    <aside className={styles.panel}>
      <h3>Claim Rewards</h3>

      <div className={styles.metric}>
        <span>Your heat</span>
        <strong>{claimable.heat_degrees.toFixed(1)}°</strong>
      </div>

      <div className={styles.metric}>
        <span>Claimable</span>
        <strong>{formatJbmAmount(claimable.claimable_jbm)}</strong>
      </div>

      <div className={styles.lastClaim}>
        Last claimed: {formatTimeAgo(claimable.last_claimed_at)}
      </div>

      <button
        type="button"
        className={styles.actionButton}
        disabled={!claimable.can_claim || isClaiming}
        onClick={handleClaim}
      >
        {claimable.can_claim ? "Claim" : "Claimed today ✓"}
      </button>
      {!claimable.can_claim && nextClaimText ? (
        <div className={styles.lastClaim}>{nextClaimText}</div>
      ) : null}

      {status ? <div className={styles.status}>{status}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
    </aside>
  );
}
