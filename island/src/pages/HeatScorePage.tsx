import styles from "../styles/heat-score-page.module.css";

export default function HeatScorePage() {
  return (
    <section className={styles.page}>
      <article className={styles.card}>
        <h1>About Jungle Bay</h1>
        <p>
          Jungle Bay is a token analysis and community platform. Each token gets
          a &ldquo;bungalow&rdquo; &mdash; a living profile page that tracks
          holders, community activity, and on-chain data across Base, Ethereum,
          and Solana.
        </p>
      </article>

      <article className={styles.card}>
        <h1>Heat Score</h1>
        <p>
          Heat Score measures how connected a wallet is to a token. It reflects
          the depth and duration of your holding history, not just a snapshot of
          your current balance.
        </p>

        <h2 className={styles.subheading}>The Math</h2>
        <p>
          Heat is derived from a wallet&apos;s <strong>Time-Weighted Average
          Balance (TWAB)</strong>. Instead of looking at your balance right now,
          TWAB captures your average holding across the token&apos;s entire
          scan window &mdash; rewarding consistent holders over short-term
          traders.
        </p>

        <div className={styles.formula}>
          <code>TWAB = (1 / T) * &sum; (balance_i * &Delta;t_i)</code>
        </div>

        <p className={styles.formulaDesc}>
          Where <em>T</em> is the total time window, <em>balance_i</em> is your
          token balance during interval <em>i</em>, and <em>&Delta;t_i</em> is
          the duration of that interval (measured in blocks).
        </p>

        <p>
          Your TWAB is then converted into a <strong>Heat Degree</strong> score
          on a 0&ndash;100 scale using an exponential saturation curve:
        </p>

        <div className={styles.formula}>
          <code>Heat = 100 * (1 &minus; e<sup>&minus;K * TWAB / totalSupply</sup>)</code>
        </div>

        <p className={styles.formulaDesc}>
          The constant <em>K&nbsp;=&nbsp;60</em> controls sensitivity. Small
          holders gain heat quickly, while large holders approach the ceiling
          asymptotically. This prevents whales from completely dominating
          rankings.
        </p>

        <h2 className={styles.subheading}>Tiers</h2>
        <p>
          Your <strong>island heat</strong> (summed across all bungalows) places
          you into a tier that unlocks different capabilities:
        </p>

        <table className={styles.tierTable}>
          <thead>
            <tr>
              <th>Tier</th>
              <th>Island Heat</th>
              <th>Perks</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Elder</td>
              <td>250+</td>
              <td>Full access, free scans (3/day), bulletin posting</td>
            </tr>
            <tr>
              <td>Builder</td>
              <td>150&ndash;249</td>
              <td>Free scans (3/day), bulletin posting</td>
            </tr>
            <tr>
              <td>Resident</td>
              <td>80&ndash;149</td>
              <td>Free scans (3/day)</td>
            </tr>
            <tr>
              <td>Observer</td>
              <td>30&ndash;79</td>
              <td>View-only, paid scans</td>
            </tr>
            <tr>
              <td>Drifter</td>
              <td>&lt; 30</td>
              <td>View-only, paid scans</td>
            </tr>
          </tbody>
        </table>

        <h2 className={styles.subheading}>Why TWAB?</h2>
        <ul className={styles.list}>
          <li>
            <strong>Sybil-resistant:</strong> Splitting tokens across wallets
            doesn&apos;t increase total heat &mdash; the sum of parts equals the
            whole.
          </li>
          <li>
            <strong>Diamond hands rewarded:</strong> Long-term holding
            accumulates more TWAB than short-term flips.
          </li>
          <li>
            <strong>Fair curve:</strong> The exponential saturation means even
            small holders earn meaningful heat, while mega-holders face
            diminishing returns.
          </li>
        </ul>
      </article>
    </section>
  );
}
