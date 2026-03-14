import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useOutletContext } from "react-router-dom";
import { type Address, parseUnits } from "viem";
import type { LayoutOutletContext } from "../components/Layout";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import styles from "../styles/bodega-page.module.css";
import {
  type AppBodegaState,
  bodegaAbi,
  confirmTrackedTx,
  ensureUsdcAllowance,
  fetchAuthedJson,
  fetchJson,
  formatUnixDate,
  formatUsdcAmount,
  islandIdentityAbi,
  normalizeTxError,
  ONCHAIN_CONTRACTS,
  trackSubmittedTx,
  type OnchainBodegaItem,
} from "../utils/onchain";

export default function BodegaPage() {
  const { getAccessToken } = usePrivy();
  const { meState, refreshMeState } = useOutletContext<LayoutOutletContext>();
  const { publicClient, requireWallet } = usePrivyBaseWallet();
  const [items, setItems] = useState<OnchainBodegaItem[]>([]);
  const [highlightedArtists, setHighlightedArtists] = useState<AppBodegaState["highlighted_artists"]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [txBusy, setTxBusy] = useState(false);
  const [listForm, setListForm] = useState({
    ipfsUri: "",
    supply: "0",
    priceUsdc: "0",
  });
  const [installTargets, setInstallTargets] = useState<Record<number, string>>({});

  const refetch = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const payload = await fetchJson<AppBodegaState>("/api/state/bodega");
      setItems(payload.items);
      setHighlightedArtists(payload.highlighted_artists);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load Bodega");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refetch();
  }, []);

  const syncHeatForInstallIfNeeded = async (input: {
    address: Address;
    walletClient: any;
    bungalowId: number;
  }) => {
    const profileId = await publicClient.readContract({
      address: ONCHAIN_CONTRACTS.islandIdentity,
      abi: islandIdentityAbi,
      functionName: "walletProfileId",
      args: [input.address],
    }) as bigint;

    if (profileId === 0n) {
      throw new Error("Link this wallet onchain before installing items.");
    }

    const onchainHeat = await publicClient.readContract({
      address: ONCHAIN_CONTRACTS.islandIdentity,
      abi: islandIdentityAbi,
      functionName: "getHeat",
      args: [profileId, BigInt(input.bungalowId)],
    }) as bigint;

    if (onchainHeat >= 10n) {
      return;
    }

    setStatus("Preparing bungalow heat sync...");
    const signature = await fetchAuthedJson<Record<string, string | number>>(
      `/api/onchain/bungalows/${input.bungalowId}/sync-heat/sign`,
      getAccessToken,
      {
        method: "POST",
        body: JSON.stringify({ wallet: input.address }),
      },
    );

    const syncedHeat = BigInt(String(signature.heat_score ?? "0"));
    if (syncedHeat < 10n) {
      throw new Error(
        `Heat ${syncedHeat.toString()} is below the install floor for bungalow #${input.bungalowId}.`,
      );
    }

    setStatus("Syncing bungalow heat...");
    const syncTxHash = await input.walletClient.writeContract({
      account: input.address,
      address: ONCHAIN_CONTRACTS.islandIdentity,
      abi: islandIdentityAbi,
      functionName: "syncHeat",
      args: [
        BigInt(String(signature.profile_id ?? "0")),
        BigInt(String(signature.bungalow_id ?? "0")),
        syncedHeat,
        String(signature.salt ?? "") as `0x${string}`,
        BigInt(String(signature.deadline ?? "0")),
        String(signature.sig ?? "") as `0x${string}`,
      ],
    });

    await trackSubmittedTx({
      getAccessToken,
      txHash: syncTxHash,
      action: "identity_sync_heat",
      functionName: "syncHeat",
      contractAddress: ONCHAIN_CONTRACTS.islandIdentity,
      wallet: input.address,
      bungalowId: input.bungalowId,
      profileId: Number(signature.profile_id ?? 0),
      metadata: {
        heat_score: syncedHeat.toString(),
      },
    });

    await publicClient.waitForTransactionReceipt({ hash: syncTxHash });
    await confirmTrackedTx(getAccessToken, syncTxHash);
  };

  const runWrite = async (input: {
    label: string;
    action: string;
    functionName: "listItem" | "installItem";
    args: readonly unknown[];
    usdcAmount?: bigint;
    bungalowId?: number | null;
    itemId?: number | null;
  }) => {
    setTxBusy(true);
    setError(null);
    setStatus(input.label);

    try {
      const { address, walletClient } = await requireWallet();
      if (input.functionName === "installItem" && input.bungalowId) {
        await syncHeatForInstallIfNeeded({
          address: address as Address,
          walletClient,
          bungalowId: input.bungalowId,
        });
      }

      if ((input.usdcAmount ?? 0n) > 0n) {
        setStatus(
          `Approval required: allow USDC spending by ${ONCHAIN_CONTRACTS.bodega}.`,
        );
        const approvalTx = await ensureUsdcAllowance({
          publicClient,
          walletClient,
          owner: address as Address,
          spender: ONCHAIN_CONTRACTS.bodega,
          amount: input.usdcAmount ?? 0n,
        });

        if (approvalTx) {
          await publicClient.waitForTransactionReceipt({ hash: approvalTx });
        }
      }

      setStatus("Sending wallet transaction...");
      const txHash = await walletClient.writeContract({
        account: address as Address,
        address: ONCHAIN_CONTRACTS.bodega,
        abi: bodegaAbi,
        functionName: input.functionName,
        args: input.args as never,
      });

      await trackSubmittedTx({
        getAccessToken,
        txHash,
        action: input.action,
        functionName: input.functionName,
        contractAddress: ONCHAIN_CONTRACTS.bodega,
        wallet: address,
        bungalowId: input.bungalowId ?? null,
        itemId: input.itemId ?? null,
      });

      setStatus("Waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      await confirmTrackedTx(getAccessToken, txHash);
      await Promise.all([refetch(), refreshMeState()]);
      setStatus("Bodega state updated.");
    } catch (txError) {
      setError(normalizeTxError(txError, "Transaction failed"));
      setStatus(null);
    } finally {
      setTxBusy(false);
    }
  };

  const handleListItem = async () => {
    const supply = BigInt(listForm.supply.trim() || "0");
    const priceUsdc = listForm.priceUsdc.trim()
      ? parseUnits(listForm.priceUsdc.trim(), 6)
      : 0n;

    await runWrite({
      label: "Listing item...",
      action: "bodega_list_item",
      functionName: "listItem",
      args: [listForm.ipfsUri.trim(), supply, priceUsdc],
    });
  };

  const handleInstallItem = async (item: OnchainBodegaItem) => {
    const bungalowId = Number.parseInt(installTargets[item.item_id] ?? "", 10);
    if (!Number.isFinite(bungalowId) || bungalowId <= 0) {
      setError("Enter a valid bungalow id before installing.");
      return;
    }

    await runWrite({
      label: "Installing item...",
      action: "bodega_install_item",
      functionName: "installItem",
      args: [BigInt(item.item_id), BigInt(bungalowId)],
      bungalowId,
      itemId: item.item_id,
      usdcAmount: BigInt(item.price_usdc),
    });
  };

  return (
    <section className={styles.page}>
      <div className={styles.hero}>
        <div>
          <p className={styles.kicker}>Bodega</p>
          <h1>List items. Install them where the heat is real.</h1>
          <p className={styles.summary}>
            Install is mint plus install in one atomic action. Heat must already
            be at least 10 for that bungalow, and the first install there
            activates the permanent JBM bond forever.
          </p>
        </div>
        <div className={styles.callout}>
          <strong>USDC spender</strong>
          <span>{ONCHAIN_CONTRACTS.bodega}</span>
          <small>Approval is requested only when the selected item is paid.</small>
        </div>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {status ? <p className={styles.status}>{status}</p> : null}
      {isLoading ? <p className={styles.loading}>Loading Bodega...</p> : null}

      <div className={styles.grid}>
        <article className={styles.formCard}>
          <span className={styles.cardLabel}>List item</span>
          <label>
            IPFS URI
            <input
              value={listForm.ipfsUri}
              onChange={(event) =>
                setListForm((current) => ({ ...current, ipfsUri: event.target.value }))
              }
              placeholder="ipfs://..."
            />
          </label>
          <label>
            Supply
            <input
              value={listForm.supply}
              onChange={(event) =>
                setListForm((current) => ({ ...current, supply: event.target.value }))
              }
              placeholder="0 for infinite"
            />
          </label>
          <label>
            Price in USDC
            <input
              value={listForm.priceUsdc}
              onChange={(event) =>
                setListForm((current) => ({ ...current, priceUsdc: event.target.value }))
              }
              placeholder="0 for free"
            />
          </label>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleListItem()}
            disabled={txBusy || !meState?.me?.profile || !listForm.ipfsUri.trim()}
          >
            List item
          </button>
          {!meState?.me?.profile ? (
            <p className={styles.inlineHint}>
              Create your profile first before listing anything in the Bodega.
            </p>
          ) : null}
        </article>

        <article className={styles.formCard}>
          <span className={styles.cardLabel}>Install rules</span>
          <strong>Heat gate: 10+</strong>
          <p>
            If your onchain heat is stale, install automatically syncs it before
            calling Bodega.
          </p>
          <strong>Bond activation</strong>
          <p>
            The first successful install in a bungalow activates a permanent JBM
            bond for your profile there.
          </p>
        </article>
      </div>

      {highlightedArtists.length > 0 ? (
        <div className={styles.catalog}>
          {highlightedArtists.map((artist) => (
            <article key={artist.artist_profile_id} className={styles.itemCard}>
              <div className={styles.itemHeader}>
                <strong>
                  {artist.artist_handle ? `@${artist.artist_handle}` : `Profile ${artist.artist_profile_id}`}
                </strong>
                <span>Bayla highlight</span>
              </div>
              <p className={styles.uri}>{artist.rationale}</p>
              <div className={styles.metaRow}>
                <span>Score {artist.score.toFixed(2)}</span>
                <span>{artist.metrics.total_installs} installs</span>
                <span>{artist.metrics.distinct_bungalows} bungalows</span>
              </div>
              <small>
                Featured piece #{artist.feature_item.item_id} · {artist.feature_item.ipfs_uri}
              </small>
            </article>
          ))}
        </div>
      ) : null}

      <div className={styles.catalog}>
        {items.map((item) => (
          <article key={item.item_id} className={styles.itemCard}>
            <div className={styles.itemHeader}>
              <strong>Item #{item.item_id}</strong>
              <span>{item.commission_id ? "Commissioned" : "Open listing"}</span>
            </div>
            <p className={styles.uri}>{item.ipfs_uri}</p>
            <div className={styles.metaRow}>
              <span>{BigInt(item.price_usdc) > 0n ? `${formatUsdcAmount(item.price_usdc)} USDC` : "Free"}</span>
              <span>{item.supply === "0" ? "Infinite supply" : `${item.total_minted}/${item.supply}`}</span>
              <span>{item.creator_handle ? `@${item.creator_handle}` : `Profile ${item.creator_profile_id}`}</span>
            </div>
            <div className={styles.installRow}>
              <input
                value={installTargets[item.item_id] ?? ""}
                onChange={(event) =>
                  setInstallTargets((current) => ({
                    ...current,
                    [item.item_id]: event.target.value,
                  }))
                }
                placeholder="Bungalow id"
              />
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleInstallItem(item)}
                disabled={txBusy || !meState?.me?.profile}
              >
                Install item
              </button>
            </div>
            <small>{formatUnixDate(item.listed_at_unix)}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
