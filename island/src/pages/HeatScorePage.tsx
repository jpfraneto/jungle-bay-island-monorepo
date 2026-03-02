import styles from "../styles/heat-score-page.module.css";

export default function HeatScorePage() {
  return (
    <section className={styles.page}>
      <article className={styles.card}>
        <h1>Heat Score</h1>
        <p>
          Heat Score is the Island&apos;s quiet measure of alignment. It is not
          designed to manufacture competition or to turn support into a public
          sport. It exists to recognize continuity: who stayed, for how long,
          and with what depth of commitment.
        </p>
        <p>
          The point is philosophical before it is mathematical. Jungle Bay is
          built on the idea that attention is cheap and continuity is rare. So
          the metric favors time, patience, and repeated presence over sudden
          bursts of activity.
        </p>

        <h2 className={styles.subheading}>The Math</h2>
        <p>
          Heat is derived from a wallet&apos;s{" "}
          <strong>Time-Weighted Average Balance (TWAB)</strong>. Instead of
          looking at your balance right now, TWAB captures your average holding
          across the token&apos;s entire scan window &mdash; rewarding
          consistent holders over short-term traders.
        </p>

        <div className={styles.formula}>
          <div className={styles.equation}>
            <span className={styles.symbol}>TWAB</span>
            <span className={styles.equals}>=</span>
            <span className={styles.fraction}>
              <span className={styles.numerator}>1</span>
              <span className={styles.denominator}>T</span>
            </span>
            <span className={styles.sigma}>
              &Sigma;<sub>i</sub>
            </span>
            <span className={styles.term}>
              balance<sub>i</sub>&nbsp;&Delta;t<sub>i</sub>
            </span>
          </div>
        </div>

        <p className={styles.formulaDesc}>
          Where <em>T</em> is the total time window, <em>balance_i</em> is your
          token balance during interval <em>i</em>, and <em>&Delta;t_i</em> is
          the duration of that interval (measured in blocks).
        </p>

        <p>
          TWAB is then converted into a <strong>Heat Degree</strong> score on a
          0&ndash;100 scale using an exponential saturation curve:
        </p>

        <div className={styles.formula}>
          <div className={styles.equation}>
            <span className={styles.symbol}>Heat</span>
            <span className={styles.equals}>=</span>
            <span>100</span>
            <span className={styles.dot}>&middot;</span>
            <span>(</span>
            <span>1</span>
            <span className={styles.minus}>&minus;</span>
            <span>
              e
              <sup className={styles.exponent}>
                &minus;K &middot; TWAB / totalSupply
              </sup>
            </span>
            <span>)</span>
          </div>
        </div>

        <p className={styles.formulaDesc}>
          The constant <em>K&nbsp;=&nbsp;60</em> controls sensitivity. Small
          holders gain heat quickly, while large holders approach the ceiling
          asymptotically. This keeps the system from becoming a pure whale
          ranking and gives smaller, patient holders a meaningful signal.
        </p>

        <h2 className={styles.subheading}>Why This Shape Matters</h2>
        <p>
          The formula is intentionally anti-gamified. It rewards consistency,
          decays slowly, and is harder to fake with short-term moves. Heat is
          meant to accumulate in the background, almost like reputation that the
          Island notices even when no one is performing for it.
        </p>

        <ul className={styles.list}>
          <li>
            <strong>Time matters more than noise:</strong> long-term holding
            carries more weight than brief attention spikes.
          </li>
          <li>
            <strong>Scale has diminishing returns:</strong> more size still
            matters, but it does not flatten everyone else out of view.
          </li>
          <li>
            <strong>Recognition stays passive:</strong> the metric is meant to
            unlock access quietly, not pressure users into optimizing it every
            day.
          </li>
        </ul>

        <h2 className={styles.subheading}>Island Heat And Tiers</h2>
        <p>
          Your <strong>island heat</strong> is the sum of your heat across all
          bungalows. These tiers are best understood as internal trust bands,
          not social classes. They help the Island decide what becomes available
          to you over time.
        </p>

        <table className={styles.tierTable}>
          <thead>
            <tr>
              <th>Tier</th>
              <th>Island Heat</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Elder</td>
              <td>250+</td>
              <td>Deep continuity across the Island</td>
            </tr>
            <tr>
              <td>Builder</td>
              <td>150&ndash;249</td>
              <td>Strong sustained presence</td>
            </tr>
            <tr>
              <td>Resident</td>
              <td>80&ndash;149</td>
              <td>Established and active alignment</td>
            </tr>
            <tr>
              <td>Observer</td>
              <td>30&ndash;79</td>
              <td>Early but noticeable presence</td>
            </tr>
            <tr>
              <td>Drifter</td>
              <td>&lt; 30</td>
              <td>Light contact with the territory</td>
            </tr>
          </tbody>
        </table>

        <h2 className={styles.subheading}>The Intent</h2>
        <p>
          Heat should never feel like a daily chore. If the metric starts
          encouraging streaks, urgency, or clout-seeking, it is being used the
          wrong way. The right feeling is quieter: the Island remembers that you
          were here, and that memory gradually matters.
        </p>
      </article>
    </section>
  );
}
