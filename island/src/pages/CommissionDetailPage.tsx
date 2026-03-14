import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { type Address, parseUnits } from "viem";
import type { LayoutOutletContext } from "../components/Layout";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import styles from "../styles/commission-detail-page.module.css";
import {
  type AppCommissionDetailState,
  commissionManagerAbi,
  confirmTrackedTx,
  ensureUsdcAllowance,
  fetchAuthedJson,
  fetchJson,
  formatUnixDate,
  formatUsdcAmount,
  normalizeTxError,
  ONCHAIN_CONTRACTS,
  parseUsdcRaw,
  trackSubmittedTx,
} from "../utils/onchain";

function asNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown): boolean {
  return Boolean(value);
}

export default function CommissionDetailPage() {
  const { commission_id } = useParams<{ commission_id: string }>();
  const { authenticated, getAccessToken } = usePrivy();
  const { refreshMeState } = useOutletContext<LayoutOutletContext>();
  const { publicClient, requireWallet } = usePrivyBaseWallet();
  const [data, setData] = useState<AppCommissionDetailState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [txBusy, setTxBusy] = useState(false);
  const [applyUri, setApplyUri] = useState("");
  const [applyPrice, setApplyPrice] = useState("");
  const [deliverableUri, setDeliverableUri] = useState("");

  const commissionId = Number.parseInt(commission_id ?? "0", 10);

  const refetch = async () => {
    if (!Number.isFinite(commissionId) || commissionId <= 0) {
      setError("Invalid commission id.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const payload = authenticated
        ? await fetchAuthedJson<AppCommissionDetailState>(
            `/api/state/commissions/${commissionId}`,
            getAccessToken,
          )
        : await fetchJson<AppCommissionDetailState>(`/api/state/commissions/${commissionId}`);
      setData(payload);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load commission");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refetch();
  }, [commissionId, authenticated]);

  const commission = data?.commission ?? null;
  const viewer = data?.viewer ?? {};
  const applications = data?.applications ?? [];

  const runWrite = async (input: {
    label: string;
    action: string;
    functionName:
      | "applyToCommission"
      | "selectArtist"
      | "submitDeliverable"
      | "approveCommission"
      | "rejectCommission"
      | "claimTimedOutPayout"
      | "claimMissedDeadlineRefund"
      | "expireCommission";
    args: readonly unknown[];
    usdcAmount?: bigint;
    applicationId?: number | null;
  }) => {
    setTxBusy(true);
    setError(null);
    setStatus(input.label);

    try {
      const { address, walletClient } = await requireWallet();
      if ((input.usdcAmount ?? 0n) > 0n) {
        setStatus(
          `Approval required: allow USDC spending by ${ONCHAIN_CONTRACTS.commissionManager}.`,
        );
        const approvalTx = await ensureUsdcAllowance({
          publicClient,
          walletClient,
          owner: address as Address,
          spender: ONCHAIN_CONTRACTS.commissionManager,
          amount: input.usdcAmount ?? 0n,
        });
        if (approvalTx) {
          await publicClient.waitForTransactionReceipt({ hash: approvalTx });
        }
      }

      setStatus("Sending wallet transaction...");
      const txHash = await walletClient.writeContract({
        account: address as Address,
        address: ONCHAIN_CONTRACTS.commissionManager,
        abi: commissionManagerAbi,
        functionName: input.functionName,
        args: input.args as never,
      });

      await trackSubmittedTx({
        getAccessToken,
        txHash,
        action: input.action,
        functionName: input.functionName,
        contractAddress: ONCHAIN_CONTRACTS.commissionManager,
        wallet: address,
        commissionId,
        applicationId: input.applicationId ?? null,
      });

      setStatus("Waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      await confirmTrackedTx(getAccessToken, txHash);
      await Promise.all([refetch(), refreshMeState()]);
      setStatus("Commission state updated.");
    } catch (txError) {
      setError(normalizeTxError(txError, "Transaction failed"));
      setStatus(null);
    } finally {
      setTxBusy(false);
    }
  };

  const selectedApplication = useMemo(() => {
    const approvedArtistId = asNumber(commission?.selected_artist_profile_id);
    return applications.find(
      (entry) => asNumber(entry.artist_profile_id) === approvedArtistId,
    ) ?? null;
  }, [applications, commission]);

  if (!Number.isFinite(commissionId) || commissionId <= 0) {
    return <section className={styles.page}>Invalid commission id.</section>;
  }

  if (isLoading && !data) {
    return <section className={styles.page}>Loading commission...</section>;
  }

  if (!commission) {
    return (
      <section className={styles.page}>
        <p className={styles.error}>{error ?? "Commission not found."}</p>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <div className={styles.hero}>
        <div>
          <p className={styles.kicker}>Commission #{commissionId}</p>
          <h1>{asString(commission.bungalow_name) || `Bungalow ${asNumber(commission.bungalow_id)}`}</h1>
          <p className={styles.summary}>{asString(commission.prompt_uri)}</p>
        </div>
        <div className={styles.callout}>
          <strong>{String(commission.status)}</strong>
          <span>{formatUsdcAmount(asString(commission.budget_usdc))} USDC budget</span>
          <small>Deadline {formatUnixDate(asNumber(commission.deadline_unix))}</small>
        </div>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {status ? <p className={styles.status}>{status}</p> : null}

      <div className={styles.metaGrid}>
        <article className={styles.card}>
          <span className={styles.cardLabel}>Requester</span>
          <strong>{asString(commission.requester_handle) || `Profile ${asNumber(commission.requester_profile_id)}`}</strong>
          <p>{asString(commission.seed_chain)}:{asString(commission.seed_token_address)}</p>
          <p>Rejections {asString(commission.requester_rejections)}</p>
          <p>{asBoolean(commission.requester_warning) ? "Requester warning flag onchain." : "No warning flag."}</p>
        </article>

        <article className={styles.card}>
          <span className={styles.cardLabel}>Selected artist</span>
          <strong>
            {asString(commission.selected_artist_handle) || (asNumber(commission.selected_artist_profile_id) ? `Profile ${asNumber(commission.selected_artist_profile_id)}` : "No artist selected")}
          </strong>
          <p>Reputation {asString(commission.artist_reputation)}</p>
          <p>{asBoolean(commission.artist_warning) ? "Warning flag onchain." : "No warning flag."}</p>
        </article>
      </div>

      <div className={styles.actionsGrid}>
        {asBoolean(viewer.can_apply) ? (
          <article className={styles.actionCard}>
            <span className={styles.cardLabel}>Apply</span>
            <label>
              Pitch URI
              <input value={applyUri} onChange={(event) => setApplyUri(event.target.value)} placeholder="ipfs://..." />
            </label>
            <label>
              Proposed price in USDC
              <input value={applyPrice} onChange={(event) => setApplyPrice(event.target.value)} placeholder="150" />
            </label>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() =>
                void runWrite({
                  label: "Applying to commission...",
                  action: "commission_apply",
                  functionName: "applyToCommission",
                  args: [
                    BigInt(commissionId),
                    applyUri.trim(),
                    parseUnits(applyPrice.trim(), 6),
                  ],
                })
              }
              disabled={txBusy || !applyUri.trim() || !applyPrice.trim()}
            >
              Apply
            </button>
          </article>
        ) : null}

        {asBoolean(viewer.can_submit_work) ? (
          <article className={styles.actionCard}>
            <span className={styles.cardLabel}>Submit work</span>
            <label>
              Deliverable URI
              <input value={deliverableUri} onChange={(event) => setDeliverableUri(event.target.value)} placeholder="ipfs://..." />
            </label>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() =>
                void runWrite({
                  label: "Submitting deliverable...",
                  action: "commission_submit",
                  functionName: "submitDeliverable",
                  args: [BigInt(commissionId), deliverableUri.trim()],
                })
              }
              disabled={txBusy || !deliverableUri.trim()}
            >
              Submit work
            </button>
          </article>
        ) : null}

        {asBoolean(viewer.can_approve_payout) ? (
          <article className={styles.actionCard}>
            <span className={styles.cardLabel}>Approve payout</span>
            <p>Approving pays the artist and lists the deliverable in Bodega as a free infinite item.</p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() =>
                void runWrite({
                  label: "Approving payout...",
                  action: "commission_approve",
                  functionName: "approveCommission",
                  args: [BigInt(commissionId)],
                })
              }
              disabled={txBusy}
            >
              Approve payout
            </button>
          </article>
        ) : null}

        {asBoolean(viewer.can_reject_refund) ? (
          <article className={styles.actionCard}>
            <span className={styles.cardLabel}>Reject and refund</span>
            <p>Rejecting returns the locked USDC and increments the requester rejection count onchain.</p>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() =>
                void runWrite({
                  label: "Rejecting commission...",
                  action: "commission_reject",
                  functionName: "rejectCommission",
                  args: [BigInt(commissionId)],
                })
              }
              disabled={txBusy}
            >
              Reject and refund
            </button>
          </article>
        ) : null}

        {asBoolean(viewer.can_claim_timeout) ? (
          <article className={styles.actionCard}>
            <span className={styles.cardLabel}>Timeout payout</span>
            <p>The review window is over. The selected artist can settle directly now.</p>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() =>
                void runWrite({
                  label: "Claiming timeout payout...",
                  action: "commission_timeout",
                  functionName: "claimTimedOutPayout",
                  args: [BigInt(commissionId)],
                })
              }
              disabled={txBusy}
            >
              Claim timeout payout
            </button>
          </article>
        ) : null}

        {asBoolean(viewer.can_reclaim_missed_deadline) ? (
          <article className={styles.actionCard}>
            <span className={styles.cardLabel}>Missed-deadline reclaim</span>
            <p>The artist missed the submission deadline. The requester can reclaim locked USDC.</p>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() =>
                void runWrite({
                  label: "Reclaiming missed-deadline refund...",
                  action: "commission_deadline_reclaim",
                  functionName: "claimMissedDeadlineRefund",
                  args: [BigInt(commissionId)],
                })
              }
              disabled={txBusy}
            >
              Reclaim locked USDC
            </button>
          </article>
        ) : null}

        {asBoolean(viewer.can_expire) ? (
          <article className={styles.actionCard}>
            <span className={styles.cardLabel}>Expire commission</span>
            <p>No artist was selected during the 24 hour selection window.</p>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() =>
                void runWrite({
                  label: "Expiring commission...",
                  action: "commission_expire",
                  functionName: "expireCommission",
                  args: [BigInt(commissionId)],
                })
              }
              disabled={txBusy}
            >
              Expire
            </button>
          </article>
        ) : null}
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <strong>Applications</strong>
          <Link to="/commissions">Back to board</Link>
        </div>
        {applications.length === 0 ? (
          <p className={styles.inlineCopy}>No applications yet.</p>
        ) : (
          <div className={styles.applicationList}>
            {applications.map((application) => {
              const applicationId = asNumber(application.application_id);
              const proposedPrice = parseUsdcRaw(application.proposed_price_usdc);
              const isSelected =
                selectedApplication &&
                asNumber(selectedApplication.application_id) === applicationId;

              return (
                <article key={applicationId} className={styles.applicationCard}>
                  <div className={styles.itemHeader}>
                    <strong>{asString(application.artist_handle) || `Profile ${asNumber(application.artist_profile_id)}`}</strong>
                    <span>{formatUsdcAmount(asString(application.proposed_price_usdc))} USDC</span>
                  </div>
                  <p>{asString(application.pitch_uri)}</p>
                  <small>{formatUnixDate(asNumber(application.applied_at_unix))}</small>
                  {asBoolean(viewer.can_select_artist) && !isSelected ? (
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() =>
                        void runWrite({
                          label: "Selecting artist and locking USDC...",
                          action: "commission_select_artist",
                          functionName: "selectArtist",
                          args: [BigInt(commissionId), BigInt(applicationId)],
                          applicationId,
                          usdcAmount: proposedPrice,
                        })
                      }
                      disabled={txBusy}
                    >
                      Select artist
                    </button>
                  ) : isSelected ? (
                    <p className={styles.inlineHint}>Selected artist.</p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
