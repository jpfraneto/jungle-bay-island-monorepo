import { useNavigate } from "react-router-dom";
import type { HomeTeamBungalow } from "../hooks/useHomeTeam";
import { GLOW_COLORS } from "../utils/constants";
import { getFallbackTokenImage, getTokenImageUrl } from "../utils/tokenImage";
import styles from "../styles/sidebar.module.css";
import ChainIcon from "./ChainIcon";

interface SidebarProps {
  bungalows: HomeTeamBungalow[];
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ bungalows, isOpen, onClose }: SidebarProps) {
  const navigate = useNavigate();

  return (
    <>
      <button
        type="button"
        aria-label="Close sidebar"
        className={`${styles.backdrop} ${isOpen ? styles.backdropOpen : ""}`}
        onClick={onClose}
      />

      <aside
        className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ""}`}
      >
        <section className={styles.section}>
          <h2 className={styles.heading}>CORE</h2>
          <button
            type="button"
            className={styles.itemButton}
            onClick={() => {
              navigate("/about");
              onClose();
            }}
          >
            <span>📖</span>
            <span>About</span>
          </button>
          <button
            type="button"
            className={styles.itemButton}
            onClick={() => {
              navigate("/heat-score");
              onClose();
            }}
          >
            <span>🔥</span>
            <span>Heat Score</span>
          </button>
        </section>

        <section className={styles.section}>
          <h2 className={styles.heading}>MARKETPLACE</h2>
          <button
            type="button"
            className={styles.itemButton}
            onClick={() => {
              navigate("/bodega");
              onClose();
            }}
          >
            <span>🛖</span>
            <span>Bodega</span>
          </button>
        </section>

        <section className={styles.section}>
          <h2 className={styles.heading}>BUNGALOWS</h2>
          <div className={styles.bungalowList}>
            {bungalows.length === 0 ? (
              <div className={styles.empty}>
                No bungalows yet. Try again in a moment.
              </div>
            ) : (
              bungalows.map((bungalow, index) => {
                const symbol = bungalow.symbol ?? "?";
                return (
                  <button
                    key={`${bungalow.chain}:${bungalow.token_address}`}
                    type="button"
                    className={styles.bungalowButton}
                    onClick={() => {
                      navigate(`/${bungalow.chain}/${bungalow.token_address}`);
                      onClose();
                    }}
                  >
                    <span
                      className={styles.imageRing}
                      style={{
                        boxShadow: `0 0 0 1px ${GLOW_COLORS[index % GLOW_COLORS.length]}`,
                      }}
                    >
                      <img
                        className={styles.tokenImage}
                        src={getTokenImageUrl(
                          bungalow.image_url,
                          bungalow.token_address,
                          bungalow.symbol,
                        )}
                        alt={bungalow.symbol ?? bungalow.name ?? "token"}
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.src = getFallbackTokenImage(
                            `${bungalow.chain}:${bungalow.token_address}`,
                          );
                        }}
                      />
                    </span>
                    <span>{symbol}</span>
                    <span className={styles.chainIcon}>
                      <ChainIcon
                        chain={bungalow.chain}
                        className={styles.chainIcon}
                        size={11}
                      />
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </aside>
    </>
  );
}
