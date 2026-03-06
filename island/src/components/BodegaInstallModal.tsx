import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import BungalowOptionPicker from "./BungalowOptionPicker";
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

function getBungalowKey(bungalow: DirectoryBungalow): string {
  return `${bungalow.chain}:${bungalow.token_address}`;
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
  onInstalled: _onInstalled,
}: BodegaInstallModalProps) {
  const navigate = useNavigate();
  const [selectedKey, setSelectedKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !item) return;

    const preferredBungalow =
      (preselectedBungalow &&
      bungalowOptions.some(
        (bungalow) =>
          getBungalowKey(bungalow) === getBungalowKey(preselectedBungalow),
      )
        ? preselectedBungalow
        : null) ??
      bungalowOptions[0] ??
      (!isWalletScoped ? preselectedBungalow : null);

    setSelectedKey(preferredBungalow ? getBungalowKey(preferredBungalow) : "");
    setError(null);
  }, [bungalowOptions, isWalletScoped, item, open, preselectedBungalow]);

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

  if (!open || !item) return null;

  const selectedBungalow =
    bungalowOptions.find(
      (bungalow) => getBungalowKey(bungalow) === selectedKey,
    ) ?? (!isWalletScoped ? (preselectedBungalow ?? null) : null);
  const previewUrl = getBodegaPreviewUrl(item);
  const creatorLabel = formatCreatorLabel(item);

  const handleContinue = () => {
    if (!selectedBungalow) {
      setError("Choose a bungalow before continuing.");
      return;
    }

    const params = new URLSearchParams();
    params.set("chain", selectedBungalow.chain);

    navigate(`/bungalow/${selectedBungalow.token_address}?${params.toString()}`, {
      state: {
        pendingBodegaItem: item,
      },
    });
    onClose();
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <header className={styles.header}>
          <div>
            <h3>Install from the Bodega</h3>
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

        {isDirectoryLoading && bungalowOptions.length === 0 ? (
          <section className={styles.emptyState}>
            {isWalletScoped
              ? "Loading your bungalows..."
              : "Loading the island directory..."}
          </section>
        ) : isWalletScoped && bungalowOptions.length === 0 ? (
          <section className={styles.emptyState}>
            <strong>No bungalow is linked to this wallet yet.</strong>
            <span>
              Open a bungalow on the island first, then come back to place this
              listing.
            </span>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                navigate("/");
                onClose();
              }}
            >
              Open island
            </button>
          </section>
        ) : bungalowOptions.length === 0 ? (
          <section className={styles.emptyState}>
            {selectionNote ??
              "You need a bungalow before you can place Bodega items."}
          </section>
        ) : (
          <section className={styles.formBlock}>
            <label className={styles.fieldLabel}>Choose bungalow</label>
            <BungalowOptionPicker
              options={bungalowOptions}
              selectedKey={selectedKey}
              onSelect={(key) => {
                setSelectedKey(key);
                setError(null);
              }}
            />
            <p className={styles.note}>
              {selectionNote ??
                "Pick the bungalow first. You will choose the exact room spot there before paying."}
            </p>
          </section>
        )}

        <footer className={styles.footer}>
          {error ? <div className={styles.error}>{error}</div> : null}
          <button
            type="button"
            className={styles.submitButton}
            disabled={!selectedBungalow}
            onClick={handleContinue}
          >
            Choose placement in bungalow
          </button>
        </footer>
      </div>
    </div>
  );
}
