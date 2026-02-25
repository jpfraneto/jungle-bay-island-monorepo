import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { BungalowItem } from "../hooks/useBungalowItems";
import { useJBMTransfer } from "../hooks/useJBMTransfer";
import {
  ITEM_LABELS,
  ITEM_PRICES,
  type WallItemType,
} from "../utils/constants";
import styles from "../styles/add-item-modal.module.css";

interface AddItemModalProps {
  chain: string;
  ca: string;
  open: boolean;
  onClose: () => void;
  onCreated: (item: BungalowItem) => void;
}

interface BungalowDirectoryItem {
  chain: string;
  token_address: string;
  symbol: string | null;
  name: string | null;
}

function isHexTxHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export default function AddItemModal({ chain, ca, open, onClose, onCreated }: AddItemModalProps) {
  const { authenticated, login, user } = usePrivy();
  const { transfer, isTransferring } = useJBMTransfer();

  const [itemType, setItemType] = useState<WallItemType>("link");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [frameText, setFrameText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [portalTarget, setPortalTarget] = useState("");
  const [portalOptions, setPortalOptions] = useState<BungalowDirectoryItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/bungalows?limit=200", { signal: controller.signal });
        if (!response.ok) return;

        const data = (await response.json()) as {
          items?: Array<{
            chain: string;
            token_address: string;
            symbol: string | null;
            name: string | null;
          }>;
        };

        setPortalOptions(Array.isArray(data.items) ? data.items : []);
      } catch {
        setPortalOptions([]);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [open]);

  const price = ITEM_PRICES[itemType];
  const walletAddress = user?.wallet?.address ?? "";

  const canSubmit = useMemo(
    () => !isSubmitting && !isTransferring,
    [isSubmitting, isTransferring],
  );

  const buildContent = (): Record<string, unknown> => {
    if (itemType === "link") {
      if (!url) throw new Error("Link URL is required");
      return { url, title };
    }

    if (itemType === "frame") {
      if (!frameText.trim()) throw new Error("Frame text is required");
      return { text: frameText.trim().slice(0, 280) };
    }

    if (itemType === "image") {
      if (!imageUrl.trim()) throw new Error("Image URL is required");
      return { image_url: imageUrl.trim(), caption: caption.trim() || null };
    }

    if (!portalTarget) throw new Error("Select a portal target");
    const [targetChain, targetCa] = portalTarget.split(":");
    const target = portalOptions.find(
      (option) => option.chain === targetChain && option.token_address === targetCa,
    );

    return {
      target_chain: targetChain,
      target_ca: targetCa,
      target_name: target?.name ?? target?.symbol ?? "Portal destination",
    };
  };

  const handleSubmit = async () => {
    if (!authenticated || !walletAddress) {
      login();
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const content = buildContent();
      const transferResult = await transfer(price);
      const txHash = transferResult.hash;

      if (!isHexTxHash(txHash)) {
        throw new Error("Unexpected transfer hash");
      }

      const response = await fetch(`/api/bungalow/${chain}/${ca}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_type: itemType,
          content,
          placed_by: walletAddress,
          tx_hash: txHash,
          jbm_amount: String(price),
        }),
      });

      const data = (await response.json()) as { item?: BungalowItem; error?: string };
      if (!response.ok || !data.item) {
        throw new Error(data.error ?? `Request failed (${response.status})`);
      }

      onCreated(data.item);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add item");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <header className={styles.header}>
          <h3>Add to Bungalow</h3>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </header>

        <div className={styles.typeGrid}>
          {(Object.keys(ITEM_PRICES) as WallItemType[]).map((type) => (
            <button
              key={type}
              type="button"
              className={`${styles.typeCard} ${itemType === type ? styles.typeCardActive : ""}`}
              onClick={() => setItemType(type)}
            >
              <span>{ITEM_LABELS[type]}</span>
              <small>{ITEM_PRICES[type].toLocaleString()} JBM</small>
            </button>
          ))}
        </div>

        {itemType === "link" ? (
          <div className={styles.formBlock}>
            <input
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <input
              type="text"
              placeholder="Link title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
        ) : null}

        {itemType === "frame" ? (
          <div className={styles.formBlock}>
            <textarea
              maxLength={280}
              placeholder="Share a message with the community"
              value={frameText}
              onChange={(event) => setFrameText(event.target.value)}
            />
          </div>
        ) : null}

        {itemType === "image" ? (
          <div className={styles.formBlock}>
            <input
              type="url"
              placeholder="Image URL"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
            />
            <input
              type="text"
              placeholder="Caption (optional)"
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
            />
          </div>
        ) : null}

        {itemType === "portal" ? (
          <div className={styles.formBlock}>
            <select
              value={portalTarget}
              onChange={(event) => setPortalTarget(event.target.value)}
            >
              <option value="">Select a target bungalow</option>
              {portalOptions
                .filter((option) => option.token_address !== ca)
                .map((option) => (
                  <option
                    key={`${option.chain}:${option.token_address}`}
                    value={`${option.chain}:${option.token_address}`}
                  >
                    {(option.symbol ?? option.name ?? "Unknown").toUpperCase()} ({option.chain})
                  </option>
                ))}
            </select>
          </div>
        ) : null}

        <footer className={styles.footer}>
          <div className={styles.summary}>Pay {price.toLocaleString()} JBM</div>
          {error ? <div className={styles.error}>{error}</div> : null}
          <button
            type="button"
            className={styles.submitButton}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {isSubmitting || isTransferring ? "Processing..." : "Confirm & Pay"}
          </button>
        </footer>
      </div>
    </div>
  );
}
