import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import WalletSelector from "./WalletSelector";
import { useJBMTransfer } from "../hooks/useJBMTransfer";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { useSiweWalletLink } from "../hooks/useSiweWalletLink";
import { useUserWalletLinks } from "../hooks/useUserWalletLinks";
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
  symbol: string;
  onClose: () => void;
  onCreated: () => void;
}

interface BungalowDirectoryItem {
  chain: string;
  token_address: string;
  symbol: string | null;
  name: string | null;
}

interface PendingPayment {
  txHash: string;
  payer: string;
  itemType: WallItemType;
  amount: number;
}

function isHexTxHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export default function AddItemModal({
  chain,
  ca,
  symbol,
  open,
  onClose,
  onCreated,
}: AddItemModalProps) {
  const { authenticated, getAccessToken, login } = usePrivy();
  const { walletAddress } = usePrivyBaseWallet();
  const { wallets: linkedWalletRows, refetch: refetchLinkedWallets } =
    useUserWalletLinks(authenticated);
  const {
    linkCurrentWallet,
    isLinking: isLinkingWallet,
    status: linkStatus,
    error: linkError,
  } = useSiweWalletLink();
  const { transfer, isTransferring } = useJBMTransfer();

  const [itemType, setItemType] = useState<WallItemType>("link");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [frameText, setFrameText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [portalTarget, setPortalTarget] = useState("");
  const [portalOptions, setPortalOptions] = useState<BungalowDirectoryItem[]>(
    [],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPayWallet, setSelectedPayWallet] = useState<string>("");
  const [showWalletGate, setShowWalletGate] = useState(false);
  const [resumeAfterLink, setResumeAfterLink] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    setItemType("link");
    setTitle("");
    setUrl("");
    setFrameText("");
    setImageUrl("");
    setCaption("");
    setPortalTarget("");
    setError(null);
    setShowWalletGate(false);
    setResumeAfterLink(false);
    setPendingPayment(null);
    setIsSubmitting(false);
  }, [open]);

  useEffect(() => {
    if (!walletAddress) return;
    if (selectedPayWallet) return;
    setSelectedPayWallet(walletAddress);
  }, [selectedPayWallet, walletAddress]);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/bungalows?limit=200", {
          signal: controller.signal,
        });
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
  const canSubmit = useMemo(
    () => !isSubmitting && !isTransferring,
    [isSubmitting, isTransferring],
  );

  const buildContent = (): Record<string, unknown> => {
    if (itemType === "link") {
      const normalizedUrl = url.trim();
      if (!normalizedUrl || !isHttpUrl(normalizedUrl)) {
        throw new Error("Enter a valid link URL (http/https)");
      }
      return { url: normalizedUrl, title: title.trim().slice(0, 100) };
    }

    if (itemType === "frame") {
      if (!frameText.trim()) throw new Error("Frame text is required");
      return { text: frameText.trim().slice(0, 280) };
    }

    if (itemType === "image") {
      const normalizedUrl = imageUrl.trim();
      if (!normalizedUrl || !isHttpUrl(normalizedUrl)) {
        throw new Error("Enter a valid image URL (http/https)");
      }
      return { image_url: imageUrl.trim(), caption: caption.trim() || null };
    }

    if (!portalTarget) throw new Error("Select a portal target");
    const [targetChain, targetCa] = portalTarget.split(":");
    const target = portalOptions.find(
      (option) =>
        option.chain === targetChain && option.token_address === targetCa,
    );

    return {
      target_chain: targetChain,
      target_ca: targetCa,
      target_name: target?.name ?? target?.symbol ?? "Portal destination",
    };
  };

  const handleSubmit = async () => {
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

    setError(null);
    setIsSubmitting(true);

    let confirmedPayment: PendingPayment | null = null;

    try {
      const content = buildContent();
      const canReusePendingPayment = Boolean(
        pendingPayment &&
        pendingPayment.itemType === itemType &&
        pendingPayment.amount === price &&
        isHexTxHash(pendingPayment.txHash),
      );

      let txHash = "";
      let payer = "";

      if (canReusePendingPayment && pendingPayment) {
        txHash = pendingPayment.txHash;
        payer = pendingPayment.payer;
        confirmedPayment = pendingPayment;
      } else {
        const transferResult = await transfer(price);
        txHash = transferResult.hash;
        payer = transferResult.from;

        if (!isHexTxHash(txHash)) {
          throw new Error("Unexpected transfer hash");
        }

        confirmedPayment = {
          txHash,
          payer,
          itemType,
          amount: price,
        };
        setPendingPayment(confirmedPayment);
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(`/api/bodega/quick-add`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          item_type: itemType,
          content,
          placed_by: payer,
          installed_to_chain: chain,
          installed_to_token_address: ca,
          tx_hash: txHash,
          jbm_amount: String(price),
        }),
      });

      const data = (await response.json()) as {
        install?: unknown;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? `Request failed (${response.status})`);
      }

      setPendingPayment(null);
      onCreated();
      onClose();
    } catch (err) {
      const baseMessage =
        err instanceof Error ? err.message : "Failed to add item";
      if (confirmedPayment) {
        setError(
          `${baseMessage}. Payment is already confirmed; click the button again to retry saving without paying again.`,
        );
      } else {
        setError(baseMessage);
      }
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
        await handleSubmit();
      }
    } catch {
      // Hook error state already shows a useful message.
    }
  };

  if (!open) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <header className={styles.header}>
          <div>
            <h3>Quick Add</h3>
            <p>
              Publish straight from inside this bungalow. The item goes live in
              the Bodega immediately and installs here in the same move.
            </p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
          >
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
              maxLength={100}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
        ) : null}

        {itemType === "frame" ? (
          <div className={styles.formBlock}>
            <textarea
              maxLength={280}
              placeholder={`Share a message with the ${symbol} community`}
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
                    {(option.symbol ?? option.name ?? "Unknown").toUpperCase()}{" "}
                    ({option.chain})
                  </option>
                ))}
            </select>
          </div>
        ) : null}

        <WalletSelector
          label="Sign with"
          value={selectedPayWallet}
          onSelect={setSelectedPayWallet}
        />
        {showWalletGate || linkedWalletRows.length === 0 ? (
          <div className={styles.error}>
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
            {linkStatus ? <div>{linkStatus}</div> : null}
            {linkError ? <div>{linkError}</div> : null}
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
            {isSubmitting || isTransferring
              ? "Processing..."
              : pendingPayment &&
                  pendingPayment.itemType === itemType &&
                  pendingPayment.amount === price
                ? "Retry Save"
                : "Publish & Install"}
          </button>
        </footer>
      </div>
    </div>
  );
}
