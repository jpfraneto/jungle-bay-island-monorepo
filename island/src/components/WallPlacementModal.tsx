import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import WalletSelector, { type WalletSelectorState } from "./WalletSelector";
import { useJBMTransfer } from "../hooks/useJBMTransfer";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";

type WallPlacementType = "art" | "link";

interface WallPlacementModalProps {
  open: boolean;
  chain: string;
  ca: string;
  bungalowName: string;
  onClose: () => void;
  onPlaced: () => void;
}

interface PendingPayment {
  txHash: string;
  payer: string;
  itemType: WallPlacementType;
  amount: number;
}

const WALL_PLACEMENT_PRICES: Record<WallPlacementType, number> = {
  art: 69_000,
  link: 111_000,
};

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

async function readResponseMessage(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`.trim();

  try {
    const payload = (await response.clone().json()) as {
      error?: string;
      message?: string;
    };
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {
    try {
      const text = await response.text();
      if (text.trim()) {
        return text.trim();
      }
    } catch {
      return fallback || "Request failed";
    }
  }

  return fallback || "Request failed";
}

export default function WallPlacementModal({
  open,
  chain,
  ca,
  bungalowName,
  onClose,
  onPlaced,
}: WallPlacementModalProps) {
  const { authenticated, getAccessToken, login } = usePrivy();
  const { walletAddress } = usePrivyBaseWallet();
  const { transfer, isTransferring } = useJBMTransfer();

  const [itemType, setItemType] = useState<WallPlacementType>("art");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [selectedPayWallet, setSelectedPayWallet] = useState("");
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(
    null,
  );
  const [walletSelectorState, setWalletSelectorState] =
    useState<WalletSelectorState>({
      selectedWallet: null,
      selectedWalletAvailable: false,
      hasAvailableWallet: false,
      availableWallets: [],
      totalWallets: 0,
    });
  const [preview, setPreview] = useState<{
    title?: string;
    image?: string;
    description?: string;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItemType("art");
    setTitle("");
    setUrl("");
    setSelectedPayWallet(walletAddress ?? "");
    setPendingPayment(null);
    setPreview(null);
    setStatus(null);
    setError(null);
    setIsSubmitting(false);
  }, [open]);

  useEffect(() => {
    if (!walletAddress) return;
    if (selectedPayWallet) return;
    setSelectedPayWallet(walletAddress);
  }, [selectedPayWallet, walletAddress]);

  useEffect(() => {
    if (!open || itemType !== "link" || !isHttpUrl(url.trim())) {
      setPreview(null);
      return;
    }

    let cancelled = false;

    async function loadPreview() {
      try {
        const response = await fetch(`/api/og?url=${encodeURIComponent(url)}`);
        const data = (await response.json()) as {
          title?: string;
          image?: string;
          description?: string;
        };

        if (!cancelled) {
          setPreview(data);
        }
      } catch {
        if (!cancelled) {
          setPreview(null);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [itemType, open, url]);

  const price = WALL_PLACEMENT_PRICES[itemType];
  const canSubmit = !isSubmitting && !isTransferring;

  const handleSubmit = async () => {
    if (!authenticated) {
      login();
      return;
    }

    const normalizedUrl = url.trim();
    if (!normalizedUrl || !isHttpUrl(normalizedUrl)) {
      setError(
        itemType === "art"
          ? "Enter a valid art image URL."
          : "Enter a valid link URL.",
      );
      return;
    }

    const canReusePendingPayment = Boolean(
      pendingPayment &&
        pendingPayment.itemType === itemType &&
        pendingPayment.amount === price &&
        isHexTxHash(pendingPayment.txHash),
    );
    const payoutWallet = selectedPayWallet || walletAddress;
    if (
      !canReusePendingPayment &&
      (!payoutWallet || !walletSelectorState.selectedWalletAvailable)
    ) {
      setError("Choose a wallet that is available here or link a new one.");
      return;
    }

    setError(null);
    setStatus(null);
    setIsSubmitting(true);

    let confirmedPayment: PendingPayment | null = null;

    try {
      let txHash = "";
      let payer = "";

      if (canReusePendingPayment && pendingPayment) {
        txHash = pendingPayment.txHash;
        payer = pendingPayment.payer;
        confirmedPayment = pendingPayment;
      } else {
        setStatus(`Waiting for ${price.toLocaleString()} JBM transfer...`);
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

      const token = await getAccessToken();
      if (!token) {
        throw new Error("Authentication token unavailable");
      }

      setStatus(
        itemType === "art"
          ? "Placing art on the wall..."
          : "Placing link on the wall...",
      );
      const response = await fetch(`/api/bungalow/${chain}/${ca}/wall-item`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          item_type: itemType,
          title,
          url: normalizedUrl,
          placed_by: payer,
          tx_hash: txHash,
          jbm_amount: String(price),
        }),
      });

      if (!response.ok) {
        throw new Error(await readResponseMessage(response));
      }

      setPendingPayment(null);
      setStatus(null);
      onPlaced();
      onClose();
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Failed to place this item on the wall";
      if (confirmedPayment) {
        setError(
          `${message}. Payment is already confirmed, so you can retry saving without paying again.`,
        );
      } else {
        setError(message);
      }
      setStatus(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 13,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(5, 6, 4, 0.72)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          maxHeight: "100%",
          overflowY: "auto",
          display: "grid",
          gap: 16,
          padding: 18,
          borderRadius: 24,
          border: "1px solid rgba(233, 206, 141, 0.18)",
          background:
            "linear-gradient(180deg, rgba(32, 21, 12, 0.98), rgba(16, 12, 8, 0.98))",
          boxShadow: "0 28px 80px rgba(0,0,0,0.42)",
          color: "#f6ead1",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <span
              style={{
                fontSize: 11,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "rgba(246,234,209,0.58)",
              }}
            >
              Add To Wall
            </span>
            <h3 style={{ margin: 0, fontSize: 28 }}>{bungalowName}</h3>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                lineHeight: 1.5,
                color: "rgba(246,234,209,0.72)",
              }}
            >
              Add one local piece of art or one local link. These placements stay
              in this bungalow instead of becoming Bodega listings.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              minWidth: 40,
              height: 40,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "#f6ead1",
              cursor: "pointer",
              font: "inherit",
              fontSize: 20,
            }}
            aria-label="Close wall placement"
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(["art", "link"] as const).map((option) => {
            const optionPrice = WALL_PLACEMENT_PRICES[option].toLocaleString();
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setItemType(option);
                  setError(null);
                  setStatus(null);
                }}
                style={{
                  flex: 1,
                  minWidth: 180,
                  display: "grid",
                  gap: 4,
                  textAlign: "left",
                  padding: "14px 16px",
                  borderRadius: 18,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background:
                    itemType === option
                      ? "rgba(216, 179, 106, 0.16)"
                      : "rgba(255,255,255,0.04)",
                  color: "#f6ead1",
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                <strong style={{ fontSize: 16 }}>
                  {option === "art" ? "Art" : "Link"}
                </strong>
                <span style={{ fontSize: 12, color: "rgba(246,234,209,0.72)" }}>
                  {option === "art"
                    ? `Install an image on the wall for ${optionPrice} JBM`
                    : `Install a link on the wall for ${optionPrice} JBM`}
                </span>
              </button>
            );
          })}
        </div>

        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
          Title (optional)
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={
              itemType === "art" ? "Name this piece" : "Name this link"
            }
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#f6ead1",
              borderRadius: 12,
              padding: "10px 12px",
              width: "100%",
              font: "inherit",
              boxSizing: "border-box",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
          {itemType === "art" ? "Art image URL" : "Link URL"}
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://..."
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#f6ead1",
              borderRadius: 12,
              padding: "10px 12px",
              width: "100%",
              font: "inherit",
              boxSizing: "border-box",
            }}
          />
        </label>

        {itemType === "art" && isHttpUrl(url.trim()) ? (
          <div
            style={{
              borderRadius: 16,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <img
              src={url.trim()}
              alt={title || "Art preview"}
              style={{
                width: "100%",
                maxHeight: 280,
                objectFit: "cover",
                display: "block",
              }}
            />
          </div>
        ) : null}

        {itemType === "link" && isHttpUrl(url.trim()) ? (
          <div
            style={{
              display: "grid",
              gap: 10,
              padding: 12,
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            {preview?.image ? (
              <img
                src={preview.image}
                alt={preview.title || title || "Link preview"}
                style={{
                  width: "100%",
                  maxHeight: 180,
                  objectFit: "cover",
                  display: "block",
                  borderRadius: 12,
                }}
              />
            ) : null}
            <div style={{ display: "grid", gap: 4 }}>
              <strong>{preview?.title || title || "Link preview"}</strong>
              {preview?.description ? (
                <span
                  style={{
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: "rgba(246,234,209,0.72)",
                  }}
                >
                  {preview.description}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <WalletSelector
          label="Sign with"
          value={selectedPayWallet}
          onSelect={(address) => {
            setSelectedPayWallet(address);
            setError(null);
          }}
          onStateChange={setWalletSelectorState}
        />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            <strong>Pay {price.toLocaleString()} JBM</strong>
            <span
              style={{ fontSize: 12, color: "rgba(246,234,209,0.68)" }}
            >
              This stays local to the wall in {bungalowName}.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!canSubmit}
            style={{
              minHeight: 44,
              padding: "0 18px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(216, 179, 106, 0.92)",
              color: "#201508",
              cursor: canSubmit ? "pointer" : "progress",
              font: "inherit",
              fontWeight: 700,
              opacity: canSubmit ? 1 : 0.7,
            }}
          >
            {isSubmitting || isTransferring
              ? "Processing..."
              : pendingPayment &&
                  pendingPayment.itemType === itemType &&
                  pendingPayment.amount === price
                ? "Retry Save"
                : itemType === "art"
                  ? "Add art to wall"
                  : "Add link to wall"}
          </button>
        </div>

        {status ? (
          <div
            style={{
              borderRadius: 12,
              border: "1px solid rgba(216, 179, 106, 0.16)",
              background: "rgba(216, 179, 106, 0.1)",
              padding: "10px 12px",
              fontSize: 12,
            }}
          >
            {status}
          </div>
        ) : null}
        {error ? (
          <div
            style={{
              borderRadius: 12,
              border: "1px solid rgba(255,120,120,0.24)",
              background: "rgba(120,20,20,0.24)",
              padding: "10px 12px",
              color: "#ffd7d7",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
