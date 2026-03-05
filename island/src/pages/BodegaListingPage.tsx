import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useNavigate, useParams } from "react-router-dom";
import BodegaCard from "../components/BodegaCard";
import BodegaInstallModal from "../components/BodegaInstallModal";
import { useBungalowDirectory } from "../hooks/useBungalowDirectory";
import styles from "../styles/bodega-listing-page.module.css";
import { formatAddress } from "../utils/formatters";
import {
  getBodegaListingPath,
  getBungalowLookupKey,
  isHexTxHash,
  normalizeBodegaCatalogItem,
  type BodegaCatalogItem,
} from "../utils/bodega";

interface BodegaListingResponse {
  item?: unknown;
  error?: unknown;
}

export default function BodegaListingPage() {
  const { tx_hash } = useParams();
  const navigate = useNavigate();
  const { authenticated, login } = usePrivy();
  const {
    bungalows: publicBungalows,
    isLoading: isPublicDirectoryLoading,
    error: publicDirectoryError,
  } = useBungalowDirectory({
    limit: 200,
    enabled: true,
    fetchAll: true,
  });

  const [item, setItem] = useState<BodegaCatalogItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [isInstallOpen, setIsInstallOpen] = useState(false);

  const normalizedTxHash = useMemo(() => {
    const candidate = (tx_hash ?? "").trim().toLowerCase();
    return isHexTxHash(candidate) ? candidate : null;
  }, [tx_hash]);

  const listingPath = useMemo(
    () => getBodegaListingPath(normalizedTxHash),
    [normalizedTxHash],
  );

  const visibleBungalowOptions = publicBungalows;
  const originLookupBungalows = publicBungalows;

  const originLookup = useMemo(() => {
    const lookup = new Map<string, (typeof originLookupBungalows)[number]>();
    for (const bungalow of originLookupBungalows) {
      const key = getBungalowLookupKey(bungalow.chain, bungalow.token_address);
      if (key) {
        lookup.set(key, bungalow);
      }
    }
    return lookup;
  }, [originLookupBungalows]);

  const originBungalow = useMemo(() => {
    if (!item) return null;
    const key = getBungalowLookupKey(
      item.origin_bungalow_chain,
      item.origin_bungalow_token_address,
    );
    if (!key) return null;
    return originLookup.get(key) ?? null;
  }, [item, originLookup]);

  const selectionNote = publicDirectoryError
    ? `Bungalow list is unavailable right now: ${publicDirectoryError}`
    : "Choose any bungalow on the island.";

  const loadListing = useCallback(async () => {
    if (!normalizedTxHash) {
      setItem(null);
      setError("Invalid listing URL. This transaction hash format is not recognized.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/bodega/catalog/tx/${encodeURIComponent(normalizedTxHash)}`,
        { cache: "no-store" },
      );
      const data = (await response.json().catch(() => null)) as
        | BodegaListingResponse
        | null;

      const apiError =
        typeof data?.error === "string" && data.error.trim().length > 0
          ? data.error
          : null;

      if (!response.ok) {
        throw new Error(apiError ?? `Request failed (${response.status})`);
      }

      const nextItem = normalizeBodegaCatalogItem(data?.item);
      if (!nextItem) {
        throw new Error("Listing payload was incomplete.");
      }

      setItem(nextItem);
    } catch (err) {
      setItem(null);
      setError(err instanceof Error ? err.message : "Failed to load listing");
    } finally {
      setIsLoading(false);
    }
  }, [normalizedTxHash]);

  useEffect(() => {
    void loadListing();
  }, [loadListing]);

  const handleCopyLink = async () => {
    if (!listingPath) {
      setCopyStatus("Listing URL is unavailable for this item.");
      return;
    }

    const shareUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}${listingPath}`
        : listingPath;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyStatus("Listing link copied.");
    } catch {
      setCopyStatus("Could not copy the listing link automatically.");
    }
  };

  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.kicker}>Bodega Listing</p>
        <h1>Direct listing link</h1>
        {normalizedTxHash ? (
          <p className={styles.summary}>
            Published from transaction {formatAddress(normalizedTxHash)}.
          </p>
        ) : (
          <p className={styles.summary}>This listing URL is malformed.</p>
        )}
      </header>

      {isLoading ? (
        <div className={styles.statusCard}>
          <strong>Loading listing...</strong>
        </div>
      ) : null}

      {!isLoading && error ? (
        <div className={styles.statusCard}>
          <strong>Could not load this listing.</strong>
          <span>{error}</span>
          <div className={styles.actionsRow}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                void loadListing();
              }}
            >
              Retry
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => navigate("/bodega")}
            >
              Back to Bodega
            </button>
          </div>
        </div>
      ) : null}

      {!isLoading && item ? (
        <>
          <div className={styles.actionsRow}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                void handleCopyLink();
              }}
            >
              Share
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => navigate("/bodega")}
            >
              Browse all listings
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                if (!authenticated) {
                  login();
                  return;
                }
                setIsInstallOpen(true);
              }}
            >
              Add to bungalow
            </button>
          </div>

          {copyStatus ? <p className={styles.copyStatus}>{copyStatus}</p> : null}

          <BodegaCard
            item={item}
            originBungalow={originBungalow}
            compact={false}
            onAdd={() => {
              if (!authenticated) {
                login();
                return;
              }
              setIsInstallOpen(true);
            }}
          />

          <BodegaInstallModal
            open={isInstallOpen}
            item={item}
            bungalowOptions={visibleBungalowOptions}
            isDirectoryLoading={isPublicDirectoryLoading}
            isWalletScoped={false}
            selectionNote={selectionNote}
            onClose={() => setIsInstallOpen(false)}
            onInstalled={(install) => {
              if (install.id > 0) {
                setItem((current) =>
                  current
                    ? {
                        ...current,
                        install_count: current.install_count + 1,
                      }
                    : current,
                );
              }
            }}
          />
        </>
      ) : null}
    </section>
  );
}
