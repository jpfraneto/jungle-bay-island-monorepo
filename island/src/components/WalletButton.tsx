import { usePrivy } from "@privy-io/react-auth";
import { useNavigate } from "react-router-dom";
import styles from "../styles/wallet-button.module.css";

export default function WalletButton() {
  const { login, authenticated, user } = usePrivy();
  const navigate = useNavigate();

  if (authenticated) {
    const addr = user?.wallet?.address;
    const short = addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "Profile";

    return (
      <button
        type="button"
        onClick={() => navigate("/profile")}
        className={styles.walletButton}
      >
        {short}
      </button>
    );
  }

  return (
    <button type="button" onClick={login} className={styles.connectButton}>
      Connect
    </button>
  );
}
