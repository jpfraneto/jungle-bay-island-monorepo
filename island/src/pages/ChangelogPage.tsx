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
          <span className={styles.date}>March 9, 2026</span>
          <h2 className={styles.heading}>Map Entry, Reward Signing, and Build Submission Were Simplified</h2>
        </div>
        <p>
          Several last-mile UX flows were tightened so the island reads more
          clearly and asks less from people right before ship.
        </p>
        <ul className={styles.list}>
          <li>
            Entering a bungalow now happens directly from that bungalow&apos;s
            floating marker on the island map, without a separate bottom-corner
            selection card.
          </li>
          <li>
            Room entry now shows only the entering transition, bungalow wall
            layouts now open up across all walls, and old saved rooms inherit
            the expanded placement grid automatically.
          </li>
          <li>
            Bungalow interiors now use an octagonal room, the project identity
            lives on the floor as a rug instead of a floating card, and a new
            zoomable community wall mixes writing with visit, art, and build
            activity for that bungalow.
          </li>
          <li>
            Bungalow entry now stays in one progress-driven loading state, room
            pieces place into an auto-arranged collage instead of a fragile
            fixed slot count, and the in-room presentation was enlarged and
            cleaned up so the bungalow reads more like a shippable space.
          </li>
          <li>
            Daily island rewards no longer recalculate when the signing wallet
            changes, already-claimed states hide redundant wallet controls, and
            claim buttons now name the exact wallet being used.
          </li>
          <li>
            Bodega miniapp submission was simplified into a Build flow: paste a
            link, let the app pull the preview metadata, and surface missing
            page tags when the destination is not set up cleanly yet.
          </li>
          <li>
            New bungalow qualification now reads the viewer&apos;s linked-wallet
            heat and JBAC shortcut balance more reliably, and project-wide
            favicon/share metadata now present the island identity more clearly.
          </li>
          <li>
            Privy-authenticated bungalow actions now resolve against the
            user&apos;s linked-wallet identity more consistently, paid Bodega
            installs can recover cleanly after a placement retry, and the old
            direct slot editor was removed so bungalow additions come only from
            the Bodega flow.
          </li>
          <li>
            Mobile signing now only offers wallets that are both linked to the
            user and currently connected in Privy on that device, and claimed
            reward totals stay aligned with the actual signed payout instead of
            jumping to a misleading identity-wide total after confirmation.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 6, 2026</span>
          <h2 className={styles.heading}>Bodega Placement Now Chooses The Room Spot Before Payment</h2>
        </div>
        <p>
          The full-Bodega install flow now sends people into the destination
          bungalow to pick the exact placement before any wallet transaction is
          requested.
        </p>
        <ul className={styles.list}>
          <li>
            Global Bodega install modals now act as bungalow pickers, then open
            the chosen room with the selected item already armed for placement.
          </li>
          <li>
            Room art now shows who placed it and when, using a connected
            username when one is available for that wallet.
          </li>
          <li>
            In-room project cards now sit behind action modals instead of
            floating above them, and island bungalow huts were enlarged to read
            more clearly on the map.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 6, 2026</span>
          <h2 className={styles.heading}>Bungalow Installs Now Persist Correctly After Refresh</h2>
        </div>
        <p>
          Installed Bodega items no longer disappear from a bungalow just
          because the room was reloaded.
        </p>
        <ul className={styles.list}>
          <li>
            Saved bungalow scene state is now parsed correctly when the room is
            fetched again, so existing installs render after refresh instead of
            falling back to an empty default scene.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 6, 2026</span>
          <h2 className={styles.heading}>In-Room Bodega Placement Now Speaks Plainly and Guides Art Into Visible Spots</h2>
        </div>
        <p>
          The inside-bungalow install flow now stays readable while work is in
          progress and points each Bodega item toward the kinds of room spots
          where it can actually be seen.
        </p>
        <ul className={styles.list}>
          <li>
            The payment button now stays in a processing state until the full
            install-and-place sequence finishes instead of surfacing retry copy
            mid-flight.
          </li>
          <li>
            Bodega art now highlights only compatible open room spots, so wall
            pieces land on visible wall placements instead of disappearing into
            mismatched anchors.
          </li>
          <li>
            Room guidance now uses plain placement language instead of the
            internal &quot;curation anchor&quot; vocabulary.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 6, 2026</span>
          <h2 className={styles.heading}>Island Map Now Shows The Full Bungalow Registry</h2>
        </div>
        <p>
          The main island no longer hides bungalow records just because they
          have not been marked claimed yet.
        </p>
        <ul className={styles.list}>
          <li>
            The map and sidebar now load from the full bungalow registry
            instead of the narrower claimed-or-owned subset.
          </li>
          <li>
            Canonical project grouping still stays intact, so multi-chain
            deployments resolve into one shared bungalow when they belong to
            the same project.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 6, 2026</span>
          <h2 className={styles.heading}>Inside-Bungalow Bodega Installs Now Stay In-Room From Selection to Payment</h2>
        </div>
        <p>
          Installing from the Bodega inside a bungalow no longer throws people
          out to a separate listing page before they can finish the job.
        </p>
        <ul className={styles.list}>
          <li>
            Opening the Bodega from inside a bungalow now starts a placement
            composer for that exact room instead of navigating to a standalone
            listing route.
          </li>
          <li>
            Selecting a Bodega item now keeps the user in the interior, lets
            them click an available room anchor, and opens payment directly for
            that placement target.
          </li>
          <li>
            Payment, install recording, and scene placement now happen as one
            continuous in-room flow so the item appears in the bungalow without
            a context-breaking page jump.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 6, 2026</span>
          <h2 className={styles.heading}>Island World Now Uses Living Topography, Viewport HUDs, and Branded Project Homes</h2>
        </div>
        <p>
          The island map and bungalow interiors were rebuilt to feel more like
          inhabited places instead of raw scene demos.
        </p>
        <ul className={styles.list}>
          <li>
            The main island now grows terrain around active bungalow plots,
            includes lagoon and ocean water, and keeps the primary actions in a
            viewport HUD instead of floating off-screen in world space.
          </li>
          <li>
            Bungalow markers now render as image-driven overlay buttons so each
            project home is legible from fresh eyes before anyone clicks in.
          </li>
          <li>
            Interior rooms now use a larger framed pavilion layout with project
            identity built into the space, tighter camera bounds, and clearer
            bungalow-targeted curation actions.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 5, 2026</span>
          <h2 className={styles.heading}>3D Island World, 3D Bungalow Rooms, and Direct Deep-Link Entry</h2>
        </div>
        <p>
          Jungle Bay Island now opens as a navigable 3D world, and bungalow
          pages now render as interactive 3D interiors instead of flat wall
          lists.
        </p>
        <ul className={styles.list}>
          <li>
            The home map is now a cinematic 3D island with tap-friendly huts,
            camera fly-ins, and direct entry into each bungalow.
          </li>
          <li>
            Bungalow interiors now load as 3D rooms with owner-editable slots
            for frames, portals, links, furniture, and decorations.
          </li>
          <li>
            Legacy <code>/:chain/:ca</code> links now resolve to the canonical
            bungalow slug before entering the room, so old social links and QR
            codes still land in the right place.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 5, 2026</span>
          <h2 className={styles.heading}>Community Bungalows, Quick Add, and Install-Weighted Walls</h2>
        </div>
        <p>
          The island now treats bungalows as community property with
          qualification-based opening, while Bodega and inside-bungalow adding
          are now one shared inventory system with different UX friction.
        </p>
        <ul className={styles.list}>
          <li>
            New bungalow opening now follows explicit thresholds: one high-heat
            builder, five mid-heat supporters backing the same CA, or the 10+
            JBAC shortcut, plus a construction fee in JBM.
          </li>
          <li>
            <strong>Quick Add</strong> inside a bungalow now publishes live to
            the Bodega immediately and installs the item in the same move
            instead of writing to a separate wall-only system.
          </li>
          <li>
            Bodega publishing now enforces a minimum island heat threshold and
            listings are ordered toward installs/sales first instead of pure
            recency.
          </li>
          <li>
            Bungalow walls now merge live Bodega installs and legacy wall items
            into one ranked community feed so better-selling items naturally
            rise and weaker ones sink.
          </li>
          <li>
            Home-team presentation is now driven by the community bungalow set
            on the island rather than a fixed whitelist flag.
          </li>
          <li>
            Emergency moderation paths were added for Bodega listings and legacy
            bungalow items without making owner removal the default model.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 5, 2026</span>
          <h2 className={styles.heading}>Bodega Install Flow Now Opens Exact Highlighted Bungalow Items</h2>
        </div>
        <p>
          Installing from the Bodega now uses the full island bungalow directory
          and opens the destination bungalow with the newly installed item
          highlighted by install transaction hash.
        </p>
        <ul className={styles.list}>
          <li>
            Install target picker now loads the full bungalow directory instead
            of wallet-scoped subsets.
          </li>
          <li>
            Post-install navigation now includes <code>install_tx</code> and
            chain query params so the right bungalow deployment opens
            immediately.
          </li>
          <li>
            Bungalow pages now scroll to and highlight the matching installed
            Bodega card using that install transaction hash.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 5, 2026</span>
          <h2 className={styles.heading}>Bodega Listings Now Have Shareable URLs</h2>
        </div>
        <p>
          Every published Bodega item can now be opened with a direct listing
          URL based on its publish transaction hash.
        </p>
        <ul className={styles.list}>
          <li>
            New listing route: <code>/bodega/:tx_hash</code> renders one catalog
            item by its publish transaction hash.
          </li>
          <li>
            Publishing success flow now includes a <strong>Share</strong> action
            that copies the listing link.
          </li>
          <li>
            Direct listing pages include share + install actions so creators can
            distribute links and users can install from that same page.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 5, 2026</span>
          <h2 className={styles.heading}>External Wallet Picker Expanded: MetaMask, Rainbow, Phantom</h2>
        </div>
        <p>
          Wallet linking now opens a wallet-picker flow that supports both
          Ethereum and Solana external connectors, then syncs linked wallets back
          into Island profile storage.
        </p>
        <ul className={styles.list}>
          <li>
            Add Wallet now supports explicit connector selection (MetaMask,
            Rainbow, Phantom, Coinbase, and other configured external wallets).
          </li>
          <li>
            Linked wallets are now synced from Privy linked accounts into
            Island&apos;s <code>user_wallets</code> table, including Solana addresses.
          </li>
          <li>
            Embedded Privy wallets are excluded from profile wallet sync so
            transaction-capable wallet lists stay external-wallet only.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 5, 2026</span>
          <h2 className={styles.heading}>Identity Refactor: Privy User IDs + Explicit SIWE Wallet Linking</h2>
        </div>
        <p>
          Authentication, handle ownership, and transaction wallets now follow one
          strict model: identity is your Privy account, and transaction wallets
          must be explicitly linked with SIWE.
        </p>
        <ul className={styles.list}>
          <li>
            Wallet auto-discovery from Farcaster/Neynar was removed. The Island
            now only uses wallets users explicitly signed to link.
          </li>
          <li>
            Wallet linking now runs as a mobile-safe sequential SIWE flow and
            supports unlimited linked wallets under one profile.
          </li>
          <li>
            Claim signing/confirmation now enforces strict ownership checks: if
            a payout wallet is not linked to the authenticated profile, the
            request is rejected.
          </li>
          <li>
            Email users can claim handles by linking X, while duplicate X
            account links are blocked and logged for manual resolution.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 5, 2026</span>
          <h2 className={styles.heading}>Rewards Claimed State + Mobile Bodega Tightening</h2>
        </div>
        <p>
          Claim UX now reflects completed daily claims clearly, and Bodega mobile
          flows were tightened to use less vertical space with cleaner actions.
        </p>
        <ul className={styles.list}>
          <li>
            Rewards inbox now shows <strong>already claimed today</strong> copy
            with the claimed JBM total and a live countdown until the next claim window.
          </li>
          <li>
            The navbar rewards badge now switches from a yellow count to a green
            check mark after today&apos;s claim succeeds.
          </li>
          <li>
            Rewards modal loading now avoids stale totals so the claim button
            and per-bungalow breakdown load in sync.
          </li>
          <li>
            Bodega submit/install controls now prevent mobile input zoom by using
            16px form controls on small screens.
          </li>
          <li>
            Bodega list cards and submit modal spacing were flattened, and submit
            actions now use a compact left-arrow back control plus a larger right-side continue/submit button.
          </li>
        </ul>
      </article>

      <article className={styles.entry}>
        <div className={styles.entryHeader}>
          <span className={styles.date}>March 5, 2026</span>
          <h2 className={styles.heading}>Claims Migrated To One-Tx Period Totals (V8)</h2>
        </div>
        <p>
          Daily rewards now sign and settle as one period-total claim instead of
          one signature per bungalow.
        </p>
        <ul className={styles.list}>
          <li>
            Backend claim signing now targets the new contract at{" "}
            <code>0x784c6438e72b2a2f3977af8d0ba30b30f78f7a10</code> using
            <code> claimPeriodTotal</code>.
          </li>
          <li>
            The rewards inbox now submits one claim transaction per day for the
            wallet’s full eligible total.
          </li>
          <li>
            Claim confirmation now checks period-level onchain status and
            finalizes all allocations for that identity in the same period.
          </li>
          <li>
            This removes nonce drift and per-bungalow signature mismatch cases
            that were triggering <code>invalid signature</code> claim reverts.
          </li>
        </ul>
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
