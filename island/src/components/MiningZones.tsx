import styles from "../styles/mining-zones.module.css";

interface MiningZonesProps {
  heat: number;
}

interface MiningZone {
  title: string;
  requiredHeat: number;
  description: string;
}

const ZONES: MiningZone[] = [
  {
    title: "The Shallows",
    requiredHeat: 30,
    description: "Entry level yield farming. Warm water, low risk.",
  },
  {
    title: "The Reef",
    requiredHeat: 60,
    description: "Deeper currents, rarer rewards.",
  },
  {
    title: "The Abyss",
    requiredHeat: 90,
    description: "Only the most committed reach this depth.",
  },
];

export default function MiningZones({ heat }: MiningZonesProps) {
  return (
    <section className={styles.section}>
      <div className={styles.banner}>Coming Soon</div>
      <div className={styles.header}>
        <div>
          <p className={styles.kicker}>Mining Zones</p>
          <h2>Future depth gates for heat-driven earning.</h2>
        </div>
        <span className={styles.heatBadge}>Current heat: {heat.toFixed(1)}</span>
      </div>

      <div className={styles.grid}>
        {ZONES.map((zone) => {
          const unlocked = heat >= zone.requiredHeat;

          return (
            <article
              key={zone.title}
              className={`${styles.card} ${unlocked ? styles.unlocked : styles.locked}`}
            >
              <div className={styles.cardTop}>
                <span className={styles.zoneLabel}>{zone.title}</span>
                <span className={styles.requirement}>
                  Heat {zone.requiredHeat}
                </span>
              </div>
              <p className={styles.description}>{zone.description}</p>
              <div className={styles.statusRow}>
                {unlocked ? (
                  <span className={styles.accessGranted}>Access granted</span>
                ) : (
                  <span className={styles.lockedCopy}>
                    Locked. Requires {zone.requiredHeat} heat.
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
