import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import ChainIcon from "./ChainIcon";
import WalletSelector from "./WalletSelector";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { useSiweWalletLink } from "../hooks/useSiweWalletLink";
import { useUserWalletLinks } from "../hooks/useUserWalletLinks";
import { useWalletClaims } from "../hooks/useWalletClaims";
import { CLAIM_CONTRACT_ADDRESS } from "../utils/constants";
import {
  claimEscrowAbi,
  type ClaimSignaturePayload,
  isHexAddress,
  isHexSignature,
  isHexBytes32,
} from "../utils/claimEscrow";
import { formatAddress, formatJbmCount } from "../utils/formatters";
import styles from "../styles/rewards-inbox.module.css";

const CLAIMED_REWARDS_CACHE_PREFIX = "jbi:rewards:claimed-period-total:v1";
const WEI_PER_JBM = 1_000_000_000_000_000_000n;

interface CachedClaimedPeriod {
  periodId: string;
  amountJbm: string;
  periodEndMs: number;
  payoutWallet: string | null;
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

function parseAmount(value: string | null | undefined): bigint {
  if (!value) return 0n;
  const trimmed = value.trim();
  if (!trimmed) return 0n;
  try {
    return BigInt(trimmed);
  } catch {
    return 0n;
  }
}

function getPeriodEndMs(periodEndAt: string | null | undefined): number {
  if (periodEndAt) {
    const parsed = Date.parse(periodEndAt);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const now = new Date();
  const nextUtcNoon = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      12,
      0,
      0,
    ),
  );
  if (nextUtcNoon.getTime() <= now.getTime()) {
    nextUtcNoon.setUTCDate(nextUtcNoon.getUTCDate() + 1);
  }
  return nextUtcNoon.getTime();
}

function formatClaimCountdown(
  periodEndAt: string | null | undefined,
  nowMs: number,
): string {
  const endMs = getPeriodEndMs(periodEndAt);
  const remainingSeconds = Math.max(0, Math.floor((endMs - nowMs) / 1000));
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function getClaimedRewardsCacheKey(wallet: string): string {
  return `${CLAIMED_REWARDS_CACHE_PREFIX}:${wallet.toLowerCase()}`;
}

function readCachedClaimedPeriod(
  wallet: string | null | undefined,
): CachedClaimedPeriod | null {
  if (!wallet || typeof window === "undefined") return null;

  const key = getClaimedRewardsCacheKey(wallet);

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedClaimedPeriod> | null;
    if (
      !parsed ||
      typeof parsed.periodId !== "string" ||
      !parsed.periodId.trim() ||
      typeof parsed.amountJbm !== "string" ||
      typeof parsed.periodEndMs !== "number" ||
      !Number.isFinite(parsed.periodEndMs)
    ) {
      window.localStorage.removeItem(key);
      return null;
    }
    return {
      periodId: parsed.periodId,
      amountJbm: parsed.amountJbm,
      periodEndMs: parsed.periodEndMs,
      payoutWallet:
        typeof parsed.payoutWallet === "string" && parsed.payoutWallet.trim()
          ? parsed.payoutWallet
          : null,
    };
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

function writeCachedClaimedPeriod(
  wallet: string | null | undefined,
  value: CachedClaimedPeriod | null,
): void {
  if (!wallet || typeof window === "undefined") return;

  const key = getClaimedRewardsCacheKey(wallet);
  if (!value) {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

function toPeriodIdString(
  value: string | number | null | undefined,
): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function getAmountJbmFromPayload(payload: ClaimSignaturePayload): string {
  if (payload.amount_jbm && payload.amount_jbm.trim()) {
    return payload.amount_jbm;
  }
  if (payload.amount_wei && payload.amount_wei.trim()) {
    try {
      return (BigInt(payload.amount_wei) / WEI_PER_JBM).toString();
    } catch {
      return "0";
    }
  }
  return "0";
}

export default function RewardsInboxButton() {
  const { authenticated, getAccessToken, login } = usePrivy();
  const {
    publicClient,
    requireWallet,
    walletAddress,
    wallets: connectedWallets,
  } = usePrivyBaseWallet();
  const { wallets: linkedWalletRows, refetch: refetchLinkedWallets } =
    useUserWalletLinks(authenticated);
  const {
    linkCurrentWallet,
    isLinking: isLinkingWallet,
    status: linkStatus,
    error: linkError,
  } = useSiweWalletLink();
  const claimLookupWallet =
    linkedWalletRows[0]?.address ?? walletAddress ?? undefined;
  const {
    claims,
    isLoading,
    error: loadError,
    refetch,
  } = useWalletClaims(claimLookupWallet);

  const [open, setOpen] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [selectedPayoutWallet, setSelectedPayoutWallet] = useState<string>("");
  const [showWalletGate, setShowWalletGate] = useState(false);
  const [resumeAfterLink, setResumeAfterLink] = useState(false);
  const [cachedClaimedPeriod, setCachedClaimedPeriod] =
    useState<CachedClaimedPeriod | null>(null);

  useEffect(() => {
    setCachedClaimedPeriod(readCachedClaimedPeriod(claimLookupWallet));
  }, [claimLookupWallet]);

  const linkedWallets = linkedWalletRows.map((wallet) =>
    wallet.address.toLowerCase(),
  );
  const connectedWalletAddresses = useMemo(
    () => connectedWallets.map((wallet) => wallet.address.toLowerCase()),
    [connectedWallets],
  );
  const signableWallets = useMemo(
    () =>
      linkedWalletRows
        .map((wallet) => wallet.address)
        .filter((address) =>
          connectedWalletAddresses.includes(address.toLowerCase()),
        ),
    [connectedWalletAddresses, linkedWalletRows],
  );

  useEffect(() => {
    if (selectedPayoutWallet) {
      const selectedIsSignable = signableWallets.some(
        (address) => address.toLowerCase() === selectedPayoutWallet.toLowerCase(),
      );
      if (selectedIsSignable) {
        return;
      }
    }

    if (signableWallets[0]) {
      setSelectedPayoutWallet(signableWallets[0]);
      return;
    }

    if (walletAddress) {
      setSelectedPayoutWallet(walletAddress);
    }
  }, [selectedPayoutWallet, signableWallets, walletAddress]);
  const claimableItems = useMemo(
    () => claims?.items.filter((item) => item.can_claim) ?? [],
    [claims?.items],
  );
  const claimedItems = useMemo(
    () => claims?.items.filter((item) => item.claimed_today) ?? [],
    [claims?.items],
  );
  const claimedTodayTotal = useMemo(() => {
    if (claims?.claimed_today_total_jbm) {
      return parseAmount(claims.claimed_today_total_jbm);
    }
    return claimedItems.reduce(
      (sum, item) => sum + parseAmount(item.period_reward_jbm),
      0n,
    );
  }, [claimedItems, claims?.claimed_today_total_jbm]);

  const backendHasClaimedToday =
    !isLoading && claimableItems.length === 0 && claimedTodayTotal > 0n;
  const backendPeriodId = toPeriodIdString(claims?.period_id);
  const cachedPeriodId = toPeriodIdString(cachedClaimedPeriod?.periodId);
  const cachedClaimIsActive = Boolean(
    cachedClaimedPeriod &&
    cachedClaimedPeriod.periodEndMs > Date.now() &&
    cachedPeriodId &&
    (!backendPeriodId || cachedPeriodId === backendPeriodId),
  );
  const optimisticClaimedTotal = cachedClaimIsActive
    ? parseAmount(cachedClaimedPeriod?.amountJbm)
    : 0n;
  const effectiveClaimedTodayTotal =
    claimedTodayTotal > 0n ? claimedTodayTotal : optimisticClaimedTotal;
  const displayedClaimedTodayTotal = cachedClaimIsActive
    ? optimisticClaimedTotal
    : effectiveClaimedTodayTotal;
  const hasClaimedToday = backendHasClaimedToday || cachedClaimIsActive;
  const effectivePeriodEndAt =
    claims?.period_end_at ??
    (cachedClaimIsActive && cachedClaimedPeriod
      ? new Date(cachedClaimedPeriod.periodEndMs).toISOString()
      : null);

  useEffect(() => {
    if (!claimLookupWallet || !cachedClaimedPeriod) return;
    if (cachedClaimIsActive) return;
    writeCachedClaimedPeriod(claimLookupWallet, null);
    setCachedClaimedPeriod(null);
  }, [cachedClaimIsActive, cachedClaimedPeriod, claimLookupWallet]);

  const countdown = useMemo(
    () =>
      hasClaimedToday
        ? formatClaimCountdown(effectivePeriodEndAt, clockMs)
        : null,
    [clockMs, effectivePeriodEndAt, hasClaimedToday],
  );
  const summaryLabel = hasClaimedToday
    ? "jungle bay memes claimed today"
    : "jungle bay memes to claim today";
  const summaryValue = hasClaimedToday
    ? formatJbmCount(displayedClaimedTodayTotal.toString())
    : !isLoading && claims
      ? formatJbmCount(claims.total_claimable_jbm)
      : "—";
  const selectedClaimWallet =
    selectedPayoutWallet || walletAddress || claims?.payout_wallet || "";
  const selectedClaimWalletLabel = selectedClaimWallet
    ? formatAddress(selectedClaimWallet)
    : null;
  const effectiveClaimWallet =
    cachedClaimIsActive && cachedClaimedPeriod?.payoutWallet
      ? cachedClaimedPeriod.payoutWallet
      : claims?.payout_wallet || selectedClaimWallet || "";
  const effectiveClaimWalletLabel = effectiveClaimWallet
    ? formatAddress(effectiveClaimWallet)
    : null;

  useEffect(() => {
    if (!open || !hasClaimedToday) return;
    setClockMs(Date.now());
    const timer = window.setInterval(() => {
      setClockMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [hasClaimedToday, open]);

  if (!authenticated) {
    return null;
  }

  const handleOpen = () => {
    setStatus(null);
    setError(null);
    setShowWalletGate(false);
    setResumeAfterLink(false);
    setOpen(true);
    void refetch();
  };

  const executeClaimAll = async () => {
    if (claimableItems.length === 0) {
      setStatus("No rewards ready to claim");
      return;
    }

    const payoutWallet = selectedPayoutWallet || walletAddress;
    if (!payoutWallet) {
      setError("Select a payout wallet first");
      return;
    }

    if (!linkedWallets.includes(payoutWallet.toLowerCase())) {
      setError("Link this wallet first to use it for transactions.");
      return;
    }

    if (
      !signableWallets.some(
        (address) => address.toLowerCase() === payoutWallet.toLowerCase(),
      )
    ) {
      setError("Connect this linked wallet in Privy on this device to sign with it here.");
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
            payout_wallet: payoutWallet,
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
        throw new Error(
          signData.error ?? `Signing failed (${signResponse.status})`,
        );
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

      const periodId = toPeriodIdString(signData.periodId);
      const periodEndMs = getPeriodEndMs(claims?.period_end_at);
      const claimedWallet = signData.payout_wallet ?? address;
      if (periodId) {
        const nextCachedClaim: CachedClaimedPeriod = {
          periodId,
          amountJbm: getAmountJbmFromPayload(signData),
          periodEndMs,
          payoutWallet: claimedWallet,
        };
        setCachedClaimedPeriod(nextCachedClaim);
        writeCachedClaimedPeriod(claimLookupWallet, nextCachedClaim);
        if (
          claimLookupWallet &&
          claimedWallet.toLowerCase() !== claimLookupWallet.toLowerCase()
        ) {
          writeCachedClaimedPeriod(claimedWallet, nextCachedClaim);
        }
      }

      const confirmResponse = await fetch(
        `/api/claims/${firstClaim.chain}/${firstClaim.token_address}/confirm`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            wallet: address,
            payout_wallet: payoutWallet,
          }),
        },
      );

      if (!confirmResponse.ok) {
        const confirmData = (await confirmResponse.json()) as {
          error?: string;
        };
        throw new Error(
          confirmData.error ??
            `Claim confirmation failed (${confirmResponse.status})`,
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

  const handleClaimAll = async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (signableWallets.length === 0) {
      setShowWalletGate(true);
      setResumeAfterLink(true);
      return;
    }

    await executeClaimAll();
  };

  const handleAddWallet = async () => {
    try {
      await linkCurrentWallet();
      await refetchLinkedWallets();
      setShowWalletGate(false);
      if (resumeAfterLink) {
        setResumeAfterLink(false);
        await executeClaimAll();
      }
    } catch {
      // Hook error state already contains user-friendly messaging.
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
        <span
          className={`${styles.badge} ${hasClaimedToday ? styles.badgeClaimed : ""}`}
          aria-label={hasClaimedToday ? "Claimed today" : "Claimable rewards"}
        >
          {hasClaimedToday ? "✓" : (claims?.claimable_count ?? 0)}
        </span>
      </button>

      {open ? (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <header className={styles.header}>
              <div>
                <h3>Island Rewards</h3>
                <p>
                  {hasClaimedToday
                    ? "You already claimed today's rewards."
                    : isLoading
                      ? "Loading rewards..."
                      : claims
                        ? `You have heat score on ${claims.claimable_count} bungalow${claims.claimable_count === 1 ? "" : "s"}.`
                        : "Loading rewards..."}
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

            {!hasClaimedToday ? (
              <WalletSelector
                value={selectedPayoutWallet}
                onSelect={setSelectedPayoutWallet}
              />
            ) : null}
            {!hasClaimedToday &&
            (showWalletGate || signableWallets.length === 0) ? (
              <div className={styles.error}>
                <strong>
                  Connect and link a wallet in this browser to sign the claim.
                </strong>
                <button
                  type="button"
                  className={styles.claimButton}
                  onClick={() => {
                    void handleAddWallet();
                  }}
                  disabled={isLinkingWallet}
                >
                  {isLinkingWallet ? "Linking..." : "Add wallet"}
                </button>
                {linkStatus ? (
                  <div className={styles.status}>{linkStatus}</div>
                ) : null}
                {linkError ? (
                  <div className={styles.error}>{linkError}</div>
                ) : null}
              </div>
            ) : null}

            <div className={styles.list}>
              {isLoading && !hasClaimedToday ? (
                <div className={styles.empty}>Loading wallet rewards...</div>
              ) : null}

              {!isLoading && loadError && !hasClaimedToday ? (
                <div className={styles.error}>{loadError}</div>
              ) : null}

              {!loadError &&
              claimableItems.length === 0 &&
              (!isLoading || hasClaimedToday) ? (
                hasClaimedToday ? (
                  <div className={styles.claimedNotice}>
                    <strong>
                      You already claimed{" "}
                      {formatJbmCount(displayedClaimedTodayTotal.toString())}{" "}
                      jungle bay memes today.
                    </strong>
                    {effectiveClaimWalletLabel ? (
                      <span>Claimed with {effectiveClaimWalletLabel}</span>
                    ) : null}
                    {countdown ? <span>Claim again in {countdown}</span> : null}
                  </div>
                ) : (
                  <div className={styles.empty}>
                    No claimable rewards right now.
                  </div>
                )
              ) : null}

              {!isLoading && !loadError
                ? (hasClaimedToday ? claimedItems : claimableItems).map(
                    (item) => (
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
                              : (item.token_name ?? item.token_address)}
                          </strong>
                        </span>
                        <b>
                          {formatJbmCount(
                            hasClaimedToday
                              ? item.period_reward_jbm
                              : item.claimable_jbm,
                          )}
                          {hasClaimedToday ? " ✓" : ""}
                        </b>
                      </div>
                    ),
                  )
                : null}
            </div>

            <div className={styles.footer}>
              <div className={styles.summary}>
                <span>{summaryLabel}</span>
                <strong>{summaryValue}</strong>
              </div>
              <button
                type="button"
                className={styles.claimButton}
                disabled={
                  isClaiming ||
                  hasClaimedToday ||
                  signableWallets.length === 0 ||
                  (isLoading && !hasClaimedToday) ||
                  claimableItems.length === 0
                }
                onClick={() => {
                  void handleClaimAll();
                }}
              >
                {isClaiming
                  ? "Claiming..."
                  : hasClaimedToday
                    ? "Claimed today ✓"
                    : isLoading
                      ? "Loading rewards..."
                      : `Claim ${claims ? formatJbmCount(claims.total_claimable_jbm) : "0"} jungle bay memes${
                          selectedClaimWalletLabel
                            ? ` with ${selectedClaimWalletLabel}`
                            : ""
                        }`}
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
