import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { type Address, parseUnits } from "viem";
import type { LayoutOutletContext } from "../components/Layout";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import styles from "../styles/commissions-page.module.css";
import {
  type AppCommissionsState,
  commissionManagerAbi,
  confirmTrackedTx,
  fetchAuthedJson,
  fetchJson,
  formatUnixDate,
  formatUsdcAmount,
  normalizeTxError,
  ONCHAIN_CONTRACTS,
  trackSubmittedTx,
} from "../utils/onchain";

const SCOPES = ["open", "requesting", "working", "resolved"] as const;

export default function CommissionsPage() {
  const selectionWindowSeconds = 24 * 60 * 60;
  const { authenticated, getAccessToken } = usePrivy();
  const { refreshMeState } = useOutletContext<LayoutOutletContext>();
  const { publicClient, requireWallet } = usePrivyBaseWallet();
  const [scope, setScope] = useState<(typeof SCOPES)[number]>("open");
  const [data, setData] = useState<AppCommissionsState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [txBusy, setTxBusy] = useState(false);
  const [form, setForm] = useState({
    bungalowId: "",
    promptUri: "",
    budgetUsdc: "",
    deadline: "",
  });

  const refetch = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const payload = authenticated
        ? await fetchAuthedJson<AppCommissionsState>(
            `/api/state/commissions?scope=${scope}`,
            getAccessToken,
          )
        : await fetchJson<AppCommissionsState>(`/api/state/commissions?scope=${scope}`);
      setData(payload);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error ? fetchError.message : "Failed to load commissions",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refetch();
  }, [authenticated, scope]);

  const handlePublish = async () => {
    setTxBusy(true);
    setError(null);
    setStatus("Publishing commission...");

    try {
      const { address, walletClient } = await requireWallet();
      const bungalowId = Number.parseInt(form.bungalowId, 10);
      const budget = parseUnits(form.budgetUsdc.trim(), 6);
      const deadline = Math.floor(new Date(form.deadline).getTime() / 1000);

      if (!Number.isFinite(deadline) || deadline <= Math.floor(Date.now() / 1000) + selectionWindowSeconds) {
        throw new Error("Deadline must be at least 24 hours in the future.");
      }

      const txHash = await walletClient.writeContract({
        account: address as Address,
        address: ONCHAIN_CONTRACTS.commissionManager,
        abi: commissionManagerAbi,
        functionName: "publishCommission",
        args: [BigInt(bungalowId), form.promptUri.trim(), budget, BigInt(deadline)],
      });

      await trackSubmittedTx({
        getAccessToken,
        txHash,
        action: "commission_publish",
        functionName: "publishCommission",
        contractAddress: ONCHAIN_CONTRACTS.commissionManager,
        wallet: address,
        bungalowId,
      });

      setStatus("Waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      await confirmTrackedTx(getAccessToken, txHash);
      await Promise.all([refetch(), refreshMeState()]);
      setStatus("Commission published.");
    } catch (txError) {
      setError(normalizeTxError(txError, "Publish failed"));
      setStatus(null);
    } finally {
      setTxBusy(false);
    }
  };

  return (
    <section className={styles.page}>
      <div className={styles.hero}>
        <div>
          <p className={styles.kicker}>Commission board</p>
          <h1>Publish work with a bungalow, a budget, and a deadline.</h1>
          <p className={styles.summary}>
            Publishing does not lock USDC. Locking happens only when you select
            an artist on the detail page. Review windows, timeout payout, and
            missed-deadline reclaim are all enforced onchain.
          </p>
        </div>
        <div className={styles.callout}>
          <strong>USDC lock spender</strong>
          <span>{ONCHAIN_CONTRACTS.commissionManager}</span>
        </div>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {status ? <p className={styles.status}>{status}</p> : null}
      {isLoading ? <p className={styles.loading}>Loading commission board...</p> : null}

      <div className={styles.formCard}>
        <span className={styles.cardLabel}>Publish commission</span>
        <label>
          Bungalow id
          <input
            value={form.bungalowId}
            onChange={(event) => setForm((current) => ({ ...current, bungalowId: event.target.value }))}
            placeholder="123"
          />
        </label>
        <label>
          Prompt URI
          <input
            value={form.promptUri}
            onChange={(event) => setForm((current) => ({ ...current, promptUri: event.target.value }))}
            placeholder="ipfs://..."
          />
        </label>
        <label>
          Budget in USDC
          <input
            value={form.budgetUsdc}
            onChange={(event) => setForm((current) => ({ ...current, budgetUsdc: event.target.value }))}
            placeholder="250"
          />
        </label>
        <label>
          Submission deadline
          <input
            type="datetime-local"
            value={form.deadline}
            onChange={(event) => setForm((current) => ({ ...current, deadline: event.target.value }))}
          />
        </label>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => void handlePublish()}
          disabled={txBusy || !data?.me?.profile || !form.bungalowId || !form.promptUri || !form.budgetUsdc || !form.deadline}
        >
          Publish commission
        </button>
        {!data?.me?.profile ? (
          <p className={styles.inlineHint}>Create your profile first before publishing or applying.</p>
        ) : null}
      </div>

      <div className={styles.scopeRow}>
        {SCOPES.map((entry) => (
          <button
            key={entry}
            type="button"
            className={scope === entry ? styles.scopeActive : styles.scopeButton}
            onClick={() => setScope(entry)}
          >
            {entry}
          </button>
        ))}
      </div>

      <div className={styles.list}>
        {data?.items.map((item) => (
          <Link
            key={item.commission_id}
            to={`/commissions/${item.commission_id}`}
            className={styles.listCard}
          >
            <div className={styles.itemHeader}>
              <strong>Commission #{item.commission_id}</strong>
              <span>{item.status}</span>
            </div>
            <p>{item.prompt_uri}</p>
            <div className={styles.metaRow}>
              <span>{formatUsdcAmount(item.budget_usdc)} USDC</span>
              <span>{item.bungalow_name ?? `${item.seed_chain}:${item.seed_token_address}`}</span>
              <span>{item.application_count} application(s)</span>
              <span>{formatUnixDate(item.deadline_unix)}</span>
            </div>
            {item.requester_rejections !== "0" || item.requester_warning ? (
              <p className={styles.inlineHint}>
                {item.requester_warning
                  ? `Requester warning flag onchain. Rejections: ${item.requester_rejections}.`
                  : `Requester rejections on record: ${item.requester_rejections}.`}
              </p>
            ) : null}
          </Link>
        ))}
      </div>
    </section>
  );
}
