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
        <h2 className={styles.heading}>How It Works</h2>
        <ol className={styles.steps}>
          <li>
            <strong>A project gets territory</strong> &mdash; each supported
            token is anchored as a bungalow on the Island, with its own place,
            identity, and wall.
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
        </ol>
      </article>

      <article className={styles.card}>
        <h2 className={styles.heading}>Bungalows</h2>
        <p>
          A bungalow is not a listing. It is the project&apos;s territorial
          anchor on the Island. Inside each one, the product should feel more
          like visiting a location than checking a profile card.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>The Wall</strong> &mdash; a persistent public surface where
            the community can leave posts, images, links, and portals.
          </li>
          <li>
            <strong>Heat and holders</strong> &mdash; a read on who has stayed
            close to the project over time, without turning that into a carnival
            of engagement mechanics.
          </li>
          <li>
            <strong>Identity</strong> &mdash; a token address, a one-line
            presence, and a durable place in relation to the rest of the Island.
          </li>
          <li>
            <strong>Atmosphere</strong> &mdash; the Island is designed to feel
            alive through place, adjacency, and return, not through constant
            prompts.
          </li>
        </ul>
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
          that a quieter on-chain place can still feel alive.
        </p>
      </article>
    </section>
  );
}
