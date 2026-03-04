import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { sendCalls, waitForCallsStatus } from "viem/actions";
import ChainIcon from "./ChainIcon";
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
import { formatJbmCount } from "../utils/formatters";
import styles from "../styles/rewards-inbox.module.css";

interface SignedReward {
  chain: string;
  tokenAddress: string;
  payload: {
    signature: `0x${string}`;
    claimContract: `0x${string}`;
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
    const reasonMatch = error.message.match(
      /reverted with the following reason:\s*([\s\S]*?)(?:\n\s*Contract Call:|$)/i,
    );
    if (reasonMatch?.[1]) {
      return reasonMatch[1].trim();
    }

    const compact = error.message.split("\nContract Call:")[0]?.trim();
    if (compact) {
      return compact;
    }
  }

  return "Batch claim failed";
}

function shouldFallbackToSequential(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    error.name === "AtomicityNotSupportedError" ||
    message.includes("forceatomic") ||
    message.includes("atomicity") ||
    message.includes("wallet_sendcalls") ||
    message.includes("unknown connector error") ||
    message.includes("unknown rpc error") ||
    message.includes("not supported") ||
    message.includes("method not found")
  );
}

export default function RewardsInboxButton() {
  const { authenticated, getAccessToken, login } = usePrivy();
  const { publicClient, requireWallet, walletAddress } = usePrivyBaseWallet();
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

      for (const [batchIndex, item] of claimableItems.entries()) {
        const signResponse = await fetch(
          `/api/claims/${item.chain}/${item.token_address}/sign`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              wallet: address,
              payout_wallet: address,
              nonce_strategy: "batch",
              batch_index: batchIndex,
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

        signedRewards.push({
          chain: item.chain,
          tokenAddress: item.token_address,
          payload: {
            signature: signData.signature,
            claimContract,
            escrow: signData.escrow,
            amountWei: BigInt(signData.amount_wei),
            bungalowId: signData.bungalowId,
            periodId: BigInt(signData.periodId),
            deadline: BigInt(signData.deadline),
            payoutWallet: signData.payout_wallet,
          },
        });
      }

      const confirmReward = async (reward: SignedReward) => {
        const confirmResponse = await fetch(
          `/api/claims/${reward.chain}/${reward.tokenAddress}/confirm`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              wallet: address,
              payout_wallet: reward.payload.payoutWallet,
            }),
          },
        );

        if (!confirmResponse.ok) {
          const confirmData = (await confirmResponse.json()) as { error?: string };
          throw new Error(
            confirmData.error ?? `Claim confirmation failed (${confirmResponse.status})`,
          );
        }
      };

      const submitSequentialClaims = async () => {
        if (!publicClient) {
          throw new Error("Missing Base public client");
        }

        setStatus("Your wallet rejected one-click batch. Claiming one by one...");

        for (const reward of signedRewards) {
          const claimArgs = [
            reward.payload.escrow,
            reward.payload.payoutWallet,
            reward.payload.amountWei,
            reward.payload.bungalowId,
            reward.payload.periodId,
            reward.payload.deadline,
            reward.payload.signature,
          ] as const;

          const hash = await walletClient.writeContract({
            address: reward.payload.claimContract,
            abi: claimEscrowAbi,
            functionName: "claim",
            args: claimArgs,
            account: address,
          });

          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") {
            throw new Error("Claim transaction failed");
          }

          await confirmReward(reward);
        }
      };

      if (!publicClient) {
        throw new Error("Missing Base public client");
      }

      setStatus("Checking claims...");
      for (const reward of signedRewards) {
        await publicClient.simulateContract({
          address: reward.payload.claimContract,
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
          account: address,
        });
      }

      let bundleId: string;
      try {
        const bundle = await sendCalls(walletClient, {
          account: address,
          forceAtomic: true,
          calls: signedRewards.map((reward) => ({
            to: reward.payload.claimContract,
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
        bundleId = bundle.id;
      } catch (err) {
        if (shouldFallbackToSequential(err)) {
          await submitSequentialClaims();
          setStatus("Rewards claimed");
          await refetch().catch(() => undefined);
          return;
        }
        throw err;
      }

      setStatus("Batch claim submitted...");
      await waitForCallsStatus(walletClient, {
        id: bundleId,
        throwOnFailure: true,
        timeout: 120_000,
      });

      for (const reward of signedRewards) {
        await confirmReward(reward);
      }

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
                    ? `you have heat score on ${claims.claimable_count} bungalow${claims.claimable_count === 1 ? "" : "s"}`
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
                      <span className={styles.itemLabel}>
                        <ChainIcon
                          chain={item.chain}
                          className={styles.chainIcon}
                          size={14}
                        />
                        <strong>
                          {item.token_symbol
                            ? `$${item.token_symbol}`
                            : item.token_name ?? item.token_address}
                        </strong>
                      </span>
                      <b>{formatJbmCount(item.claimable_jbm)}</b>
                    </div>
                  ))
                : null}
            </div>

            <div className={styles.footer}>
              <div className={styles.summary}>
                <span>jungle bay memes to claim today</span>
                <strong>{claims ? formatJbmCount(claims.total_claimable_jbm) : "—"}</strong>
              </div>
              <button
                type="button"
                className={styles.claimButton}
                disabled={isClaiming || isLoading || claimableItems.length === 0}
                onClick={handleClaimAll}
              >
                {isClaiming
                  ? "Claiming..."
                  : `Claim ${claims ? formatJbmCount(claims.total_claimable_jbm) : "0"} jungle bay memes tokens`}
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
