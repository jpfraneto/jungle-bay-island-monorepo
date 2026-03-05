import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import BungalowConstructionModal from "../components/BungalowConstructionModal";
import IslandMap from "../components/IslandMap";
import type { LayoutOutletContext } from "../components/Layout";
import styles from "../styles/island-page.module.css";

export default function IslandPage() {
  const [isConstructionOpen, setIsConstructionOpen] = useState(false);
  const { bungalows, homeTeamLoading, homeTeamError } =
    useOutletContext<LayoutOutletContext>();

  return (
    <section className={styles.page}>
      <article className={styles.introCard}>
        <div>
          <p className={styles.kicker}>Community Bungalows</p>
          <h1 className={styles.title}>
            Home team is now a vibe, not a whitelist.
          </h1>
          <p className={styles.summary}>
            Any project can open a bungalow once the island sees enough heat,
            support, or JBAC signal. Existing bungalows stay community
            property.
          </p>
        </div>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => setIsConstructionOpen(true)}
        >
          Open new bungalow
        </button>
      </article>

      <IslandMap
        bungalows={bungalows}
        isLoading={homeTeamLoading}
        error={homeTeamError}
      />

      <BungalowConstructionModal
        open={isConstructionOpen}
        onClose={() => setIsConstructionOpen(false)}
      />
    </section>
  );
}
