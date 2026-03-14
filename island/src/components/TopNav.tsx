import { Link, useNavigate } from "react-router-dom";
import WalletButton from "./WalletButton";
import type { AppMeState } from "../utils/onchain";
import styles from "../styles/top-nav.module.css";

interface TopNavProps {
  isIslandActive: boolean;
  meState: AppMeState | null;
  showSidebarToggle: boolean;
  onToggleSidebar: () => void;
}

export default function TopNav({
  isIslandActive,
  meState,
  showSidebarToggle,
  onToggleSidebar,
}: TopNavProps) {
  const navigate = useNavigate();
  const profileId = meState?.me?.profile?.profile_id ?? null;
  const claimable = meState?.claim?.can_claim
    ? meState.claim.amount_jbm
    : null;

  return (
    <header className={styles.topNav}>
      <div className={styles.left}>
        {showSidebarToggle ? (
          <button
            type="button"
            className={styles.menuButton}
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
          >
            <span />
            <span />
            <span />
          </button>
        ) : null}

        <button
          type="button"
          className={styles.brand}
          onClick={() => navigate("/")}
        >
          <span>jungle bay island</span>
        </button>
      </div>

      <div className={styles.center}>
        <div className={styles.togglePill}>
          <button
            type="button"
            className={`${styles.toggleItem} ${isIslandActive ? styles.active : ""}`}
            onClick={() => navigate("/island")}
          >
            Island
          </button>
          <button
            type="button"
            className={styles.toggleItem}
            aria-disabled="true"
            onClick={() => navigate("/about")}
          >
            About
          </button>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.togglePill}>
          <Link to="/profile" className={styles.toggleItem}>
            {profileId ? `Profile #${profileId}` : "Profile"}
          </Link>
          {claimable ? (
            <button
              type="button"
              className={`${styles.toggleItem} ${styles.active}`}
              onClick={() => navigate("/profile")}
            >
              Claim {claimable} JBM
            </button>
          ) : null}
        </div>
        <WalletButton />
      </div>
    </header>
  );
}
