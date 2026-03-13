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
        <h2 className={styles.heading}>The Current Onchain Model</h2>
        <p>
          Jungle Bay Island now runs on four contracts with one clear graph.
          <strong> IslandIdentity</strong> is the root of personhood, linked
          wallets, bungalow heat, and daily JBM eligibility.{" "}
          <strong>JungleBayIsland</strong> is the bungalow NFT registry and the
          canonical resolver from any linked asset into the same place.
          <strong> Bodega</strong> lists and installs items into bungalows, and
          the first successful install activates the permanent JBM bond.
          <strong> CommissionManager</strong> turns a bungalow plus a budget
          into a full onchain creative workflow.
        </p>
        <p>
          The blockchain is the durable write layer. The backend exists to sign
          only the small set of actions the contracts require, confirm
          receipts, index events, and serve the fast read model the UI needs.
        </p>
      </article>

      <article className={styles.card}>
        <h2 className={styles.heading}>The New Front Door</h2>
        <p>
          The Island now opens through a server-guided landing shell instead of
          dropping everyone straight into the same interface. The backend makes
          the first routing decision from the request itself: mobile or
          desktop, logged in or not, and whether the user should be entering
          the island, their profile, or the market loops next.
        </p>
        <p>
          X is the beginning of the relationship. That handle anchors the user
          account, then wallets are linked under it, and then the contract
          becomes the durable record for bungalow, bodega, claim, and
          commission state.
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
            the background. Heat accumulates quietly and unlocks publishing,
            construction, and stewardship access without turning into a public
            contest.
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
            <strong>A project qualifies for territory</strong> &mdash; a new
            bungalow can open through one high-heat builder, five mid-heat
            supporters backing the same CA, or the JBAC shortcut. That now
            happens as a Memetics onchain petition flow instead of a separate
            construction-fee transfer.
          </li>
          <li>
            <strong>Payment can replace formal qualification</strong> &mdash;
            if a user does not meet the construction thresholds, the backend
            can quote a USDC amount at 0.1% of token market cap, verify the
            payment transaction, and use the contract owner path to create the
            bungalow onchain for that user&apos;s linked profile.
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
            publish portable art and builds as onchain listings, install them
            into bungalows through the same contract, and still use paid local
            wall placements for room-specific additions that do not become
            portable listings.
          </li>
          <li>
            <strong>Commissions turn intent into work</strong> &mdash; a
            bungalow can now anchor a paid creative brief, artists can apply to
            it, one artist can be approved, and the actual payment still clears
            through onchain escrow when the work is delivered.
          </li>
        </ol>
      </article>

      <article className={styles.card}>
        <h2 className={styles.heading}>Community Property</h2>
        <p>
          A bungalow is no longer framed as a user-owned destination. It is a
          community place for the project itself. People can help open it, add
          to it, and build on it through heat-gated access, but the public
          experience should feel universal rather than owner-gated.
        </p>
        <p>
          If curation authority exists, it now leans toward stewardship and
          emergency moderation instead of private control. Low-quality items are
          expected to lose visibility as stronger items get installed more
          often; obvious abuse still needs an internal kill switch.
        </p>
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
        <h2 className={styles.heading}>Identity And Wallet Ownership</h2>
        <p>
          The Island now has two aligned identity layers on purpose. Your app
          session now starts from an X login, and contract-native actions route
          through a Memetics onchain profile that starts from that same handle
          and can hold multiple linked wallets.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Session identity</strong> &mdash; authenticated frontend
            flows anchor to your X-backed account, not to whichever wallet is
            active in the moment.
          </li>
          <li>
            <strong>Onchain identity</strong> &mdash; write actions on Base now
            require a Memetics profile, and only wallets explicitly linked to
            that onchain profile can sign those contract calls.
          </li>
          <li>
            <strong>Handles are X-based</strong> &mdash; X is now the only
            login path, and that verified handle becomes the readable entry
            point for the onchain profile.
          </li>
          <li>
            <strong>Main wallet is explicit</strong> &mdash; users can choose
            which linked onchain wallet receives commission payouts and seller
            proceeds.
          </li>
          <li>
            <strong>No silent imports</strong> &mdash; Farcaster/Neynar wallet
            auto-enrichment is removed so profile ownership stays user-controlled.
          </li>
        </ul>
      </article>

      <article className={styles.card}>
        <h2 className={styles.heading}>Commissions As Cultural Production</h2>
        <p>
          The Island is not only a place to display artifacts after they exist.
          It now also supports the act of commissioning them into existence.
          That matters because scenes do not just need storage; they need a way
          to route taste, intention, and compensation toward people who can make
          the next image, poster, loop, or visual language for a community.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Requesters define the brief</strong> &mdash; a commission
            now names the bungalow it serves, the format of work being asked
            for, the prompt, the delivery deadline, and the JBM budget.
          </li>
          <li>
            <strong>Artist selection now lives onchain</strong> &mdash;
            artists apply against the commission itself, the requester selects
            one application onchain, and only that selected artist can accept
            the job and carry it forward.
          </li>
          <li>
            <strong>Money still lives onchain</strong> &mdash; once the
            commission is opened, the budget is locked in CommissionManager
            escrow and the payout only resolves through the contract&apos;s
            settlement path.
          </li>
          <li>
            <strong>The bungalow stays central</strong> &mdash; the work is not
            commissioned in the abstract. It belongs to a place, a community,
            and a visual context on the island.
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
          hacking or feature completeness. The goal is to establish ground:
          start with seeded bungalows, make heat legible, then let new projects
          earn their way onto the island through the community qualification
          paths. The new project-asset-deployment structure is part of that
          same work: the Island now models projects the way they actually
          exist.
        </p>
      </article>
    </section>
  );
}
