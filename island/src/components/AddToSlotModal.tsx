import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePrivy } from "@privy-io/react-auth";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import { useBungalowScene } from "../hooks/useBungalowScene";
import type { DecorationConfig } from "../types/scene";

type ModalType = "image" | "link" | "portal" | "decoration";

interface AddToSlotModalProps {
  slotId: string;
  chain: string;
  ca: string;
  bungalowName: string;
  onClose: () => void;
  onSuccess: () => void;
}

function useIsMobile(maxWidth: number) {
  const [matches, setMatches] = useState(() => window.innerWidth < maxWidth);

  useEffect(() => {
    const update = () => setMatches(window.innerWidth < maxWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [maxWidth]);

  return matches;
}

function inferSlotType(slotId: string) {
  if (slotId.includes("wall-frame")) return "Wall frame";
  if (slotId.includes("portal")) return "Portal";
  if (slotId.includes("shelf")) return "Shelf";
  if (slotId.includes("floor")) return "Floor";
  if (slotId.includes("link")) return "Link";
  return "Slot";
}

function inferLinkDecorationType(url: string): DecorationConfig["type"] {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (
      hostname.includes("x.com") ||
      hostname.includes("twitter.com") ||
      hostname.includes("discord.com") ||
      hostname.includes("telegram.me") ||
      hostname.includes("t.me") ||
      hostname.includes("farcaster")
    ) {
      return "social-link";
    }
  } catch {
    return "website-link";
  }

  return "website-link";
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export default function AddToSlotModal({
  slotId,
  chain,
  ca,
  bungalowName,
  onClose,
  onSuccess,
}: AddToSlotModalProps) {
  const isMobile = useIsMobile(768);
  const { authenticated, getAccessToken, login } = usePrivy();
  const { walletAddress } = usePrivyBaseWallet();
  const { updateSlot } = useBungalowScene(chain, ca);
  const [type, setType] = useState<ModalType>("image");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<{
    title?: string;
    image?: string;
    description?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (type !== "link" || !isHttpUrl(url)) {
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
  }, [type, url]);

  const inputStyle = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.15)",
    color: "white",
    borderRadius: 6,
    padding: "8px 12px",
    width: "100%",
    font: "inherit",
    boxSizing: "border-box" as const,
  };

  const fieldLabelStyle = {
    display: "grid",
    gap: 6,
    fontSize: 12,
    color: "rgba(255,255,255,0.76)",
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }

    if (!walletAddress) {
      setError("Connect your wallet first.");
      return;
    }

    if (!authenticated) {
      login();
      setError("Sign in with X before placing an item.");
      return;
    }

    if ((type === "image" || type === "link" || type === "portal") && !isHttpUrl(url)) {
      setError("A valid http or https URL is required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        throw new Error("Missing auth token");
      }

      const decorationType: DecorationConfig["type"] =
        type === "image"
          ? "image"
          : type === "link"
            ? inferLinkDecorationType(url)
            : type === "portal"
              ? "portal"
              : "decoration";

      await updateSlot(
        slotId,
        {
          type: decorationType,
          name: name.trim(),
          imageUrl: type === "image" ? url.trim() : undefined,
          linkUrl: type === "link" || type === "portal" ? url.trim() : undefined,
          placedBy: walletAddress,
          jbmBurned: 0,
        },
        token,
      );

      onSuccess();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to place item in bungalow.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "grid",
        placeItems: "center",
        padding: 20,
        zIndex: 2000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-to-slot-title"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: isMobile ? "90vw" : "min(420px, calc(100vw - 48px))",
          maxWidth: isMobile ? "none" : 420,
          background: "#1a2e1a",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12,
          padding: 24,
          color: "#f6f0df",
          display: "grid",
          gap: 16,
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h2 id="add-to-slot-title" style={{ margin: 0, fontSize: 24 }}>
              Add to Slot
            </h2>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 12,
                color: "rgba(255,255,255,0.62)",
                textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
            >
              {inferSlotType(slotId)} · {bungalowName}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              color: "white",
              borderRadius: 8,
              width: 36,
              height: 36,
              cursor: "pointer",
              font: "inherit",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["image", "link", "portal", "decoration"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setType(option);
                setError(null);
                setUrl("");
                setPreview(null);
              }}
              style={{
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.15)",
                background:
                  type === option
                    ? "linear-gradient(135deg, #3aab68, #2b7e4b)"
                    : "rgba(255,255,255,0.05)",
                color: "white",
                padding: "8px 14px",
                cursor: "pointer",
                font: "inherit",
                textTransform: "capitalize",
              }}
            >
              {option}
            </button>
          ))}
        </div>

        <label style={fieldLabelStyle}>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="What should this decoration be called?"
            style={inputStyle}
          />
        </label>

        <div
          style={{
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.03)",
            padding: "10px 12px",
            fontSize: 12,
            lineHeight: 1.45,
            color: "rgba(255,255,255,0.72)",
          }}
        >
          This installs directly into <strong style={{ color: "#f6f0df" }}>{bungalowName}</strong>.
        </div>

        {type === "image" ? (
          <label style={fieldLabelStyle}>
            Image URL
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://..."
              style={inputStyle}
            />
          </label>
        ) : null}

        {type === "link" ? (
          <label style={fieldLabelStyle}>
            Link URL
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://..."
              style={inputStyle}
            />
          </label>
        ) : null}

        {type === "portal" ? (
          <label style={fieldLabelStyle}>
            Destination URL
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://..."
              style={inputStyle}
            />
          </label>
        ) : null}

        {type === "image" && isHttpUrl(url) ? (
          <div
            style={{
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)",
            }}
          >
            <img
              src={url}
              alt={name || "Preview"}
              style={{ display: "block", width: "100%", maxHeight: 220, objectFit: "cover" }}
            />
          </div>
        ) : null}

        {type === "link" && preview ? (
          <div
            style={{
              background: "rgba(10,20,10,0.92)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 8,
              padding: 8,
              display: "grid",
              gap: 8,
            }}
          >
            {preview.image ? (
              <img
                src={preview.image}
                alt={preview.title ?? name}
                style={{
                  width: "100%",
                  maxHeight: 120,
                  objectFit: "cover",
                  borderRadius: 6,
                }}
              />
            ) : null}
            <strong style={{ fontSize: 12 }}>{preview.title ?? name}</strong>
            {preview.description ? (
              <span
                style={{
                  fontSize: 11,
                  lineHeight: 1.4,
                  color: "rgba(255,255,255,0.72)",
                }}
              >
                {preview.description}
              </span>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div
            style={{
              borderRadius: 8,
              border: "1px solid rgba(255,110,110,0.35)",
              background: "rgba(120,20,20,0.22)",
              padding: "10px 12px",
              color: "#ffd0d0",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={submitting}
          style={{
            minHeight: 46,
            border: 0,
            borderRadius: 10,
            background: "linear-gradient(135deg, #ffd37a, #f8bf57)",
            color: "#241b08",
            font: "inherit",
            fontWeight: 700,
            cursor: submitting ? "progress" : "pointer",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "Placing..." : "Place in Bungalow"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
