import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { usePrivyBaseWallet } from "../hooks/usePrivyBaseWallet";
import MiningZones from "../components/MiningZones";
import { formatAddress } from "../utils/formatters";
import styles from "../styles/mining-zones-page.module.css";

interface UserProfileResponse {
  island_heat?: number;
}

export default function MiningZonesPage() {
  const { authenticated } = usePrivy();
  const { walletAddress } = usePrivyBaseWallet();
  const [heat, setHeat] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!authenticated || !walletAddress) {
      setHeat(0);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);

    void (async () => {
      try {
        const response = await fetch(
          `/api/wallet/${encodeURIComponent(walletAddress)}?aggregate=true`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          setHeat(0);
          return;
        }

        const data = (await response.json()) as UserProfileResponse;
        const nextHeat = Number(data?.island_heat ?? 0);
        setHeat(Number.isFinite(nextHeat) ? nextHeat : 0);
      } catch {
        setHeat(0);
      } finally {
        setIsLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [authenticated, walletAddress]);

  return (
    <section className={styles.page}>
      <article className={styles.card}>
        <p className={styles.kicker}>Mining Zones</p>
        <h1>Future heat-gated earning now lives in its own lane.</h1>
        <p className={styles.summary}>
          {authenticated && walletAddress
            ? isLoading
              ? `Loading the current heat for ${formatAddress(walletAddress)}.`
              : `${formatAddress(walletAddress)} is currently sitting at ${heat.toFixed(1)} heat.`
            : "Connect a wallet to see how your current island heat lines up with the future zones."}
        </p>

        <MiningZones heat={heat} />
      </article>
    </section>
  );
}
