import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  getBodegaPreviewUrl,
  getBodegaSummaryText,
  normalizeBodegaCatalogItems,
  type BodegaCatalogItem,
} from "../utils/bodega";

interface BodegaModalProps {
  bungalowName: string;
  chain: string;
  ca: string;
  canSelectItems: boolean;
  onSelectItem: (item: BodegaCatalogItem) => void;
  onClose: () => void;
}

interface BodegaCatalogResponse {
  items?: unknown[];
  error?: unknown;
}

export default function BodegaModal({
  bungalowName,
  chain,
  ca,
  canSelectItems,
  onSelectItem,
  onClose,
}: BodegaModalProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<BodegaCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 600,
  );

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCatalog() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/bodega/catalog?limit=20", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response
          .json()
          .catch(() => null)) as BodegaCatalogResponse | null;
        const apiError =
          typeof data?.error === "string" && data.error.trim().length > 0
            ? data.error
            : null;

        if (!response.ok) {
          throw new Error(apiError ?? `Request failed (${response.status})`);
        }

        setItems(normalizeBodegaCatalogItems(data?.items));
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        setItems([]);
        setError(
          err instanceof Error ? err.message : "Failed to load Bodega catalog",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadCatalog();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Bodega for ${bungalowName}`}
        onClick={(event) => event.stopPropagation()}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(620px, 92vw)",
          maxHeight: "80vh",
          overflowY: "auto",
          background: "#0d1f0d",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 16,
          padding: 24,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              color: "#ffe8a0",
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            {"🛖 Bodega for "}
            {bungalowName}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close bodega modal"
            style={{
              border: 0,
              background: "transparent",
              color: "white",
              fontSize: 26,
              lineHeight: 1,
              cursor: "pointer",
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            marginBottom: 18,
            color: "rgba(255,255,255,0.68)",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {canSelectItems
            ? "Pick a Bodega item and the bungalow will auto-arrange it onto the room collage."
            : "Only the bungalow steward can place Bodega items inside this room."}
        </div>

        {isLoading ? (
          <div
            style={{
              color: "rgba(255,255,255,0.7)",
              fontSize: 13,
            }}
          >
            Loading Bodega items...
          </div>
        ) : null}

        {!isLoading && error ? (
          <div
            style={{
              color: "#ffd7d7",
              fontSize: 13,
              padding: "12px 14px",
              borderRadius: 10,
              background: "rgba(120,20,20,0.2)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {error}
          </div>
        ) : null}

        {!isLoading && !error ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "minmax(0, 1fr)"
                : "repeat(2, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            {items.map((item) => {
              const previewUrl = getBodegaPreviewUrl(item);
              return (
                <div
                  key={item.id}
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: 10,
                    padding: 12,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    minWidth: 0,
                  }}
                >
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={item.title}
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 8,
                        objectFit: "cover",
                        display: "block",
                        flex: "0 0 auto",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 8,
                        background: "#1a3a1a",
                        flex: "0 0 auto",
                      }}
                    />
                  )}

                  <div
                    style={{
                      minWidth: 0,
                      flex: 1,
                      display: "grid",
                      gap: 4,
                    }}
                  >
                    <strong
                      style={{
                        color: "white",
                        fontSize: 14,
                        lineHeight: 1.2,
                      }}
                    >
                      {item.title}
                    </strong>
                    <div
                      style={{
                        fontSize: 11,
                        color: "rgba(255,255,255,0.55)",
                        lineHeight: 1.4,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {getBodegaSummaryText(item)}
                    </div>
                    <div
                      style={{
                        color: "#ffe8a0",
                        fontSize: 12,
                      }}
                    >
                      {item.price_in_jbm} jungle bay memes
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onSelectItem(item);
                    }}
                    disabled={!canSelectItems}
                    style={{
                      background: "#2a5a2a",
                      color: "white",
                      border: 0,
                      borderRadius: 6,
                      padding: "6px 14px",
                      fontSize: 12,
                      cursor: canSelectItems ? "pointer" : "not-allowed",
                      opacity: canSelectItems ? 1 : 0.45,
                      flex: "0 0 auto",
                    }}
                  >
                    {canSelectItems ? "Buy" : "Owner only"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {!isLoading && !error && items.length === 0 ? (
          <div
            style={{
              color: "rgba(255,255,255,0.7)",
              fontSize: 13,
            }}
          >
            No Bodega items are available right now.
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => {
            navigate("/bodega", {
              state: {
                preselectedBungalow: {
                  chain,
                  token_address: ca,
                  name: bungalowName,
                  symbol: null,
                  image_url: null,
                },
              },
            });
          }}
          style={{
            marginTop: 18,
            border: 0,
            background: "transparent",
            color: "#ffe8a0",
            fontSize: 12,
            cursor: "pointer",
            padding: 0,
          }}
        >
          Browse full Bodega →
        </button>
      </div>
    </div>,
    document.body,
  );
}
