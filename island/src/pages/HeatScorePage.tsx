import styles from "../styles/heat-score-page.module.css";

export default function HeatScorePage() {
  return (
    <section className={styles.page}>
      <article className={styles.card}>
        <h1>Heat Score</h1>
        <p>
          Heat Score measures a wallet&apos;s connection to a token bungalow.
          The stronger your holding history and presence, the more heat you
          accumulate.
        </p>
        <ul className={styles.list}>
          <li>Higher heat improves your visibility in bungalow communities.</li>
          <li>Some actions unlock only after reaching a heat threshold.</li>
          <li>Heat can determine daily JBM claim opportunities.</li>
        </ul>
      </article>
    </section>
  );
}
