import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { sendCalls, waitForCallsStatus } from "viem/actions";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { useWalletClaims } from "../hooks/useWalletClaims";
import { CLAIM_CONTRACT_ADDRESS } from "../utils/constants";
import {
  claimEscrowAbi,
  type ClaimSignaturePayload,
  isHexAddress,
  isHexBytes32,
  isHexSignature,
} from "../utils/claimEscrow";
import { formatJbmAmount } from "../utils/formatters";
import styles from "../styles/rewards-inbox.module.css";

interface SignedReward {
  chain: string;
  tokenAddress: string;
  payload: {
    signature: `0x${string}`;
    escrow: `0x${string}`;
    amountWei: bigint;
    bungalowId: `0x${string}`;
    periodId: bigint;
    deadline: bigint;
    payoutWallet: `0x${string}`;
  };
}

function getBatchErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      error.name === "AtomicityNotSupportedError" ||
      message.includes("forceatomic") ||
      message.includes("atomicity") ||
      message.includes("wallet_sendcalls")
    ) {
      return "Your wallet does not support one-click atomic batch claims yet. Use the bungalow Claim button for now.";
    }

    return error.message;
  }

  return "Batch claim failed";
}

export default function RewardsInboxButton() {
  const { authenticated, getAccessToken, login } = usePrivy();
  const { requireWallet, walletAddress } = usePrivyBaseWallet();
  const { claims, isLoading, error: loadError, refetch } = useWalletClaims(
    walletAddress ?? undefined,
  );

  const [open, setOpen] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const claimableItems = claims?.items.filter((item) => item.can_claim) ?? [];

  if (!authenticated) {
    return null;
  }

  const handleOpen = () => {
    setStatus(null);
    setError(null);
    setOpen(true);
    void refetch();
  };

  const handleClaimAll = async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (!isHexAddress(CLAIM_CONTRACT_ADDRESS)) {
      setError("Set VITE_CLAIM_CONTRACT_ADDRESS to enable batch claims");
      return;
    }

    if (claimableItems.length === 0) {
      setStatus("No rewards ready to claim");
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

      const signedRewards: SignedReward[] = [];

      for (const item of claimableItems) {
        const signResponse = await fetch(
          `/api/claims/${item.chain}/${item.token_address}/sign`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              wallet: address,
              payout_wallet: address,
            }),
          },
        );

        const signData = (await signResponse.json()) as ClaimSignaturePayload;
        if (
          !signResponse.ok ||
          !signData.signature ||
          !signData.escrow ||
          !signData.amount_wei ||
          !signData.bungalowId ||
          !signData.periodId ||
          !signData.deadline ||
          !signData.payout_wallet
        ) {
          throw new Error(
            signData.error ?? `Signing failed for ${item.token_symbol ?? item.token_name ?? item.token_address}`,
          );
        }

        if (
          !isHexSignature(signData.signature) ||
          !isHexAddress(signData.escrow) ||
          !isHexAddress(signData.payout_wallet) ||
          !isHexBytes32(signData.bungalowId)
        ) {
          throw new Error("Invalid batch claim payload from backend");
        }

        signedRewards.push({
          chain: item.chain,
          tokenAddress: item.token_address,
          payload: {
            signature: signData.signature,
            escrow: signData.escrow,
            amountWei: BigInt(signData.amount_wei),
            bungalowId: signData.bungalowId,
            periodId: BigInt(signData.periodId),
            deadline: BigInt(signData.deadline),
            payoutWallet: signData.payout_wallet,
          },
        });
      }

      const bundle = await sendCalls(walletClient, {
        account: address,
        forceAtomic: true,
        calls: signedRewards.map((reward) => ({
          to: CLAIM_CONTRACT_ADDRESS,
          abi: claimEscrowAbi,
          functionName: "claim",
          args: [
            reward.payload.escrow,
            reward.payload.payoutWallet,
            reward.payload.amountWei,
            reward.payload.bungalowId,
            reward.payload.periodId,
            reward.payload.deadline,
            reward.payload.signature,
          ],
        })),
      });

      setStatus("Batch claim submitted...");
      await waitForCallsStatus(walletClient, {
        id: bundle.id,
        throwOnFailure: true,
        timeout: 120_000,
      });

      await Promise.allSettled(
        signedRewards.map((reward) =>
          fetch(`/api/claims/${reward.chain}/${reward.tokenAddress}/confirm`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              wallet: address,
              payout_wallet: address,
            }),
          }),
        ),
      );

      setStatus("Rewards claimed");
      await refetch().catch(() => undefined);
    } catch (err) {
      setError(getBatchErrorMessage(err));
      setStatus(null);
      await refetch().catch(() => undefined);
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={handleOpen}
        aria-label="Open rewards"
      >
        <span className={styles.icon}>💸</span>
        <span className={styles.badge}>{claims?.claimable_count ?? 0}</span>
      </button>

      {open ? (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <header className={styles.header}>
              <div>
                <h3>Island Rewards</h3>
                <p>
                  {claims
                    ? `${claims.claimable_count} bungalow${claims.claimable_count === 1 ? "" : "s"} ready`
                    : "Loading rewards"}
                </p>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>

            <div className={styles.summary}>
              <span>Total ready</span>
              <strong>
                {claims ? formatJbmAmount(claims.total_claimable_jbm) : "—"}
              </strong>
            </div>

            <div className={styles.list}>
              {isLoading ? (
                <div className={styles.empty}>Loading wallet rewards...</div>
              ) : null}

              {!isLoading && loadError ? (
                <div className={styles.error}>{loadError}</div>
              ) : null}

              {!isLoading && !loadError && claimableItems.length === 0 ? (
                <div className={styles.empty}>No claimable rewards right now.</div>
              ) : null}

              {!isLoading && !loadError
                ? claimableItems.map((item) => (
                    <div
                      key={`${item.chain}:${item.token_address}`}
                      className={styles.item}
                    >
                      <div>
                        <strong>
                          {item.token_symbol
                            ? `$${item.token_symbol}`
                            : item.token_name ?? item.token_address}
                        </strong>
                        <span>
                          {item.chain} • {item.heat_degrees.toFixed(1)}°
                          {item.has_reservation ? " • reserved" : ""}
                        </span>
                      </div>
                      <b>{formatJbmAmount(item.claimable_jbm)}</b>
                    </div>
                  ))
                : null}
            </div>

            <div className={styles.footer}>
              <button
                type="button"
                className={styles.claimButton}
                disabled={isClaiming || isLoading || claimableItems.length === 0}
                onClick={handleClaimAll}
              >
                {isClaiming ? "Claiming..." : "CLAIM"}
              </button>
              {status ? <div className={styles.status}>{status}</div> : null}
              {error ? <div className={styles.error}>{error}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
