import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Link } from "react-router-dom";
import { type Address } from "viem";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import styles from "../styles/profile-page.module.css";
import {
  confirmTrackedTx,
  fetchAuthedJson,
  islandIdentityAbi,
  normalizeTxError,
  ONCHAIN_CONTRACTS,
  trackSubmittedTx,
  type OnchainMeResponse,
} from "../utils/onchain";

type ProfileAction = "register" | "linkWallet" | "claimDailyJBM";

function formatAddress(value: string): string {
  if (value.length < 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export default function ProfilePage() {
  const { authenticated, getAccessToken, login, user } = usePrivy();
  const {
    activeWallet,
    wallets,
    walletAddress,
    publicClient,
    requireWallet,
    setActiveWallet,
  } = usePrivyBaseWallet();
  const [data, setData] = useState<OnchainMeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [txBusy, setTxBusy] = useState(false);

  const hasXSession =
    typeof user?.twitter?.username === "string" && user.twitter.username.trim().length > 0;

  const refetch = async () => {
    if (!authenticated || !hasXSession) {
      setData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const payload = await fetchAuthedJson<OnchainMeResponse>("/api/onchain/me", getAccessToken);
      setData(payload);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error ? fetchError.message : "Failed to load profile state",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refetch();
  }, [authenticated, hasXSession]);

  const selectedWallet = activeWallet?.address ?? walletAddress ?? "";
  const walletLinkedOnchain = useMemo(() => {
    const linkedWallets = data?.profile?.wallets ?? [];
    return linkedWallets.some((wallet) => wallet.toLowerCase() === selectedWallet.toLowerCase());
  }, [data?.profile?.wallets, selectedWallet]);

  const runIdentityWrite = async (input: {
    label: string;
    action: string;
    functionName: ProfileAction;
    signaturePath: string;
  }) => {
    setError(null);
    setStatus(input.label);
    setTxBusy(true);

    try {
      const { address, walletClient } = await requireWallet();
      const signaturePayload = await fetchAuthedJson<Record<string, string | number | null>>(
        input.signaturePath,
        getAccessToken,
        {
          method: "POST",
          body: JSON.stringify({ wallet: address }),
        },
      );

      const functionArgs =
        input.functionName === "register"
          ? [
              BigInt(String(signaturePayload.x_user_id)),
              String(signaturePayload.x_handle ?? ""),
              BigInt(String(signaturePayload.heat_score ?? "0")),
              String(signaturePayload.salt ?? "") as `0x${string}`,
              BigInt(String(signaturePayload.deadline ?? "0")),
              String(signaturePayload.sig ?? "") as `0x${string}`,
            ]
          : input.functionName === "linkWallet"
            ? [
                BigInt(String(signaturePayload.profile_id)),
                String(signaturePayload.salt ?? "") as `0x${string}`,
                BigInt(String(signaturePayload.deadline ?? "0")),
                String(signaturePayload.sig ?? "") as `0x${string}`,
              ]
            : [
                BigInt(String(signaturePayload.period_id)),
                BigInt(String(signaturePayload.amount ?? "0")),
                String(signaturePayload.salt ?? "") as `0x${string}`,
                BigInt(String(signaturePayload.deadline ?? "0")),
                String(signaturePayload.sig ?? "") as `0x${string}`,
              ];

      setStatus("Sending wallet transaction...");
      const txHash = await walletClient.writeContract({
        account: address as Address,
        address: ONCHAIN_CONTRACTS.islandIdentity,
        abi: islandIdentityAbi,
        functionName: input.functionName,
        args: functionArgs as never,
      });

      await trackSubmittedTx({
        getAccessToken,
        txHash,
        action: input.action,
        functionName: input.functionName,
        contractAddress: ONCHAIN_CONTRACTS.islandIdentity,
        wallet: address,
        profileId: typeof signaturePayload.profile_id === "number" ? signaturePayload.profile_id : undefined,
        metadata: {
          signature_path: input.signaturePath,
        },
      });

      setStatus("Waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      await confirmTrackedTx(getAccessToken, txHash);
      await refetch();
      setStatus("Onchain state updated.");
    } catch (txError) {
      setError(normalizeTxError(txError, "Transaction failed"));
      setStatus(null);
    } finally {
      setTxBusy(false);
    }
  };

  const handleRegister = async () => {
    await runIdentityWrite({
      label: "Requesting profile signature...",
      action: "identity_register",
      functionName: "register",
      signaturePath: "/api/onchain/register/sign",
    });
  };

  const handleLinkWallet = async () => {
    await runIdentityWrite({
      label: "Requesting link-wallet signature...",
      action: "identity_link_wallet",
      functionName: "linkWallet",
      signaturePath: "/api/onchain/link-wallet/sign",
    });
  };

  const handleClaimDaily = async () => {
    await runIdentityWrite({
      label: "Preparing daily JBM claim...",
      action: "identity_claim_daily_jbm",
      functionName: "claimDailyJBM",
      signaturePath: "/api/onchain/claim-daily/sign",
    });
  };

  if (!authenticated || !hasXSession) {
    return (
      <section className={styles.page}>
        <div className={styles.hero}>
          <p className={styles.kicker}>Identity root</p>
          <h1>Start with X. Then make it onchain.</h1>
          <p className={styles.summary}>
            Your X account anchors the profile. Wallets get linked under it,
            bungalow heat becomes portable, and daily JBM claims become
            available once you activate a bond.
          </p>
          <button type="button" className={styles.primaryButton} onClick={login}>
            Login with X
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <div className={styles.hero}>
        <div>
          <p className={styles.kicker}>Onchain identity</p>
          <h1>{data?.profile ? "Your profile is live." : "Create your island profile."}</h1>
          <p className={styles.summary}>
            Keep the actions direct: create the profile, link the wallet you
            want to transact with, then use that profile across bungalows,
            Bodega installs, commissions, and daily JBM claims.
          </p>
        </div>

        <div className={styles.walletPanel}>
          <span className={styles.panelLabel}>Transaction wallet</span>
          {wallets.length > 0 ? (
            <select
              className={styles.walletSelect}
              value={selectedWallet}
              onChange={(event) => setActiveWallet(event.target.value)}
              disabled={txBusy}
            >
              {wallets.map((wallet) => (
                <option key={wallet.address} value={wallet.address}>
                  {formatAddress(wallet.address)}
                </option>
              ))}
            </select>
          ) : (
            <p className={styles.inlineCopy}>
              Connect an external Base wallet after signing in. That wallet signs all onchain writes.
            </p>
          )}
          <p className={styles.inlineHint}>
            Selected wallet: {selectedWallet ? formatAddress(selectedWallet) : "none"}
          </p>
        </div>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {status ? <p className={styles.status}>{status}</p> : null}
      {isLoading ? <p className={styles.loading}>Loading onchain profile...</p> : null}

      <div className={styles.grid}>
        <article className={styles.card}>
          <span className={styles.cardLabel}>Session</span>
          <strong>{data?.session.x_handle ?? "@unknown"}</strong>
          <p>
            Island heat {data?.heat.island_heat ?? 0}. Tier {data?.heat.tier ?? "drifter"}.
          </p>
          <p className={styles.inlineHint}>
            X user id {data?.session.x_user_id ?? "pending"}.
          </p>
        </article>

        <article className={styles.card}>
          <span className={styles.cardLabel}>Profile state</span>
          {data?.profile ? (
            <>
              <strong>Profile #{data.profile.profile_id}</strong>
              <p>Main wallet {formatAddress(data.profile.main_wallet)}</p>
              <p>{data.profile.wallets.length} wallet(s) linked onchain.</p>
              {data.profile.hardcore_warning ? (
                <p className={styles.warning}>Warning flag is visible onchain for this profile.</p>
              ) : null}
            </>
          ) : (
            <>
              <strong>No onchain profile yet</strong>
              <p>Create the profile once, then every other wallet action hangs off it.</p>
            </>
          )}
        </article>

        <article className={styles.card}>
          <span className={styles.cardLabel}>Daily JBM</span>
          <strong>{Math.round(data?.heat.active_bond_heat ?? 0)} active bond heat</strong>
          <p>
            No user approval is needed here. The contract pulls from escrow after the backend signs the claim.
          </p>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={handleClaimDaily}
            disabled={txBusy || !data?.profile || !walletLinkedOnchain}
          >
            Claim daily JBM
          </button>
        </article>
      </div>

      <div className={styles.actionsRow}>
        {!data?.profile ? (
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleRegister}
            disabled={txBusy || !selectedWallet}
          >
            Create profile
          </button>
        ) : !walletLinkedOnchain ? (
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleLinkWallet}
            disabled={txBusy || !selectedWallet}
          >
            Link wallet
          </button>
        ) : (
          <div className={styles.readyState}>
            <strong>Wallet linked</strong>
            <span>This wallet can sign bungalow, Bodega, commission, and daily-claim actions.</span>
          </div>
        )}
      </div>

      <div className={styles.linksGrid}>
        <Link to="/bodega" className={styles.linkCard}>
          <strong>Open Bodega</strong>
          <span>List items, install items, and activate permanent bungalow bonds.</span>
        </Link>
        <Link to="/commissions" className={styles.linkCard}>
          <strong>Open commissions</strong>
          <span>Publish work, apply, select artists, and settle onchain.</span>
        </Link>
      </div>
    </section>
  );
}
