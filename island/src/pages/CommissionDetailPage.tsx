import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useNavigate, useParams } from "react-router-dom";
import WalletSelector, { type WalletSelectorState } from "../components/WalletSelector";
import { useMemeticsProfile } from "../hooks/useMemeticsProfile";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { formatAddress, formatJbmAmount, formatTimeAgo } from "../utils/formatters";
import {
  MEMETICS_CONTRACT_ADDRESS,
  getMemeticsErrorMessage,
  memeticsAbi,
} from "../utils/memetics";
import {
  formatCommissionDate,
  getCommissionStatusLabel,
  getCommissionStatusTone,
  normalizeCommissionDetailResponse,
  type CommissionApplication,
  type CommissionDetailResponse,
} from "../utils/commissions";
import styles from "../styles/commission-detail-page.module.css";

function isHexAddress(value: string | null | undefined): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function getEmptyDetailResponse(): CommissionDetailResponse {
  return {
    commission: null,
    applications: [],
    viewer: {
      authenticated: false,
      profile_id: null,
      wallets: [],
    },
  };
}

export default function CommissionDetailPage() {
  const { commission_id } = useParams();
  const navigate = useNavigate();
  const { authenticated, getAccessToken, login } = usePrivy();
  const {
    activeWallet,
    publicClient,
    requireWallet,
    setActiveWallet,
    walletAddress,
  } = usePrivyBaseWallet();
  const { data: memeticsProfile, refetch: refetchMemeticsProfile } =
    useMemeticsProfile(authenticated);

  const [data, setData] = useState<CommissionDetailResponse>(
    getEmptyDetailResponse(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWallet, setSelectedWallet] = useState("");
  const [walletState, setWalletState] = useState<WalletSelectorState>({
    selectedWallet: null,
    selectedWalletAvailable: false,
    hasAvailableWallet: false,
    availableWallets: [],
    totalWallets: 0,
  });
  const [applicationMessage, setApplicationMessage] = useState("");
  const [deliverableUri, setDeliverableUri] = useState("");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const commissionId = Number(commission_id ?? 0);
  const commission = data.commission;
  const viewer = data.viewer;
  const onchainWallets = memeticsProfile?.profile?.wallets ?? [];

  useEffect(() => {
    if (!walletAddress) return;
    if (selectedWallet) return;
    setSelectedWallet(walletAddress);
  }, [selectedWallet, walletAddress]);

  useEffect(() => {
    if (commission?.deliverable_uri && !deliverableUri) {
      setDeliverableUri(commission.deliverable_uri);
    }
  }, [commission?.deliverable_uri, deliverableUri]);

  const loadCommission = useCallback(async () => {
    if (!commissionId) {
      setError("Invalid commission id.");
      setData(getEmptyDetailResponse());
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {};
      if (authenticated) {
        const token = await getAccessToken();
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
      }

      const response = await fetch(`/api/commissions/${commissionId}`, {
        headers,
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload?.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;
        throw new Error(message);
      }

      setData(normalizeCommissionDetailResponse(payload));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load commission",
      );
      setData(getEmptyDetailResponse());
    } finally {
      setIsLoading(false);
    }
  }, [authenticated, commissionId, getAccessToken]);

  useEffect(() => {
    void loadCommission();
  }, [loadCommission]);

  const getAuthHeaders = useCallback(async () => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = await getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }, [getAccessToken]);

  const prepareWallet = useCallback(async () => {
    if (!authenticated) {
      login();
      throw new Error("Connect your wallet first.");
    }

    if (!walletState.hasAvailableWallet || !selectedWallet) {
      throw new Error(
        "Choose a connected wallet that is already linked to your onchain profile.",
      );
    }

    if (selectedWallet.toLowerCase() !== activeWallet?.address.toLowerCase()) {
      setActiveWallet(selectedWallet);
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }

    const prepared = await requireWallet();
    if (prepared.address.toLowerCase() !== selectedWallet.toLowerCase()) {
      throw new Error("Switch to the selected wallet and try again.");
    }

    return prepared;
  }, [
    activeWallet?.address,
    authenticated,
    login,
    requireWallet,
    selectedWallet,
    setActiveWallet,
    walletState.hasAvailableWallet,
  ]);

  const postJson = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const response = await fetch(path, {
        method: "POST",
        headers: await getAuthHeaders(),
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload?.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;
        throw new Error(message);
      }
      return payload;
    },
    [getAuthHeaders],
  );

  const refreshFromPayload = useCallback(
    async (payload: unknown) => {
      setData(normalizeCommissionDetailResponse(payload));
      await refetchMemeticsProfile().catch(() => undefined);
    },
    [refetchMemeticsProfile],
  );

  const runContractAction = useCallback(
    async (input: {
      actionKey: string;
      pendingLabel: string;
      confirmPath: string;
      functionName:
        | "claimCommission"
        | "submitCommission"
        | "approveCommission"
        | "cancelCommission"
        | "claimTimedOutCommissionPayout";
      args: readonly unknown[];
    }) => {
      if (!commissionId || !commission) return;
      if (!isHexAddress(MEMETICS_CONTRACT_ADDRESS)) {
        throw new Error("VITE_MEMETICS_CONTRACT_ADDRESS is not configured.");
      }

      setPendingAction(input.actionKey);
      setActionError(null);
      setActionStatus(input.pendingLabel);

      try {
        const { address, walletClient } = await prepareWallet();
        const hash = await walletClient.writeContract({
          address: MEMETICS_CONTRACT_ADDRESS,
          abi: memeticsAbi,
          functionName: input.functionName,
          args: input.args as never,
          account: address,
          chain: undefined,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error("The transaction failed onchain.");
        }

        setActionStatus("Indexing the onchain change...");
        const payload = await postJson(input.confirmPath, {
          tx_hash: receipt.transactionHash,
        });
        await refreshFromPayload(payload);
        setActionStatus("Done.");
      } catch (contractError) {
        setActionError(
          getMemeticsErrorMessage(
            contractError,
            `Failed to ${input.actionKey.replace(/-/g, " ")}.`,
          ),
        );
        setActionStatus(null);
      } finally {
        setPendingAction(null);
      }
    },
    [commission, commissionId, postJson, prepareWallet, publicClient, refreshFromPayload],
  );

  const handleApply = async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (!walletState.hasAvailableWallet || !selectedWallet) {
      setActionError("Choose an onchain-linked wallet before applying.");
      return;
    }

    try {
      setPendingAction("apply");
      setActionError(null);
      setActionStatus("Submitting your application...");
      const payload = await postJson(`/api/commissions/${commissionId}/apply`, {
        wallet: selectedWallet,
        message: applicationMessage.trim(),
      });
      await loadCommission();
      void refetchMemeticsProfile().catch(() => undefined);
      setApplicationMessage("");
      setActionStatus(
        payload?.application?.status === "pending"
          ? "Application sent."
          : "Application updated.",
      );
    } catch (applyError) {
      setActionError(
        applyError instanceof Error
          ? applyError.message
          : "Failed to apply to this commission.",
      );
      setActionStatus(null);
    } finally {
      setPendingAction(null);
    }
  };

  const handleApproveApplication = async (application: CommissionApplication) => {
    if (!authenticated) {
      login();
      return;
    }

    try {
      setPendingAction(`approve-app-${application.id}`);
      setActionError(null);
      setActionStatus("Approving artist application...");
      const payload = await postJson(
        `/api/commissions/${commissionId}/applications/${application.id}/approve`,
        {},
      );
      await refreshFromPayload(payload);
      setActionStatus("Artist approved. They can now claim the commission onchain.");
    } catch (approveError) {
      setActionError(
        approveError instanceof Error
          ? approveError.message
          : "Failed to approve this artist.",
      );
      setActionStatus(null);
    } finally {
      setPendingAction(null);
    }
  };

  if (isLoading) {
    return (
      <section className={styles.page}>
        <div className={styles.statusCard}>
          <strong>Loading commission...</strong>
        </div>
      </section>
    );
  }

  if (error || !commission) {
    return (
      <section className={styles.page}>
        <div className={styles.statusCard}>
          <strong>Could not load this commission.</strong>
          <span>{error ?? "The commission record is unavailable."}</span>
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void loadCommission()}
            >
              Retry
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => navigate("/commissions")}
            >
              Back to board
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.kickerRow}>
            <p className={styles.kicker}>Commission #{commission.commission_id}</p>
            <span
              className={styles.statusPill}
              data-tone={getCommissionStatusTone(commission.status)}
            >
              {getCommissionStatusLabel(commission.status)}
            </span>
          </div>
          <h1>{commission.rate_label}</h1>
          <p className={styles.summary}>{commission.prompt}</p>
        </div>

        <div className={styles.heroMeta}>
          <div className={styles.metric}>
            <span>Budget</span>
            <strong>{formatJbmAmount(commission.budget_jbm)}</strong>
          </div>
          <div className={styles.metric}>
            <span>Delivery</span>
            <strong>{formatCommissionDate(commission.delivery_deadline)}</strong>
          </div>
          <div className={styles.metric}>
            <span>Bungalow</span>
            <strong>{commission.bungalow_name ?? commission.bungalow_token_address}</strong>
          </div>
        </div>
      </header>

      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <h2>Commission brief</h2>
              <a
                className={styles.inlineLink}
                href={`/bungalow/${commission.bungalow_token_address}?chain=${encodeURIComponent(
                  commission.bungalow_chain,
                )}`}
              >
                View bungalow
              </a>
            </div>
            <dl className={styles.metaGrid}>
              <div>
                <dt>Requester</dt>
                <dd>
                  {commission.requester_handle
                    ? `@${commission.requester_handle}`
                    : formatAddress(commission.requester_wallet)}
                </dd>
              </div>
              <div>
                <dt>Applications</dt>
                <dd>{commission.applications_count}</dd>
              </div>
              <div>
                <dt>Claim deadline</dt>
                <dd>{formatCommissionDate(commission.claim_deadline)}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatCommissionDate(commission.created_at)}</dd>
              </div>
            </dl>
            <p className={styles.longCopy}>{commission.prompt}</p>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <h2>Artist queue</h2>
              <span className={styles.cardMeta}>
                {commission.applications_count} applications
              </span>
            </div>

            {data.applications.length === 0 ? (
              <div className={styles.emptyState}>
                No artists are queued yet.
              </div>
            ) : (
              <div className={styles.applicationList}>
                {data.applications.map((application) => (
                  <article
                    key={application.id}
                    className={styles.applicationCard}
                    data-status={application.status}
                  >
                    <div className={styles.applicationTop}>
                      <strong>
                        {application.artist_handle
                          ? `@${application.artist_handle}`
                          : formatAddress(application.artist_wallet)}
                      </strong>
                      <span className={styles.applicationStatus}>
                        {application.status}
                      </span>
                    </div>
                    <p className={styles.applicationMeta}>
                      applied {formatTimeAgo(application.created_at)}
                    </p>
                    <p className={styles.applicationMessage}>
                      {application.message || "No note attached to this application."}
                    </p>

                    {viewer.can_approve_artist && application.status === "pending" ? (
                      <button
                        type="button"
                        className={styles.primaryButton}
                        disabled={Boolean(pendingAction)}
                        onClick={() => {
                          void handleApproveApplication(application);
                        }}
                      >
                        Approve this artist
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className={styles.sidebar}>
          {(viewer.can_apply ||
            viewer.can_claim ||
            viewer.can_submit ||
            viewer.can_approve_completion ||
            viewer.can_cancel ||
            viewer.can_claim_timeout_payout) ? (
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Transaction wallet</h2>
              </div>
              <WalletSelector
                value={selectedWallet}
                onSelect={(wallet) => {
                  setSelectedWallet(wallet);
                  setActionError(null);
                }}
                label="Act with"
                panelMode="inline"
                eligibleWallets={onchainWallets}
                onStateChange={setWalletState}
              />
              <p className={styles.note}>
                Contract actions must come from a wallet already linked to your
                onchain profile.
              </p>
            </section>
          ) : null}

          {viewer.can_apply ? (
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Apply as artist</h2>
              </div>
              <textarea
                className={styles.textarea}
                value={applicationMessage}
                onChange={(event) => setApplicationMessage(event.target.value)}
                placeholder="Tell the requester how you’d approach this piece."
                rows={5}
                maxLength={1000}
              />
              <button
                type="button"
                className={styles.primaryButton}
                disabled={pendingAction === "apply"}
                onClick={() => {
                  void handleApply();
                }}
              >
                {pendingAction === "apply" ? "Applying..." : "Apply"}
              </button>
            </section>
          ) : null}

          {viewer.can_claim ? (
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Claim commission</h2>
              </div>
              <p className={styles.note}>
                You were approved offchain. Claiming onchain starts the paid job.
              </p>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={pendingAction === "claim"}
                onClick={() => {
                  void runContractAction({
                    actionKey: "claim",
                    pendingLabel: "Claiming the commission onchain...",
                    confirmPath: `/api/commissions/${commissionId}/claim/confirm`,
                    functionName: "claimCommission",
                    args: [BigInt(commissionId)],
                  });
                }}
              >
                {pendingAction === "claim" ? "Claiming..." : "Claim onchain"}
              </button>
            </section>
          ) : null}

          {viewer.can_submit ? (
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Submit deliverable</h2>
              </div>
              <input
                className={styles.input}
                value={deliverableUri}
                onChange={(event) => setDeliverableUri(event.target.value)}
                placeholder="https://..."
              />
              <button
                type="button"
                className={styles.primaryButton}
                disabled={pendingAction === "submit"}
                onClick={() => {
                  if (!deliverableUri.trim()) {
                    setActionError("Add a deliverable URL before submitting.");
                    return;
                  }
                  void runContractAction({
                    actionKey: "submit",
                    pendingLabel: "Submitting the deliverable onchain...",
                    confirmPath: `/api/commissions/${commissionId}/submit/confirm`,
                    functionName: "submitCommission",
                    args: [BigInt(commissionId), deliverableUri.trim()],
                  });
                }}
              >
                {pendingAction === "submit" ? "Submitting..." : "Submit work"}
              </button>
            </section>
          ) : null}

          {viewer.can_approve_completion ? (
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Approve payout</h2>
              </div>
              <p className={styles.note}>
                Approving settles the escrow: 92% to the artist and 8% to the
                platform wallet.
              </p>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={pendingAction === "approve"}
                onClick={() => {
                  void runContractAction({
                    actionKey: "approve",
                    pendingLabel: "Approving payout onchain...",
                    confirmPath: `/api/commissions/${commissionId}/approve/confirm`,
                    functionName: "approveCommission",
                    args: [BigInt(commissionId)],
                  });
                }}
              >
                {pendingAction === "approve" ? "Approving..." : "Approve and pay"}
              </button>
            </section>
          ) : null}

          {viewer.can_cancel ? (
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Cancel commission</h2>
              </div>
              <p className={styles.note}>
                Cancelling refunds the remaining escrow back to the requester.
              </p>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={pendingAction === "cancel"}
                onClick={() => {
                  void runContractAction({
                    actionKey: "cancel",
                    pendingLabel: "Cancelling the commission onchain...",
                    confirmPath: `/api/commissions/${commissionId}/cancel/confirm`,
                    functionName: "cancelCommission",
                    args: [BigInt(commissionId)],
                  });
                }}
              >
                {pendingAction === "cancel" ? "Cancelling..." : "Cancel"}
              </button>
            </section>
          ) : null}

          {viewer.can_claim_timeout_payout ? (
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Timeout payout</h2>
              </div>
              <p className={styles.note}>
                The review window expired. You can settle your payout directly from
                the contract.
              </p>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={pendingAction === "timeout-payout"}
                onClick={() => {
                  void runContractAction({
                    actionKey: "timeout-payout",
                    pendingLabel: "Claiming the timed-out payout...",
                    confirmPath: `/api/commissions/${commissionId}/payout/confirm`,
                    functionName: "claimTimedOutCommissionPayout",
                    args: [BigInt(commissionId)],
                  });
                }}
              >
                {pendingAction === "timeout-payout"
                  ? "Claiming..."
                  : "Claim payout"}
              </button>
            </section>
          ) : null}

          {commission.deliverable_uri ? (
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Deliverable</h2>
              </div>
              <a
                className={styles.inlineLink}
                href={commission.deliverable_uri}
                target="_blank"
                rel="noreferrer"
              >
                Open final asset
              </a>
            </section>
          ) : null}

          {actionStatus || actionError ? (
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Action feed</h2>
              </div>
              {actionStatus ? <p className={styles.status}>{actionStatus}</p> : null}
              {actionError ? <p className={styles.error}>{actionError}</p> : null}
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
