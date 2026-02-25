import { useNavigate } from "react-router-dom";
import WalletButton from "./WalletButton";
import styles from "../styles/top-nav.module.css";

interface TopNavProps {
  isIslandActive: boolean;
  showSidebarToggle: boolean;
  onToggleSidebar: () => void;
}

export default function TopNav({
  isIslandActive,
  showSidebarToggle,
  onToggleSidebar,
}: TopNavProps) {
  const navigate = useNavigate();

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

        <button type="button" className={styles.brand} onClick={() => navigate("/")}>
          <span className={styles.palm}>🌴</span>
          <span>jungle bay island</span>
        </button>
      </div>

      <div className={styles.center}>
        <div className={styles.togglePill}>
          <button
            type="button"
            className={`${styles.toggleItem} ${isIslandActive ? styles.active : ""}`}
            onClick={() => navigate("/")}
          >
            Island
          </button>
          <button type="button" className={styles.toggleItem} aria-disabled="true">
            About
          </button>
        </div>
      </div>

      <div className={styles.right}>
        <WalletButton />
      </div>
    </header>
  );
}
