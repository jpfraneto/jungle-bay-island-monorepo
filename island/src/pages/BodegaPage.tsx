import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useLocation } from "react-router-dom";
import BodegaCard from "../components/BodegaCard";
import BodegaInstallModal from "../components/BodegaInstallModal";
import BodegaSubmitModal from "../components/BodegaSubmitModal";
import { useBungalowDirectory } from "../hooks/useBungalowDirectory";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import styles from "../styles/bodega-page.module.css";
import {
  BODEGA_ASSET_GROUP_LABELS,
  getBungalowLookupKey,
  normalizeBodegaCatalogItems,
  normalizeDirectoryBungalows,
  type BodegaCatalogItem,
  type DirectoryBungalow,
} from "../utils/bodega";

type AssetFilter = "all" | "art" | "miniapp";

interface BodegaCatalogResponse {
  items?: unknown[];
  error?: unknown;
}

interface BodegaPageState {
  preselectedBungalow?: unknown;
  highlightItemId?: unknown;
}

const PAGE_SIZE = 18;

/**
 * Normalizes route state so bungalow pages can hand the Bodega a target install venue.
 */
function parseLocationBungalow(input: unknown): DirectoryBungalow | null {
  const items = normalizeDirectoryBungalows(input ? [input] : []);
  return items[0] ?? null;
}

export default function BodegaPage() {
  const location = useLocation();
  const { authenticated, login } = usePrivy();
  const { walletAddress } = usePrivyBaseWallet();
  const {
    bungalows: selectorBungalows,
    isLoading: isSelectorLoading,
  } = useBungalowDirectory({
    walletAddress,
    limit: 200,
  });
  const {
    bungalows: publicBungalows,
    isLoading: isPublicDirectoryLoading,
    error: publicDirectoryError,
  } = useBungalowDirectory({
    limit: 200,
    enabled: true,
    fetchAll: true,
  });

  const locationState = (location.state as BodegaPageState | null) ?? null;
  const preselectedBungalow = useMemo(
    () => parseLocationBungalow(locationState?.preselectedBungalow),
    [locationState?.preselectedBungalow],
  );
  const isWalletScoped = Boolean(walletAddress);
  const visibleBungalowOptions = publicBungalows;
  const submitOriginOptions = isWalletScoped ? publicBungalows : selectorBungalows;
  const originLookupBungalows = isWalletScoped ? publicBungalows : selectorBungalows;
  const effectivePreselectedBungalow = useMemo(() => {
    if (!preselectedBungalow) return null;

    const targetKey = getBungalowLookupKey(
      preselectedBungalow.chain,
      preselectedBungalow.token_address,
    );
    if (!targetKey) return null;

    return (
      visibleBungalowOptions.find(
        (bungalow) =>
          getBungalowLookupKey(bungalow.chain, bungalow.token_address) === targetKey,
      ) ?? preselectedBungalow
    );
  }, [preselectedBungalow, visibleBungalowOptions]);

  const [filter, setFilter] = useState<AssetFilter>("all");
  const [items, setItems] = useState<BodegaCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<BodegaCatalogItem | null>(
    null,
  );
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [highlightedItemId, setHighlightedItemId] = useState<number | null>(
    typeof locationState?.highlightItemId === "number"
      ? locationState.highlightItemId
      : null,
  );

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fetchGenerationRef = useRef(0);

  const bungalowLookup = useMemo(() => {
    const lookup = new Map<string, DirectoryBungalow>();
    for (const bungalow of originLookupBungalows) {
      const key = getBungalowLookupKey(bungalow.chain, bungalow.token_address);
      if (key) {
        lookup.set(key, bungalow);
      }
    }
    return lookup;
  }, [originLookupBungalows]);

  /**
   * Loads one page of catalog results and preserves ordering for infinite scroll.
   */
  const loadCatalogPage = useCallback(
    async (offset: number, append: boolean) => {
      const currentGeneration = append
        ? fetchGenerationRef.current
        : fetchGenerationRef.current + 1;

      if (!append) {
        fetchGenerationRef.current = currentGeneration;
      }

      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      try {
        const params = new URLSearchParams();
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(offset));
        if (filter !== "all") {
          params.set("asset_group", filter);
        }

        const response = await fetch(`/api/bodega/catalog?${params.toString()}`, {
          cache: "no-store",
        });

        const data = (await response.json().catch(() => null)) as
          | BodegaCatalogResponse
          | null;

        if (currentGeneration !== fetchGenerationRef.current) {
          return;
        }

        const apiError =
          typeof data?.error === "string" && data.error.trim().length > 0
            ? data.error
            : null;

        if (!response.ok) {
          throw new Error(apiError ?? `Request failed (${response.status})`);
        }

        const nextItems = normalizeBodegaCatalogItems(data?.items);

        setItems((current) => {
          if (!append) {
            return nextItems;
          }

          const seen = new Set(current.map((item) => item.id));
          const merged = [...current];
          for (const nextItem of nextItems) {
            if (!seen.has(nextItem.id)) {
              merged.push(nextItem);
              seen.add(nextItem.id);
            }
          }
          return merged;
        });
        setHasMore(nextItems.length >= PAGE_SIZE);
      } catch (err) {
        if (!append) {
          setItems([]);
          setHasMore(false);
        }
        setError(
          err instanceof Error ? err.message : "Failed to load Bodega catalog",
        );
      } finally {
        if (append) {
          setIsLoadingMore(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    [filter],
  );

  useEffect(() => {
    setItems([]);
    setHasMore(true);
    void loadCatalogPage(0, false);
  }, [filter, loadCatalogPage, refreshToken]);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || !hasMore) return;
    void loadCatalogPage(items.length, true);
  }, [hasMore, isLoading, isLoadingMore, items.length, loadCatalogPage]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || isLoading || isLoadingMore || !hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore();
        }
      },
      {
        rootMargin: "220px 0px",
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, isLoading, isLoadingMore, loadMore]);

  useEffect(() => {
    if (!highlightedItemId) return;
    if (!items.some((item) => item.id === highlightedItemId)) return;

    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(`bodega-item-${highlightedItemId}`);
      element?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [highlightedItemId, items]);

  const selectionNote = publicDirectoryError
    ? `Bungalow list is unavailable right now: ${publicDirectoryError}`
    : "Choose any community bungalow on the island. You will pick the exact room spot there before paying.";
  const submitSelectionNote = publicDirectoryError
    ? `Bungalow list is unavailable right now: ${publicDirectoryError}`
    : "Choose the bungalow this came from, or leave it blank. Quick Add inside a bungalow uses this same inventory automatically.";

  return (
    <section className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Island Bodega</p>
          <h1>The full browse and publish lane for items that can travel across the island.</h1>
          <p className={styles.summary}>
            Quick Add inside a bungalow is the shortcut lane. The Bodega is the
            full shelf: browse, publish, price, and install. Listings rise by
            installs first, not just by recency.
          </p>
          {effectivePreselectedBungalow ? (
            <div className={styles.targetChip}>
              Installing into{" "}
              <strong>
                {effectivePreselectedBungalow.symbol ??
                  effectivePreselectedBungalow.name ??
                  "Current bungalow"}
              </strong>
            </div>
          ) : null}
        </div>

        <div className={styles.heroActions}>
          <button
            type="button"
            className={styles.submitButton}
            onClick={() => setIsSubmitOpen(true)}
          >
            Submit to Bodega
          </button>
        </div>
      </div>

      <div className={styles.filterBar}>
        <label className={styles.filterField}>
          <span>Filter</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as AssetFilter)}
          >
            <option value="all">All listings</option>
            {(Object.keys(BODEGA_ASSET_GROUP_LABELS) as Array<Exclude<AssetFilter, "all">>).map((assetGroup) => (
              <option key={assetGroup} value={assetGroup}>
                {BODEGA_ASSET_GROUP_LABELS[assetGroup]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && items.length === 0 ? (
        <div className={styles.statusCard}>
          <strong>Could not load the Bodega.</strong>
          <span>{error}</span>
          <button
            type="button"
            className={styles.retryButton}
            onClick={() => setRefreshToken((current) => current + 1)}
          >
            Try again
          </button>
        </div>
      ) : null}

      {isLoading && items.length === 0 ? (
        <div className={styles.loadingGrid}>
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={`bodega-skeleton-${index}`} className={styles.skeletonCard} />
          ))}
        </div>
      ) : null}

      {!isLoading && items.length === 0 && !error ? (
        <div className={styles.statusCard}>
          <strong>No listings in this lane yet.</strong>
          <span>Change the filter or be the first builder to stock this shelf.</span>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className={styles.grid}>
          {items.map((item) => {
            const originKey = getBungalowLookupKey(
              item.origin_bungalow_chain,
              item.origin_bungalow_token_address,
            );

            return (
              <BodegaCard
                key={item.id}
                item={item}
                domId={`bodega-item-${item.id}`}
                highlighted={item.id === highlightedItemId}
                originBungalow={originKey ? bungalowLookup.get(originKey) ?? null : null}
                onAdd={() => {
                  if (!authenticated) {
                    login();
                    return;
                  }
                  setSelectedItem(item);
                }}
              />
            );
          })}
        </div>
      ) : null}

      <div ref={sentinelRef} className={styles.sentinel}>
        {isLoadingMore ? "Loading more listings..." : hasMore ? " " : "End of the dock."}
      </div>

      <BodegaInstallModal
        open={Boolean(selectedItem)}
        item={selectedItem}
        bungalowOptions={visibleBungalowOptions}
        isDirectoryLoading={isPublicDirectoryLoading}
        isWalletScoped={false}
        selectionNote={selectionNote}
        preselectedBungalow={effectivePreselectedBungalow}
        onClose={() => setSelectedItem(null)}
        onInstalled={(install) => {
          if (!selectedItem) return;

          setItems((current) =>
            current.map((item) =>
              item.id === selectedItem.id
                ? {
                    ...item,
                    install_count: item.install_count + 1,
                  }
                : item,
            ),
          );

          if (install.id > 0) {
            setHighlightedItemId(selectedItem.id);
          }
        }}
      />

      <BodegaSubmitModal
        open={isSubmitOpen}
        bungalowOptions={submitOriginOptions}
        isDirectoryLoading={isWalletScoped ? isPublicDirectoryLoading : isSelectorLoading}
        isWalletScoped={false}
        selectionNote={submitSelectionNote}
        defaultOriginBungalow={preselectedBungalow}
        onClose={() => setIsSubmitOpen(false)}
        onSubmitted={(item) => {
          setFilter("all");
          setHighlightedItemId(item.id);
          setRefreshToken((current) => current + 1);
        }}
      />
    </section>
  );
}
