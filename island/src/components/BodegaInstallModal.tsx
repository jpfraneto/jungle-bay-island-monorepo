import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useNavigate } from "react-router-dom";
import BungalowOptionPicker from "./BungalowOptionPicker";
import WalletSelector from "./WalletSelector";
import { useJBMTransfer } from "../hooks/useJBMTransfer";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { useSiweWalletLink } from "../hooks/useSiweWalletLink";
import { useUserWalletLinks } from "../hooks/useUserWalletLinks";
import { formatJbmAmount } from "../utils/formatters";
import {
  formatCreatorLabel,
  getBodegaPreviewUrl,
  type BodegaCatalogItem,
  type BodegaInstallRecord,
  type DirectoryBungalow,
} from "../utils/bodega";
import styles from "../styles/bodega-install-modal.module.css";

interface BodegaInstallModalProps {
  open: boolean;
  item: BodegaCatalogItem | null;
  bungalowOptions: DirectoryBungalow[];
  isDirectoryLoading?: boolean;
  isWalletScoped?: boolean;
  selectionNote?: string | null;
  preselectedBungalow?: DirectoryBungalow | null;
  onClose: () => void;
  onInstalled?: (
    install: BodegaInstallRecord,
    bungalow: DirectoryBungalow,
  ) => void;
}

interface PendingPayment {
  catalogItemId: number;
  targetKey: string;
  txHash: string;
  payer: string;
  amount: string;
}

const PENDING_INSTALL_PAYMENT_STORAGE_KEY = "jbi:bodega:pending-install-payment";

function getBungalowKey(bungalow: DirectoryBungalow): string {
  return `${bungalow.chain}:${bungalow.token_address}`;
}

function isHexTxHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Restores a pending install payment so the user can retry after refresh.
 */
function readPendingInstallPayment(): PendingPayment | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(PENDING_INSTALL_PAYMENT_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PendingPayment> | null;
    if (
      !parsed ||
      typeof parsed.catalogItemId !== "number" ||
      !Number.isFinite(parsed.catalogItemId) ||
      parsed.catalogItemId <= 0 ||
      typeof parsed.targetKey !== "string" ||
      typeof parsed.txHash !== "string" ||
      typeof parsed.payer !== "string" ||
      typeof parsed.amount !== "string" ||
      !isHexTxHash(parsed.txHash)
    ) {
      window.localStorage.removeItem(PENDING_INSTALL_PAYMENT_STORAGE_KEY);
      return null;
    }

    return {
      catalogItemId: parsed.catalogItemId,
      targetKey: parsed.targetKey,
      txHash: parsed.txHash,
      payer: parsed.payer,
      amount: parsed.amount,
    };
  } catch {
    window.localStorage.removeItem(PENDING_INSTALL_PAYMENT_STORAGE_KEY);
    return null;
  }
}

/**
 * Persists or clears the pending install payment between page loads.
 */
function writePendingInstallPayment(payment: PendingPayment | null): void {
  if (typeof window === "undefined") return;

  if (!payment) {
    window.localStorage.removeItem(PENDING_INSTALL_PAYMENT_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    PENDING_INSTALL_PAYMENT_STORAGE_KEY,
    JSON.stringify(payment),
  );
}

function normalizeInstallRecord(input: unknown): BodegaInstallRecord | null {
  const item = input as Record<string, unknown> | null;
  if (!item || typeof item !== "object") {
    return null;
  }

  const id = Number(item.id ?? 0);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  return {
    id,
    catalog_item_id: Number(item.catalog_item_id ?? 0),
    installed_to_token_address:
      typeof item.installed_to_token_address === "string"
        ? item.installed_to_token_address
        : "",
    installed_to_chain:
      typeof item.installed_to_chain === "string" ? item.installed_to_chain : "",
    installed_by_wallet:
      typeof item.installed_by_wallet === "string"
        ? item.installed_by_wallet
        : "",
    tx_hash: typeof item.tx_hash === "string" ? item.tx_hash : "",
    jbm_amount: typeof item.jbm_amount === "string" ? item.jbm_amount : "0",
    creator_credit_jbm:
      typeof item.creator_credit_jbm === "string" ? item.creator_credit_jbm : "0",
    credit_claimed: Boolean(item.credit_claimed),
    created_at: typeof item.created_at === "string" ? item.created_at : "",
    catalog_item: null,
  };
}

export default function BodegaInstallModal({
  open,
  item,
  bungalowOptions,
  isDirectoryLoading = false,
  isWalletScoped = false,
  selectionNote = null,
  preselectedBungalow = null,
  onClose,
  onInstalled,
}: BodegaInstallModalProps) {
  const navigate = useNavigate();
  const { authenticated, getAccessToken, login } = usePrivy();
  const { walletAddress } = usePrivyBaseWallet();
  const {
    wallets: linkedWalletRows,
    refetch: refetchLinkedWallets,
  } = useUserWalletLinks(authenticated);
  const {
    linkCurrentWallet,
    isLinking: isLinkingWallet,
    status: linkStatus,
    error: linkError,
  } = useSiweWalletLink();
  const { transfer, isTransferring } = useJBMTransfer();

  const [selectedKey, setSelectedKey] = useState(() => {
    const pending = readPendingInstallPayment();
    return pending?.targetKey ?? "";
  });
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(
    () => readPendingInstallPayment(),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPayWallet, setSelectedPayWallet] = useState<string>("");
  const [showWalletGate, setShowWalletGate] = useState(false);
  const [resumeAfterLink, setResumeAfterLink] = useState(false);
  const [successBungalow, setSuccessBungalow] = useState<DirectoryBungalow | null>(
    null,
  );

  useEffect(() => {
    if (!open || !item) return;

    const storedTargetKey = pendingPayment?.targetKey ?? "";
    const matchingStoredBungalow =
      bungalowOptions.find((bungalow) => getBungalowKey(bungalow) === storedTargetKey) ??
      (!isWalletScoped &&
      preselectedBungalow &&
      getBungalowKey(preselectedBungalow) === storedTargetKey
        ? preselectedBungalow
        : null);
    const preferredBungalow =
      matchingStoredBungalow ??
      (bungalowOptions[0]
        ? bungalowOptions[0]
        : !isWalletScoped && preselectedBungalow
          ? preselectedBungalow
          : null);
    const fallbackKey = preferredBungalow ? getBungalowKey(preferredBungalow) : "";

    setSelectedKey(fallbackKey);
    setIsSubmitting(false);
    setStatus(null);
    setError(null);
    setShowWalletGate(false);
    setResumeAfterLink(false);
    setSuccessBungalow(null);
  }, [bungalowOptions, isWalletScoped, item, open, pendingPayment, preselectedBungalow]);

  useEffect(() => {
    writePendingInstallPayment(pendingPayment);
  }, [pendingPayment]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const previousRootOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    return () => {
      document.documentElement.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!walletAddress) return;
    if (selectedPayWallet) return;
    setSelectedPayWallet(walletAddress);
  }, [selectedPayWallet, walletAddress]);

  if (!open || !item) return null;

  const selectedBungalow = bungalowOptions.find(
    (bungalow) => getBungalowKey(bungalow) === selectedKey,
  ) ??
    (!isWalletScoped ? preselectedBungalow ?? null : null);
  const previewUrl = getBodegaPreviewUrl(item);
  const creatorLabel = formatCreatorLabel(item);
  const canSubmit = Boolean(selectedBungalow) && !isSubmitting && !isTransferring;

  const handleInstall = async () => {
    if (!authenticated) {
      login();
      return;
    }

    const linkedWallets = linkedWalletRows.map((wallet) =>
      wallet.address.toLowerCase(),
    );
    const payoutWallet = selectedPayWallet || walletAddress;
    if (!payoutWallet || linkedWalletRows.length === 0) {
      setShowWalletGate(true);
      setResumeAfterLink(true);
      return;
    }
    if (!linkedWallets.includes(payoutWallet.toLowerCase())) {
      setError("Link this wallet first to use it for transactions.");
      setShowWalletGate(true);
      return;
    }

    if (!selectedBungalow) {
      setError("Select a bungalow before installing.");
      return;
    }

    setIsSubmitting(true);
    setStatus(null);
    setError(null);

    let confirmedPayment: PendingPayment | null = null;

    try {
      const targetKey = getBungalowKey(selectedBungalow);
      const reusablePayment =
        pendingPayment &&
        pendingPayment.catalogItemId === item.id &&
        pendingPayment.targetKey === targetKey &&
        pendingPayment.amount === item.price_in_jbm &&
        isHexTxHash(pendingPayment.txHash);

      let txHash = "";
      let payer = "";

      if (reusablePayment) {
        txHash = pendingPayment.txHash;
        payer = pendingPayment.payer;
        confirmedPayment = pendingPayment;
      } else {
        setStatus("Waiting for JBM transfer confirmation...");
        const transferResult = await transfer(Number(item.price_in_jbm));
        txHash = transferResult.hash;
        payer = transferResult.from;

        confirmedPayment = {
          catalogItemId: item.id,
          targetKey,
          txHash,
          payer,
          amount: item.price_in_jbm,
        };
        setPendingPayment(confirmedPayment);
      }

      setStatus("Saving install to the island...");

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch("/api/bodega/install", {
        method: "POST",
        headers,
        body: JSON.stringify({
          catalog_item_id: item.id,
          installed_by_wallet: payer,
          installed_to_token_address: selectedBungalow.token_address,
          installed_to_chain: selectedBungalow.chain,
          tx_hash: txHash,
          jbm_amount: item.price_in_jbm,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | {
            install?: unknown;
            error?: unknown;
          }
        | null;
      const install = normalizeInstallRecord(data?.install);
      const apiError =
        typeof data?.error === "string" && data.error.trim().length > 0
          ? data.error
          : null;

      if (!response.ok || !install) {
        throw new Error(apiError ?? `Request failed (${response.status})`);
      }

      setPendingPayment(null);
      setStatus("Installed! Check your bungalow.");
      setSuccessBungalow(selectedBungalow);
      onInstalled?.(install, selectedBungalow);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to install Bodega item";

      if (confirmedPayment) {
        setError(
          `${message}. The payment is already confirmed, so you can retry without paying again.`,
        );
      } else {
        setError(message);
      }
      setStatus(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddWallet = async () => {
    try {
      await linkCurrentWallet();
      await refetchLinkedWallets();
      setShowWalletGate(false);
      if (resumeAfterLink) {
        setResumeAfterLink(false);
        await handleInstall();
      }
    } catch {
      // Hook already provides user-facing error feedback.
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <header className={styles.header}>
          <div>
            <h3>Install from the Bodega</h3>
            <p>Bring this creator-made asset into one of your venues.</p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <section className={styles.assetCard}>
          {previewUrl ? (
            <img src={previewUrl} alt={item.title} className={styles.preview} />
          ) : (
            <div className={styles.previewFallback}>🛖</div>
          )}
          <div className={styles.assetMeta}>
            <strong>{item.title}</strong>
            <span>by {creatorLabel}</span>
            <span className={styles.price}>
              Install cost: {formatJbmAmount(item.price_in_jbm)}
            </span>
          </div>
        </section>

        <WalletSelector label="Pay with" onSelect={setSelectedPayWallet} />
        {showWalletGate || linkedWalletRows.length === 0 ? (
          <section className={styles.emptyState}>
            <strong>You need a linked wallet to continue.</strong>
            <button
              type="button"
              className={styles.submitButton}
              onClick={() => {
                void handleAddWallet();
              }}
              disabled={isLinkingWallet}
            >
              {isLinkingWallet ? "Linking..." : "Add wallet"}
            </button>
            {linkStatus ? <span>{linkStatus}</span> : null}
            {linkError ? <span className={styles.error}>{linkError}</span> : null}
          </section>
        ) : null}

        {successBungalow ? (
          <section className={styles.successCard}>
            <strong>Installed! Check your bungalow.</strong>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                navigate(`/bungalow/${successBungalow.token_address}`);
                onClose();
              }}
            >
              Open {successBungalow.symbol ?? successBungalow.name ?? "bungalow"}
            </button>
          </section>
        ) : isDirectoryLoading && bungalowOptions.length === 0 ? (
          <section className={styles.emptyState}>
            {isWalletScoped
              ? "Loading your bungalows..."
              : "Loading the island directory..."}
          </section>
        ) : isWalletScoped && bungalowOptions.length === 0 ? (
          <section className={styles.emptyState}>
            <strong>You don't own any bungalows yet.</strong>
            <span>Claim one on the island map, then come back to install this asset.</span>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                navigate("/");
                onClose();
              }}
            >
              Find one to claim
            </button>
          </section>
        ) : bungalowOptions.length === 0 ? (
          <section className={styles.emptyState}>
            {selectionNote ??
              "You need a bungalow before you can install Bodega items."}
          </section>
        ) : (
          <section className={styles.formBlock}>
            <label className={styles.fieldLabel}>
              Install into
            </label>
            <BungalowOptionPicker
              options={bungalowOptions}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
            />
            <p className={styles.note}>
              {selectionNote ??
                "This charges the install cost once for the bungalow you choose."}
            </p>
          </section>
        )}

        <footer className={styles.footer}>
          {status ? <div className={styles.status}>{status}</div> : null}
          {error ? <div className={styles.error}>{error}</div> : null}
          <button
            type="button"
            className={styles.submitButton}
            disabled={!canSubmit || Boolean(successBungalow)}
            onClick={handleInstall}
          >
            {isSubmitting || isTransferring
              ? "Processing..."
              : pendingPayment &&
                  pendingPayment.catalogItemId === item.id &&
                  selectedBungalow &&
                  pendingPayment.targetKey === getBungalowKey(selectedBungalow)
                ? "Retry Save"
                : "Confirm & Pay"}
          </button>
        </footer>
      </div>
    </div>
  );
}
