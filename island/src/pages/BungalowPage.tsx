import { useState } from "react";
import { useParams } from "react-router-dom";
import AddItemModal from "../components/AddItemModal";
import ClaimPanel from "../components/ClaimPanel";
import Wall from "../components/Wall";
import { useBungalow } from "../hooks/useBungalow";
import { useBungalowItems } from "../hooks/useBungalowItems";
import NotFoundPage from "./NotFoundPage";
import { formatCompactUsd, formatNumber, formatUsdPrice } from "../utils/formatters";
import { getFallbackTokenImage, getTokenImageUrl } from "../utils/tokenImage";
import styles from "../styles/bungalow-page.module.css";

function chainLabel(chain: string): string {
  if (chain === "base") return "Base";
  if (chain === "ethereum") return "Ethereum";
  return "Solana";
}

export default function BungalowPage() {
  const { chain = "", ca = "" } = useParams();
  const { bungalow, isLoading, error } = useBungalow(chain, ca);
  const { items, isLoading: itemsLoading, refetch } = useBungalowItems(chain, ca);

  const [isAddOpen, setIsAddOpen] = useState(false);

  if (!chain || !ca) {
    return <div className={styles.page}>Invalid bungalow route</div>;
  }

  if (isLoading) {
    return <div className={styles.page}>Loading bungalow...</div>;
  }

  if (error || !bungalow) {
    return <div className={styles.page}>Failed to load bungalow: {error ?? "Unknown"}</div>;
  }

  if (!bungalow.exists) {
    return <NotFoundPage />;
  }

  const heat = bungalow.viewer_context?.token_heat_degrees ?? 0;
  const headerImage = getTokenImageUrl(bungalow.image_url, bungalow.token_address, bungalow.symbol);

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <section className={styles.mainColumn}>
          <header className={styles.headerCard}>
            <div className={styles.headerTop}>
              <img
                className={styles.tokenImage}
                src={headerImage}
                alt={bungalow.symbol ?? "token"}
                onError={(event) => {
                  event.currentTarget.src = getFallbackTokenImage(
                    `${bungalow.chain}:${bungalow.token_address}`,
                  );
                }}
              />

              <div>
                <h1 className={styles.title}>
                  {bungalow.name ?? "Unknown Token"} ({bungalow.symbol ? `$${bungalow.symbol}` : "?"})
                </h1>
                <div className={`${styles.chainBadge} ${chain === "base" ? styles.base : styles.ethereum}`}>
                  {chainLabel(chain)}
                </div>
              </div>
            </div>

            <div className={styles.stats}>
              <div>
                <span>Holders</span>
                <strong>{formatNumber(bungalow.holder_count)}</strong>
              </div>
              <div>
                <span>Heat</span>
                <strong>🔥 {heat.toFixed(1)}°</strong>
              </div>
              <div>
                <span>Market Cap</span>
                <strong>{formatCompactUsd(bungalow.market_data?.market_cap ?? null)}</strong>
              </div>
              <div>
                <span>Price</span>
                <strong>{formatUsdPrice(bungalow.market_data?.price_usd ?? null)}</strong>
              </div>
            </div>
          </header>

          <Wall items={items} isLoading={itemsLoading} onAdd={() => setIsAddOpen(true)} />
        </section>

        <div className={styles.sideColumn}>
          <ClaimPanel chain={chain} ca={ca} tokenSymbol={bungalow.symbol ?? "TOKEN"} />
        </div>
      </div>

      <AddItemModal
        chain={chain}
        ca={ca}
        open={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onCreated={() => {
          void refetch();
        }}
      />
    </div>
  );
}
