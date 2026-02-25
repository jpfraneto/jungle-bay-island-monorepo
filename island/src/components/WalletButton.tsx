import { usePrivy } from "@privy-io/react-auth";
import styles from "../styles/wallet-button.module.css";

export default function WalletButton() {
  const { login, logout, authenticated, user } = usePrivy();

  if (authenticated && user?.wallet) {
    const addr = user.wallet.address;
    const short = `${addr.slice(0, 6)}...${addr.slice(-4)}`;

    return (
      <button type="button" onClick={logout} className={styles.walletButton}>
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
