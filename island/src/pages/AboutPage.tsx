import { useNavigate } from "react-router-dom";
import styles from "../styles/about-page.module.css";

export default function AboutPage() {
  const navigate = useNavigate();

  return (
    <section className={styles.page}>
      <article className={styles.card}>
        <p className={styles.tagline}>A place where memes can stay.</p>
        <p>
          Jungle Bay Island is a cultural persistence layer for memes. It is not
          a social network, not a launchpad, and not a gamified engagement loop.
          It is a digital territory where projects can keep their place through
          market cycles instead of resetting to zero every time attention moves
          on.
        </p>
        <p>
          The core belief is simple: memes do not fail because they lack
          creativity. They fail because they lose continuity. Context fragments,
          people disperse, and every cycle starts from scratch. Jungle Bay
          exists to give that context a home.
        </p>
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => navigate("/changelog")}
        >
          Read the current changelog
        </button>
      </article>

      <article className={styles.card}>
        <h2 className={styles.heading}>What The Island Optimizes For</h2>
        <ul className={styles.list}>
          <li>
            <strong>Continuity over virality</strong> &mdash; the system rewards
            time, patience, and sustained alignment, not spikes in attention.
          </li>
          <li>
            <strong>Territory over profiles</strong> &mdash; projects live as
            <strong> bungalows</strong>, which behave like places people return
            to, not pages they skim past.
          </li>
          <li>
            <strong>Passive recognition</strong> &mdash; support is tracked in
            the background. Heat accumulates quietly and unlocks access without
            turning into a public contest.
          </li>
          <li>
            <strong>Adjacency over hierarchy</strong> &mdash; growth comes from
            cultural closeness and placement, not featured rankings or forced
            promotion.
          </li>
          <li>
            <strong>Restraint over noise</strong> &mdash; when in doubt, the
            Island should feel quieter, not louder.
          </li>
        </ul>
      </article>

      <article className={styles.card}>
        <h2 className={styles.heading}>The New Bungalow Model</h2>
        <p>
          A bungalow now represents the <strong>project</strong>, not just one
          contract. That matters because real internet projects usually extend
          beyond a single deployment. A memecoin can live on multiple chains. A
          project can also carry a token and an NFT collection at the same time.
          The Island now treats those as one place with internal structure,
          instead of fragmenting them into unrelated pages.
        </p>
        <div className={styles.modelGrid}>
          <div className={styles.modelCard}>
            <p className={styles.modelLabel}>Bungalow</p>
            <h3 className={styles.modelTitle}>The Project</h3>
            <p>
              This is the cultural unit. It owns the name, story, wall, zone,
              and the sense of place.
            </p>
          </div>
          <div className={styles.modelCard}>
            <p className={styles.modelLabel}>Asset</p>
            <h3 className={styles.modelTitle}>The Official Things Inside It</h3>
            <p>
              A bungalow can hold multiple official assets: a fungible token, an
              NFT collection, and later other artifacts that belong to the same
              project.
            </p>
          </div>
          <div className={styles.modelCard}>
            <p className={styles.modelLabel}>Deployment</p>
            <h3 className={styles.modelTitle}>The Chain-Specific Door</h3>
            <p>
              Each asset can have one or many deployments. Chain routes are now
              entry points into the same place, not separate bungalows.
            </p>
          </div>
        </div>
      </article>

      <article className={styles.card}>
        <h2 className={styles.heading}>How It Works</h2>
        <ol className={styles.steps}>
          <li>
            <strong>A project gets territory</strong> &mdash; the bungalow is
            the home of the project itself, not just a contract page.
          </li>
          <li>
            <strong>Assets live inside the bungalow</strong> &mdash; one
            project can contain multiple official assets, each with its own
            chain panels and operational logic.
          </li>
          <li>
            <strong>Time becomes signal</strong> &mdash; holdings are observed
            across time, not just at a snapshot. That history is converted into
            a quiet alignment signal called{" "}
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
            <strong>The Island gains memory</strong> &mdash; walls, proximity,
            and repeated presence allow projects to accumulate meaning instead
            of disappearing between cycles.
          </li>
          <li>
            <strong>The Bodega closes the loop</strong> &mdash; builders can
            publish an asset once through two clear lanes (<strong>Art</strong>{" "}
            and <strong>Miniapps</strong>), let any bungalow install it, and
            earn JBM when the Island reuses that work.
          </li>
        </ol>
      </article>

      <article className={styles.card}>
        <h2 className={styles.heading}>What This Enables</h2>
        <p>
          This lets the Island represent projects more truthfully. If the same
          token exists on multiple chains, those routes now open the same
          bungalow. If a project has both a token and an NFT collection, they
          can live under one umbrella without pretending they are the same
          instrument.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>One identity, many doors</strong> &mdash; `/base/:ca` and
            `/solana/:ca` can resolve into the same cultural place when they are
            part of the same project.
          </li>
          <li>
            <strong>One wall, shared memory</strong> &mdash; related assets feed
            into the same public surface instead of splitting the community
            across duplicate pages.
          </li>
          <li>
            <strong>Per-chain reality where it matters</strong> &mdash; claims,
            liquidity, market cap, and contract operations still stay on the
            deployment where they actually live.
          </li>
          <li>
            <strong>Clearer storytelling</strong> &mdash; the project can be
            understood as one thing even when it expresses itself through
            multiple on-chain artifacts.
          </li>
        </ul>
        <p>
          Jungle Bay is the first clean example of this. The bungalow can now
          hold both <strong>JBM</strong> and <strong>JBAC</strong> as sibling
          assets inside the same project.
        </p>
        <p>
          Each project can now have one stable public path, while old chain
          routes resolve into that same bungalow instead of fragmenting the
          identity across multiple URLs.
        </p>
      </article>

      <article className={styles.card}>
        <h2 className={styles.heading}>Why Heat Exists</h2>
        <p>
          Heat is the Island&apos;s quiet recognition layer. It exists to
          measure sustained alignment without reducing that alignment to a
          leaderboard. Your <strong>island heat</strong> is the sum of the heat
          you have built across the bungalows where you have stayed present.
        </p>
        <p>
          The intent is not to create pressure or urgency. The intent is to make
          continuity legible, and then use that continuity to quietly unlock
          opportunity for the people who keep showing up.
        </p>
        <p>
          That continuity can now follow the same person across linked wallets,
          so cold storage and secondary holding addresses do not have to split
          your heat profile apart.
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
        <h2 className={styles.heading}>Phase 1</h2>
        <p>
          Phase 1 is about making the Island feel real. The goal is not growth
          hacking or feature completeness. The goal is to establish ground: seed
          the first twelve home-team bungalows, make heat legible, and prove
          that a quieter on-chain place can still feel alive. The new
          project-asset-deployment structure is part of that same work: the
          Island now models projects the way they actually exist.
        </p>
      </article>
    </section>
  );
}
