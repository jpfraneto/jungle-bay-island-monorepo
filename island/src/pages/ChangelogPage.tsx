import { useNavigate } from "react-router-dom";
import styles from "../styles/changelog-page.module.css";

export default function ChangelogPage() {
  const navigate = useNavigate();

  return (
    <section className={styles.page}>
      <article className={styles.hero}>
        <p className={styles.kicker}>Changelog</p>
        <h1 className={styles.title}>Recent Product Evolution</h1>
        <p className={styles.summary}>
          This page tracks the major structural, UX, and claim-system changes on
          Jungle Bay Island. It is meant to explain what changed, why it
          changed, and what the product now supports.
        </p>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 4, 2026</span>
          <h2 className={styles.heading}>Bodega Is Now Two-Lane: Art + Miniapps</h2>
        </div>
        <p>
          The Bodega publishing flow was simplified around two creator-facing
          listing lanes so builders can move faster with less UI noise.
        </p>
        <ul className={styles.list}>
          <li>
            Bodega submission now asks creators to pick only one of two types:
            <strong> Art</strong> or <strong>Miniapp</strong>.
          </li>
          <li>
            Art listings now support both standard image art and <strong>GLB</strong>{" "}
            3D assets (with a preview image URL plus a GLB file URL).
          </li>
          <li>
            Catalog filtering now follows the same two-lane model so browsing
            and publishing use one shared mental model.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 4, 2026</span>
          <h2 className={styles.heading}>Mobile Bodega Cleanup And Safer Wallet Flows</h2>
        </div>
        <p>
          The Bodega and profile flows were tightened up for smaller screens,
          cleaner wallet management, and less avoidable claim failure.
        </p>
        <ul className={styles.list}>
          <li>
            Bodega submit and install modals now keep scroll contained on the
            overlay instead of fighting the page behind them on mobile.
          </li>
          <li>
            Bodega listing filters now use a compact select control, and the
            listing rows were flattened so both the catalog and bungalow shelves
            use less vertical space.
          </li>
          <li>
            Decoration submission now uses one image URL instead of separate
            preview and external URL fields.
          </li>
          <li>
            Profile wallet linking now only uses connected-wallet signing, while
            Mining Zones moved out of the profile into its own drawer-linked page.
          </li>
          <li>
            Privy auth verification now accepts key rotation-safe validation
            paths so linking a second wallet no longer fails on strict token
            format drift.
          </li>
          <li>
            Reward claims now run a contract preflight check before opening the
            wallet, so obviously failing claim attempts are blocked earlier.
          </li>
          <li>
            Single claims now sign against the current onchain nonce instead of
            stale reserved nonce slots from earlier attempts, which fixes false
            invalid-signature failures after interrupted claim sessions.
          </li>
          <li>
            Claim payloads now include the signed contract address, and both
            single and batch claim submits use that exact address instead of a
            stale frontend env value, preventing signature-domain drift.
          </li>
          <li>
            Claim signing now runs a server-side contract preflight before
            returning signatures, so configuration mismatches surface as clear
            API errors instead of wallet-level reverts.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 3, 2026</span>
          <h2 className={styles.heading}>Bodega Submission Fees Are Now Server-Recorded</h2>
        </div>
        <p>
          Bodega publishing fees no longer rely on frontend-only state. The
          server now records the submission payment hash and fee amount with the
          listing itself.
        </p>
        <ul className={styles.list}>
          <li>
            Publishing a Bodega listing now sends the JBM transfer hash to the
            backend along with the submission payload.
          </li>
          <li>
            The backend rejects the wrong submission fee and blocks reuse of the
            same payment hash across different listings.
          </li>
          <li>
            If the first save succeeds and the client retries, the server can
            now return the existing listing for that paid submission.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 3, 2026</span>
          <h2 className={styles.heading}>Bodega Frontend And Identity Linking</h2>
        </div>
        <p>
          The Bodega is now a real part of the island interface. Builders can
          browse creator listings, submit new assets, and install marketplace
          items directly into bungalows.
        </p>
        <ul className={styles.list}>
          <li>
            The Bodega now has a live catalog view with filters, listing cards,
            and in-app install flow wired to JBM payments.
          </li>
          <li>
            Every bungalow page now has a direct Bodega entry point plus a
            separate shelf for marketplace items already installed there.
          </li>
          <li>
            Profile pages now expose linked-wallet management so heat and
            holdings can aggregate across cold wallets and secondary addresses.
          </li>
          <li>
            Mining Zones now appear as a visible teaser layer for future
            heat-gated earning loops.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 3, 2026</span>
          <h2 className={styles.heading}>Bodega Backend Foundation</h2>
        </div>
        <p>
          The Island now has the backend foundation for the Bodega, the creator
          marketplace layer that lets assets live as reusable listings instead
          of one-off bungalow wall entries.
        </p>
        <ul className={styles.list}>
          <li>
            Creator-made assets can now be stored as standalone catalog items
            with type-specific payloads, pricing, and source bungalow metadata.
          </li>
          <li>
            Installs are now tracked separately from catalog submissions so one
            asset can be installed into many bungalows.
          </li>
          <li>
            Creator rev-share credits now have a dedicated ledger path into the
            existing reward allocation system.
          </li>
          <li>
            Bonus heat events and signature-backed manual wallet links were
            added as supporting primitives for the next creator-economy loop.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 3, 2026</span>
          <h2 className={styles.heading}>Bungalows Are Now Project Umbrellas</h2>
        </div>
        <p>
          The product no longer treats every chain deployment as a separate
          bungalow by default. A bungalow now represents the project itself.
          Inside that project, the app can hold multiple official assets, and
          each asset can hold one or many chain-specific deployments.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Bungalow</strong> now means the project-level identity and
            shared territory.
          </li>
          <li>
            <strong>Asset</strong> now means an official thing inside that
            project, such as a fungible token or NFT collection.
          </li>
          <li>
            <strong>Deployment</strong> now means the chain-specific contract or
            mint for that asset.
          </li>
          <li>
            Chain routes like `/base/:ca`, `/ethereum/:ca`, and `/solana/:ca`
            can now resolve into the same bungalow when they belong to the same
            project.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 3, 2026</span>
          <h2 className={styles.heading}>Cross-Chain And Cross-Asset Grouping</h2>
        </div>
        <p>
          Manual canonical grouping is now in place for the first linked
          projects. This is curated on purpose so the app does not make bad
          guesses from symbols alone.
        </p>
        <ul className={styles.list}>
          <li>
            `BOBO`, `RIZZ`, and `TOWELI` now unify same-token deployments across
            multiple chains under one identity.
          </li>
          <li>
            <strong>Jungle Bay</strong> now acts as a real umbrella bungalow:
            `JBM` and `JBAC` are treated as sibling assets inside one project.
          </li>
          <li>
            The bungalow page now renders per-asset sections and per-chain
            deployment panels instead of flattening everything into one contract
            view.
          </li>
          <li>
            The wall is shared at the project level so related assets do not
            split their social memory.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 3, 2026</span>
          <h2 className={styles.heading}>Canonical URLs And DB-Backed Identity</h2>
        </div>
        <p>
          Bungalow identity is no longer trapped in a hardcoded file. The
          canonical graph now lives in database tables, seeded with the current
          project map and editable through authenticated admin endpoints.
        </p>
        <ul className={styles.list}>
          <li>
            Canonical project data now lives in `projects`, `assets`, and
            `deployments` records instead of a static-only code map.
          </li>
          <li>
            The app now supports canonical URLs at `/bungalow/:slug` and
            `/bungalow/:address`.
          </li>
          <li>
            Legacy routes like `/:chain/:ca` now hard-redirect in the browser to
            the canonical bungalow path.
          </li>
          <li>
            This keeps one stable public URL per bungalow while still allowing
            any linked deployment address to open the right place.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 3, 2026</span>
          <h2 className={styles.heading}>Claims And Reward Inbox</h2>
        </div>
        <p>
          The reward flow was rebuilt so claim state is only finalized after a
          successful on-chain receipt, which fixes false “already claimed” UI
          states after canceled wallet prompts.
        </p>
        <ul className={styles.list}>
          <li>
            Claim signing no longer marks rewards as claimed before the
            transaction lands.
          </li>
          <li>
            The frontend now confirms claims after the transaction is mined.
          </li>
          <li>
            The new rewards inbox in the top nav aggregates claimable rewards
            across the wallet’s eligible bungalows.
          </li>
          <li>
            The app tries atomic batch claims first and falls back to sequential
            claim transactions if the wallet connector rejects batching.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 3, 2026</span>
          <h2 className={styles.heading}>Mobile Layout And Scroll Fixes</h2>
        </div>
        <p>
          Several layout traps were removed so the app is usable on mobile
          again. Routed content, bungalows, profile pages, and the left sidebar
          now scroll correctly within the shell.
        </p>
        <ul className={styles.list}>
          <li>Content panes now own vertical scrolling instead of clipping it.</li>
          <li>
            Bungalow and address pages no longer trap content inside nested
            overflow containers.
          </li>
          <li>
            The sidebar has safe-area bottom spacing so the final items do not
            disappear under mobile browser chrome.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>Process Rule</span>
          <h2 className={styles.heading}>Major Changes Must Land Here</h2>
        </div>
        <p>
          From this point on, any major product, architecture, data-model, or
          claim-flow change should add a concise entry to this page. That keeps
          the product history legible for internal reviews and external context.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => navigate("/about")}
          >
            Return to About
          </button>
        </div>
      </article>
    </section>
  );
}
