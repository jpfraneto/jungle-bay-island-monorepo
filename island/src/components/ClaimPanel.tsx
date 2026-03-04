import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useClaimable } from "../hooks/useClaimable";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { CLAIM_CONTRACT_ADDRESS } from "../utils/constants";
import {
  claimEscrowAbi,
  type ClaimSignaturePayload,
  isHexAddress,
  isHexBytes32,
  isHexSignature,
} from "../utils/claimEscrow";
import { formatJbmAmount, formatTimeAgo } from "../utils/formatters";
import styles from "../styles/claim-panel.module.css";

interface ClaimPanelProps {
  chain: string;
  ca: string;
  tokenSymbol: string;
  sticky?: boolean;
}

function getNextClaimCountdown(
  claimedToday: boolean | undefined,
): string | null {
  if (!claimedToday) return null;

  const now = new Date();
  const nextUtcNoon = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0),
  );
  if (nextUtcNoon.getTime() <= now.getTime()) {
    nextUtcNoon.setUTCDate(nextUtcNoon.getUTCDate() + 1);
  }

  const diffMs = nextUtcNoon.getTime() - now.getTime();
  const totalMinutes = Math.max(0, Math.floor(diffMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `Next claim in ${hours}h ${minutes}m`;
  }
  return `Next claim in ${minutes}m`;
}

function getClaimErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Claim failed";
  }

  const reasonMatch = error.message.match(
    /reverted with the following reason:\s*([\s\S]*?)(?:\n\s*Contract Call:|$)/i,
  );
  if (reasonMatch?.[1]) {
    return reasonMatch[1].trim();
  }

  const compact = error.message.split("\nContract Call:")[0]?.trim();
  return compact || "Claim failed";
}

export default function ClaimPanel({
  chain,
  ca,
  tokenSymbol,
  sticky = true,
}: ClaimPanelProps) {
  const { authenticated, login, getAccessToken } = usePrivy();
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
  const panelClassName = `${styles.panel} ${!sticky ? styles.panelStatic : ""}`;

  const handleClaim = async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (!claimable?.can_claim || !claimable.claimable_jbm) {
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
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const signResponse = await fetch(`/api/claims/${chain}/${ca}/sign`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          wallet: address,
          nonce_strategy: "single",
        }),
      });

      const signData = (await signResponse.json()) as ClaimSignaturePayload;
      const amountWei = signData.amount_wei;

      if (
        !signResponse.ok ||
        !signData.signature ||
        !amountWei ||
        !signData.escrow ||
        !signData.payout_wallet ||
        !signData.bungalowId ||
        !signData.periodId ||
        !signData.deadline
      ) {
        throw new Error(
          signData.error ?? `Signing failed (${signResponse.status})`,
        );
      }

      if (!isHexSignature(signData.signature)) {
        throw new Error("Invalid signature from backend");
      }
      const claimContract =
        typeof signData.claim_contract === "string" &&
        isHexAddress(signData.claim_contract)
          ? signData.claim_contract
          : CLAIM_CONTRACT_ADDRESS;
      if (!isHexAddress(claimContract)) {
        throw new Error(
          "Claim contract address is missing. Set VITE_CLAIM_CONTRACT_ADDRESS or return claim_contract from /sign.",
        );
      }
      if (
        !isHexAddress(signData.escrow) ||
        !isHexAddress(signData.payout_wallet) ||
        !isHexBytes32(signData.bungalowId)
      ) {
        throw new Error("Invalid claim payload from backend");
      }

      const claimArgs = [
        signData.escrow,
        signData.payout_wallet,
        BigInt(amountWei),
        signData.bungalowId,
        BigInt(signData.periodId),
        BigInt(signData.deadline),
        signData.signature,
      ] as const;

      setStatus("Checking claim...");
      await publicClient.simulateContract({
        address: claimContract,
        abi: claimEscrowAbi,
        functionName: "claim",
        args: claimArgs,
        account: address,
      });

      const hash = await walletClient.writeContract({
        address: claimContract,
        abi: claimEscrowAbi,
        functionName: "claim",
        args: claimArgs,
        account: address,
      });

      setStatus("Claim transaction submitted...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("Claim transaction failed");
      }

      const confirmResponse = await fetch(`/api/claims/${chain}/${ca}/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          wallet: address,
          payout_wallet: signData.payout_wallet,
        }),
      });

      if (!confirmResponse.ok) {
        const confirmData = (await confirmResponse.json()) as { error?: string };
        throw new Error(
          confirmData.error ?? `Claim confirmation failed (${confirmResponse.status})`,
        );
      }

      setStatus("Claim successful");
      await refetch().catch(() => undefined);
    } catch (err) {
      setError(getClaimErrorMessage(err));
      setStatus(null);
      await refetch().catch(() => undefined);
    } finally {
      setIsClaiming(false);
    }
  };

  if (!authenticated) {
    return (
      <aside className={panelClassName}>
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
      <aside className={panelClassName}>
        <h3>Claim Rewards</h3>
        <p>Loading claim data...</p>
      </aside>
    );
  }

  if (!claimable || claimable.heat_degrees <= 0) {
    return (
      <aside className={panelClassName}>
        <h3>Claim Rewards</h3>
        <p>
          Your heat score for ${tokenSymbol} is 0 — no jungle bay memes to
          claim.
        </p>
      </aside>
    );
  }

  return (
    <aside className={panelClassName}>
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
