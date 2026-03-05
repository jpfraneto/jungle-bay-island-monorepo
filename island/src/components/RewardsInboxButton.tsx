import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import ChainIcon from "./ChainIcon";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { useWalletClaims } from "../hooks/useWalletClaims";
import { CLAIM_CONTRACT_ADDRESS } from "../utils/constants";
import {
  claimEscrowAbi,
  type ClaimSignaturePayload,
  isHexAddress,
  isHexSignature,
  isHexBytes32,
} from "../utils/claimEscrow";
import { formatJbmCount } from "../utils/formatters";
import styles from "../styles/rewards-inbox.module.css";

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

      const firstClaim = claimableItems[0];
      if (!firstClaim) {
        setStatus("No rewards ready to claim");
        return;
      }

      const signResponse = await fetch(
        `/api/claims/${firstClaim.chain}/${firstClaim.token_address}/sign`,
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
        !signData.periodId ||
        !signData.deadline ||
        !signData.payout_wallet ||
        !signData.breakdown_hash
      ) {
        throw new Error(signData.error ?? `Signing failed (${signResponse.status})`);
      }

      if (
        !isHexSignature(signData.signature) ||
        !isHexAddress(signData.escrow) ||
        !isHexAddress(signData.payout_wallet) ||
        !isHexBytes32(signData.breakdown_hash)
      ) {
        throw new Error("Invalid claim payload from backend");
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

      if (!publicClient) {
        throw new Error("Missing Base public client");
      }

      const claimArgs = [
        signData.escrow,
        signData.payout_wallet,
        BigInt(signData.amount_wei),
        BigInt(signData.periodId),
        BigInt(signData.deadline),
        signData.breakdown_hash,
        signData.signature,
      ] as const;

      setStatus("Checking claim...");
      await publicClient.simulateContract({
        address: claimContract,
        abi: claimEscrowAbi,
        functionName: "claimPeriodTotal",
        args: claimArgs,
        account: address,
      });

      const hash = await walletClient.writeContract({
        address: claimContract,
        abi: claimEscrowAbi,
        functionName: "claimPeriodTotal",
        args: claimArgs,
        account: address,
      });

      setStatus("Claim transaction submitted...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("Claim transaction failed");
      }

      const confirmResponse = await fetch(
        `/api/claims/${firstClaim.chain}/${firstClaim.token_address}/confirm`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            wallet: address,
            payout_wallet: signData.payout_wallet,
          }),
        },
      );

      if (!confirmResponse.ok) {
        const confirmData = (await confirmResponse.json()) as { error?: string };
        throw new Error(
          confirmData.error ?? `Claim confirmation failed (${confirmResponse.status})`,
        );
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
