import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { type Address } from "viem";
import { usePrivy } from "@privy-io/react-auth";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import styles from "../styles/bungalow-page.module.css";
import {
  confirmTrackedTx,
  ensureUsdcAllowance,
  fetchAuthedJson,
  fetchJson,
  formatUnixDate,
  formatUsdcAmount,
  islandIdentityAbi,
  jungleBayIslandAbi,
  normalizeTxError,
  ONCHAIN_CONTRACTS,
  trackSubmittedTx,
  type OnchainBungalowPage,
  type OnchainMeResponse,
} from "../utils/onchain";

function looksLikeAssetRef(value: string): boolean {
  return value.trim().length > 0;
}

function compactAddress(value: string): string {
  if (value.length < 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export default function BungalowPage() {
  const { identifier } = useParams<{ identifier: string }>();
  const [searchParams] = useSearchParams();
  const chain = (searchParams.get("chain") ?? "base").trim().toLowerCase();
  const assetRef = (identifier ?? "").trim();
  const { authenticated, getAccessToken } = usePrivy();
  const { publicClient, requireWallet } = usePrivyBaseWallet();
  const [page, setPage] = useState<OnchainBungalowPage | null>(null);
  const [me, setMe] = useState<OnchainMeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [txBusy, setTxBusy] = useState(false);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [ipfsHash, setIpfsHash] = useState("");
  const [linkChain, setLinkChain] = useState("ethereum");
  const [linkTokenAddress, setLinkTokenAddress] = useState("");

  const refetch = async () => {
    if (!looksLikeAssetRef(assetRef)) {
      setPage(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const headers = authenticated
        ? {
            Authorization: `Bearer ${(await getAccessToken()) ?? ""}`,
          }
        : undefined;

      const [bungalowPayload, mePayload] = await Promise.all([
        fetchJson<OnchainBungalowPage>(
          `/api/onchain/bungalows/${encodeURIComponent(chain)}/${encodeURIComponent(assetRef)}`,
          { headers },
        ),
        authenticated
          ? fetchAuthedJson<OnchainMeResponse>("/api/onchain/me", getAccessToken)
          : Promise.resolve(null),
      ]);

      setPage(bungalowPayload);
      setMe(mePayload);
      setName(bungalowPayload.name ?? "");
      setTicker(bungalowPayload.ticker ?? "");
      setIpfsHash(bungalowPayload.ipfs_hash ?? "");
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load bungalow");
      setPage(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refetch();
  }, [assetRef, authenticated, chain]);

  const canClaim = Boolean(me?.profile && !page?.exists);

  const runDirectWrite = async (input: {
    label: string;
    action: string;
    functionName:
      | "mintBungalow"
      | "syncHeat"
      | "setBungalowIdentity"
      | "updateBungalow"
      | "linkAsset"
      | "installItem";
    contractAddress: Address;
    abi: readonly unknown[];
    args: readonly unknown[];
    usdcApproval?: {
      spender: Address;
      amount: bigint;
      description: string;
    } | null;
    metadata?: Record<string, unknown>;
    bungalowId?: number | null;
    itemId?: number | null;
  }) => {
    setTxBusy(true);
    setError(null);
    setStatus(input.label);

    try {
      const { address, walletClient } = await requireWallet();

      if (input.usdcApproval && input.usdcApproval.amount > 0n) {
        setStatus(
          `Approval required: allow USDC spending by ${compactAddress(input.usdcApproval.spender)}.`,
        );
        const approvalTxHash = await ensureUsdcAllowance({
          publicClient,
          walletClient,
          owner: address as Address,
          spender: input.usdcApproval.spender,
          amount: input.usdcApproval.amount,
        });

        if (approvalTxHash) {
          await publicClient.waitForTransactionReceipt({ hash: approvalTxHash });
        }
      }

      setStatus("Sending wallet transaction...");
      const txHash = await walletClient.writeContract({
        account: address as Address,
        address: input.contractAddress,
        abi: input.abi,
        functionName: input.functionName,
        args: input.args as never,
      });

      await trackSubmittedTx({
        getAccessToken,
        txHash,
        action: input.action,
        functionName: input.functionName,
        contractAddress: input.contractAddress,
        wallet: address,
        bungalowId: input.bungalowId ?? null,
        itemId: input.itemId ?? null,
        tokenAddress: assetRef,
        metadata: input.metadata,
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

  const handleClaimBungalow = async () => {
    const { address } = await requireWallet();
    const quote = await fetchAuthedJson<Record<string, string | number | boolean>>(
      "/api/onchain/bungalows/mint-quote",
      getAccessToken,
      {
        method: "POST",
        body: JSON.stringify({
          wallet: address,
          chain,
          token_address: assetRef,
        }),
      },
    );

    if (quote.exists) {
      await refetch();
      return;
    }

    const priceRaw = BigInt(String(quote.price_usdc_raw ?? "0"));
    await runDirectWrite({
      label: "Requesting bungalow mint quote...",
      action: "bungalow_mint",
      functionName: "mintBungalow",
      contractAddress: ONCHAIN_CONTRACTS.jungleBayIsland,
      abi: jungleBayIslandAbi,
      args: [
        String(quote.chain ?? chain),
        String(quote.token_address ?? assetRef),
        priceRaw,
        String(quote.salt ?? "") as `0x${string}`,
        BigInt(String(quote.deadline ?? "0")),
        String(quote.sig ?? "") as `0x${string}`,
      ],
      usdcApproval: {
        spender: ONCHAIN_CONTRACTS.jungleBayIsland,
        amount: priceRaw,
        description: "Bungalow mint price approval",
      },
      metadata: {
        price_usdc_raw: priceRaw.toString(),
      },
    });
  };

  const handleSyncHeat = async () => {
    if (!page?.bungalow_id) return;
    const { address } = await requireWallet();
    const signature = await fetchAuthedJson<Record<string, string | number>>(
      `/api/onchain/bungalows/${page.bungalow_id}/sync-heat/sign`,
      getAccessToken,
      {
        method: "POST",
        body: JSON.stringify({ wallet: address }),
      },
    );

    await runDirectWrite({
      label: "Preparing heat sync...",
      action: "identity_sync_heat",
      functionName: "syncHeat",
      contractAddress: ONCHAIN_CONTRACTS.islandIdentity,
      abi: islandIdentityAbi,
      args: [
        BigInt(String(signature.profile_id ?? "0")),
        BigInt(String(signature.bungalow_id ?? "0")),
        BigInt(String(signature.heat_score ?? "0")),
        String(signature.salt ?? "") as `0x${string}`,
        BigInt(String(signature.deadline ?? "0")),
        String(signature.sig ?? "") as `0x${string}`,
      ],
      bungalowId: page.bungalow_id,
      metadata: {
        heat_score: signature.heat_score,
      },
    });
  };

  const handleUpdateIdentity = async () => {
    if (!page?.bungalow_id) return;
    await runDirectWrite({
      label: "Updating bungalow identity...",
      action: "bungalow_set_identity",
      functionName: "setBungalowIdentity",
      contractAddress: ONCHAIN_CONTRACTS.jungleBayIsland,
      abi: jungleBayIslandAbi,
      args: [BigInt(page.bungalow_id), name.trim(), ticker.trim()],
      bungalowId: page.bungalow_id,
    });
  };

  const handleUpdateMetadata = async () => {
    if (!page?.bungalow_id) return;
    await runDirectWrite({
      label: "Updating bungalow metadata...",
      action: "bungalow_update",
      functionName: "updateBungalow",
      contractAddress: ONCHAIN_CONTRACTS.jungleBayIsland,
      abi: jungleBayIslandAbi,
      args: [BigInt(page.bungalow_id), ipfsHash.trim()],
      bungalowId: page.bungalow_id,
    });
  };

  const handleLinkAsset = async () => {
    if (!page?.bungalow_id) return;
    await runDirectWrite({
      label: "Linking asset...",
      action: "bungalow_link_asset",
      functionName: "linkAsset",
      contractAddress: ONCHAIN_CONTRACTS.jungleBayIsland,
      abi: jungleBayIslandAbi,
      args: [BigInt(page.bungalow_id), linkChain.trim().toLowerCase(), linkTokenAddress.trim()],
      bungalowId: page.bungalow_id,
      metadata: {
        linked_chain: linkChain,
        linked_token_address: linkTokenAddress,
      },
    });
  };

  const firstPaidItem = useMemo(
    () => page?.installs.find((item) => BigInt(item.price_usdc) > 0n) ?? null,
    [page?.installs],
  );

  if (!looksLikeAssetRef(assetRef)) {
    return <section className={styles.page}>Missing bungalow asset reference.</section>;
  }

  return (
    <section className={styles.page}>
      <div className={styles.hero}>
        <div>
          <p className={styles.kicker}>Bungalow registry</p>
          <h1>{page?.exists ? page.name || page.ticker || assetRef : "This asset does not have a bungalow yet."}</h1>
          <p className={styles.summary}>
            Every asset key maps to at most one bungalow. Seed assets and linked
            assets resolve to the same page, and the durable truth lives in the
            registry NFT onchain.
          </p>
        </div>

        <div className={styles.lookupPill}>
          <span>{chain}</span>
          <strong>{assetRef}</strong>
        </div>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {status ? <p className={styles.status}>{status}</p> : null}
      {isLoading ? <p className={styles.loading}>Loading bungalow...</p> : null}

      {!page?.exists ? (
        <article className={styles.claimCard}>
          <strong>No bungalow claimed for this asset.</strong>
          <p>
            Claiming requires an existing profile and a backend-signed USDC mint quote.
            The spender for approval is {compactAddress(ONCHAIN_CONTRACTS.jungleBayIsland)}.
          </p>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleClaimBungalow()}
            disabled={txBusy || !canClaim}
          >
            Claim bungalow
          </button>
          {!me?.profile ? (
            <p className={styles.inlineHint}>
              Create your profile first on the <Link to="/profile">profile page</Link>.
            </p>
          ) : null}
        </article>
      ) : (
        <>
          <div className={styles.grid}>
            <article className={styles.card}>
              <span className={styles.cardLabel}>Registry</span>
              <strong>Bungalow #{page.bungalow_id}</strong>
              <p>Owner {page.owner_wallet ? compactAddress(page.owner_wallet) : "unknown"}.</p>
              <p>Minted {formatUnixDate(page.minted_at_unix)}.</p>
              <p>Seed asset {page.seed_asset ? `${page.seed_asset.chain}:${page.seed_asset.token_address}` : "—"}.</p>
            </article>

            <article className={styles.card}>
              <span className={styles.cardLabel}>Heat</span>
              <strong>{Math.round(page.viewer.onchain_heat)} onchain heat</strong>
              <p>Backend sees {Math.round(page.viewer.backend_heat)} heat for this bungalow.</p>
              <p>{page.viewer.bond_activated ? "Permanent bond already active." : "First install here will activate the permanent bond."}</p>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleSyncHeat()}
                disabled={txBusy || !page.viewer.profile_id || !page.viewer.can_sync_heat}
              >
                Sync heat
              </button>
            </article>

            <article className={styles.card}>
              <span className={styles.cardLabel}>Assets</span>
              <strong>{page.assets.length} linked asset(s)</strong>
              <ul className={styles.assetList}>
                {page.assets.map((asset) => (
                  <li key={`${asset.chain}:${asset.token_address}`}>
                    <span>{asset.is_seed ? "Seed" : "Linked"}</span>
                    <strong>{asset.symbol ?? asset.label ?? asset.token_address}</strong>
                    <small>{asset.chain}</small>
                  </li>
                ))}
              </ul>
            </article>
          </div>

          {page.viewer.owns_bungalow ? (
            <div className={styles.ownerPanel}>
              <div className={styles.ownerCard}>
                <span className={styles.cardLabel}>Update bungalow</span>
                <label>
                  Name
                  <input value={name} onChange={(event) => setName(event.target.value)} />
                </label>
                <label>
                  Ticker
                  <input value={ticker} onChange={(event) => setTicker(event.target.value)} />
                </label>
                <button type="button" className={styles.primaryButton} onClick={() => void handleUpdateIdentity()} disabled={txBusy}>
                  Update identity
                </button>
              </div>

              <div className={styles.ownerCard}>
                <span className={styles.cardLabel}>IPFS metadata</span>
                <label>
                  IPFS hash / URI
                  <input value={ipfsHash} onChange={(event) => setIpfsHash(event.target.value)} />
                </label>
                <button type="button" className={styles.secondaryButton} onClick={() => void handleUpdateMetadata()} disabled={txBusy}>
                  Update bungalow
                </button>
              </div>

              <div className={styles.ownerCard}>
                <span className={styles.cardLabel}>Link another asset</span>
                <label>
                  Chain
                  <select value={linkChain} onChange={(event) => setLinkChain(event.target.value)}>
                    <option value="base">base</option>
                    <option value="ethereum">ethereum</option>
                    <option value="solana">solana</option>
                  </select>
                </label>
                <label>
                  Asset id
                  <input value={linkTokenAddress} onChange={(event) => setLinkTokenAddress(event.target.value)} />
                </label>
                <button type="button" className={styles.secondaryButton} onClick={() => void handleLinkAsset()} disabled={txBusy || !linkTokenAddress.trim()}>
                  Link asset
                </button>
              </div>
            </div>
          ) : null}

          <div className={styles.twoColumn}>
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <strong>Installed items</strong>
                <Link to="/bodega">Open Bodega</Link>
              </div>
              {page.installs.length === 0 ? (
                <p className={styles.inlineCopy}>Nothing installed yet. The first install activates the permanent bond.</p>
              ) : (
                <ul className={styles.installList}>
                  {page.installs.map((item) => (
                    <li key={`${item.item_id}-${item.installed_at_unix}`}>
                      <strong>{item.ipfs_uri}</strong>
                      <span>{item.creator_handle ? `@${item.creator_handle}` : `Profile ${item.creator_profile_id}`}</span>
                      <small>
                        {BigInt(item.price_usdc) > 0n
                          ? `${formatUsdcAmount(item.price_usdc)} USDC`
                          : "Free"}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
              {firstPaidItem ? (
                <p className={styles.inlineHint}>
                  Paid installs approve USDC to {compactAddress(ONCHAIN_CONTRACTS.bodega)} only when needed.
                </p>
              ) : null}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <strong>Commissions</strong>
                <Link to="/commissions">Open commission board</Link>
              </div>
              {page.commissions.length === 0 ? (
                <p className={styles.inlineCopy}>No commissions published for this bungalow yet.</p>
              ) : (
                <ul className={styles.installList}>
                  {page.commissions.map((commission) => (
                    <li key={commission.commission_id}>
                      <strong>Commission #{commission.commission_id}</strong>
                      <span>{commission.status}</span>
                      <small>{formatUsdcAmount(commission.budget_usdc)} USDC budget</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
