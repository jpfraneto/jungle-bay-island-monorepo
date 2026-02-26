import { useNavigate } from "react-router-dom";
import styles from "../styles/about-page.module.css";

export default function AboutPage() {
  const navigate = useNavigate();

  return (
    <section className={styles.page}>
      <article className={styles.card}>
        <h1>Jungle Bay</h1>
        <p className={styles.tagline}>
          A living map of on-chain communities.
        </p>
        <p>
          Jungle Bay turns token contracts into explorable community spaces
          called <strong>bungalows</strong>. Each bungalow is a living profile
          page for a token &mdash; tracking holders, on-chain activity, and
          community contributions across Base and Solana.
        </p>
      </article>

      <article className={styles.card}>
        <h2 className={styles.heading}>How it works</h2>
        <ol className={styles.steps}>
          <li>
            <strong>Paste a contract address</strong> &mdash; any ERC-20 on Base
            or SPL token on Solana. Jungle Bay scans every Transfer event from
            deploy block to present.
          </li>
          <li>
            <strong>The scanner builds a heat map</strong> &mdash; for every
            wallet that ever held the token, we compute a Time-Weighted Average
            Balance (TWAB) and convert it into a{" "}
            <button
              type="button"
              className={styles.inlineLink}
              onClick={() => navigate("/heat-score")}
            >
              Heat Score
            </button>
            .
          </li>
          <li>
            <strong>A bungalow is born</strong> &mdash; the token gets its own
            page with holder rankings, tier breakdowns, a community wall, and
            live market data.
          </li>
        </ol>
      </article>

      <article className={styles.card}>
        <h2 className={styles.heading}>Bungalows</h2>
        <p>
          Every scanned token gets a bungalow on the island. Inside you&apos;ll
          find:
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Heat tab</strong> &mdash; tier distribution showing how
            holders are spread across Elder, Builder, Resident, Observer, and
            Drifter.
          </li>
          <li>
            <strong>Holders tab</strong> &mdash; ranked table of every wallet by
            heat score, filterable by tier.
          </li>
          <li>
            <strong>Chart</strong> &mdash; live price chart powered by
            DexScreener.
          </li>
          <li>
            <strong>Wall</strong> &mdash; community bulletin board for
            token-specific discussion.
          </li>
        </ul>
      </article>

      <article className={styles.card}>
        <h2 className={styles.heading}>Heat &amp; Tiers</h2>
        <p>
          Your <strong>island heat</strong> is the sum of your heat scores
          across every bungalow you hold tokens in. Higher island heat places
          you in a higher tier, unlocking capabilities like free scans and
          bulletin posting.
        </p>
        <p>
          Heat rewards consistent, long-term holders over short-term flippers.
          The math is designed so that splitting tokens across wallets
          doesn&apos;t game the system &mdash; the sum of parts equals the
          whole.
        </p>
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => navigate("/heat-score")}
        >
          Read the full Heat Score breakdown &rarr;
        </button>
      </article>

      <article className={styles.card}>
        <h2 className={styles.heading}>Supported chains</h2>
        <div className={styles.chains}>
          <span className={styles.chain}>Base</span>
          <span className={styles.chain}>Solana</span>
        </div>
      </article>
    </section>
  );
}
