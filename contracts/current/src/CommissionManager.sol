// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║                    COMMISSION MANAGER                             ║
 * ║                    Jungle Bay Island                               ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 *
 * This is where culture gets commissioned.
 *
 * A requester walks into the Bodega with a prompt, a bungalow, a budget,
 * and a deadline. They're asking the island's artists to make something
 * that doesn't exist yet. Any profile with a claimed handle can apply.
 * The requester has 24 hours to choose one.
 *
 * When they choose an artist, the USDC locks. The artist goes to work.
 * When the artist submits, the requester has a window to approve or reject.
 * If they approve, USDC settles, the piece becomes a Bodega item — free
 * and infinite — and the artist earns a reputation point.
 * If they reject, the USDC returns, and the non-acceptance gets recorded.
 *
 * Bayla — the island's AI muse — has a wallet and a profile like any other
 * artist. She can apply to commissions. She can be selected. She can submit.
 * The contract does not know she is an AI. The island treats her as a peer.
 *
 * REPUTATION:
 * On-chain. Permanent. Non-transferable. Earns +1 per approved commission.
 * The admin can attach a hardcore warning flag to any profile that has
 * acted in bad faith. Not a freeze — a scarlet letter. Visible to all
 * before they engage.
 *
 * NON-PAYMENT TRACKING:
 * If a requester rejects a submitted piece, that rejection increments their
 * non-acceptance counter on-chain. Artists can read this before applying.
 * The island does not forget.
 *
 * REVENUE SPLIT on commissions:
 *   8%  → PLATFORM_RECIPIENT
 *   92% → artist's main wallet
 *
 * ARCHITECTURE:
 * Reads IslandIdentity for all profile auth.
 * Reads JungleBayIsland to verify bungalow existence.
 * Calls Bodega.listCommissionedItem() on settlement.
 * Deploy after all three others.
 */

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IIslandIdentity {
    function walletProfileId(address wallet) external view returns (uint256);
    function isWalletLinkedToProfile(uint256 profileId, address wallet) external view returns (bool);
    function getMainWallet(uint256 profileId) external view returns (address);
    function profileExists(uint256 profileId) external view returns (bool);
}

interface IJungleBayIsland {
    function bungalowExists(uint256 tokenId) external view returns (bool);
}

interface IBodega {
    function listCommissionedItem(uint256 artistProfileId, string calldata ipfsURI)
        external returns (uint256 itemId);
}

contract CommissionManager is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────

    address public constant PLATFORM_RECIPIENT = 0xed21735DC192dC4eeAFd71b4Dc023bC53fE4DF15;

    uint256 internal constant PLATFORM_BPS = 800;
    uint256 internal constant BPS_DENOM    = 10_000;

    /// @notice Requester has this long to select an artist after publishing.
    uint256 internal constant SELECTION_WINDOW = 24 hours;

    /// @notice After submission, requester has this long to approve or reject.
    ///         After this window, the artist can claim the payout themselves.
    uint256 internal constant REVIEW_WINDOW = 3 days;

    uint256 internal constant MAX_URI_LENGTH = 512;

    // ─────────────────────────────────────────────────────────────
    // Enums
    // ─────────────────────────────────────────────────────────────

    enum CommissionStatus {
        OPEN,        // accepting applications
        SELECTED,    // artist chosen, USDC locked, work in progress
        SUBMITTED,   // artist submitted deliverable, awaiting approval
        APPROVED,    // requester approved, USDC settled, item listed
        REJECTED,    // requester rejected, USDC returned
        EXPIRED,     // selection window passed with no selection, cancelled
        TIMED_OUT,   // artist claimed after review window elapsed
        DEADLINE_MISSED // requester reclaimed locked USDC after artist missed submission deadline
    }

    // ─────────────────────────────────────────────────────────────
    // Structs
    // ─────────────────────────────────────────────────────────────

    struct Commission {
        uint256 id;
        uint256 requesterProfileId;
        uint256 bungalowId;
        string  promptURI;           // IPFS hash of the prompt + references
        uint256 budget;              // max USDC the requester is willing to pay
        uint64  deadline;            // artist must submit before this
        uint64  publishedAt;         // when the commission was posted
        uint64  selectedAt;          // when an artist was selected
        uint64  submittedAt;         // when the deliverable was submitted
        uint256 selectedArtistProfileId;
        uint256 agreedPrice;         // the price the selected artist proposed
        string  deliverableURI;      // IPFS hash of the final piece
        CommissionStatus status;
    }

    struct Application {
        uint256 id;
        uint256 commissionId;
        uint256 artistProfileId;
        string  pitchURI;            // IPFS hash of the artist's pitch
        uint256 proposedPrice;       // artist's ask, must be <= budget
        uint64  appliedAt;
        bool    active;
    }

    // ─────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────

    error InvalidAddress();
    error InvalidAmount();
    error InvalidStringLength();
    error InvalidTimeline();
    error InvalidState();
    error Unauthorized();
    error ProfileRequired();
    error BungalowNotFound();
    error CommissionNotFound();
    error ApplicationNotFound();
    error DuplicateApplication();
    error SelectionWindowClosed();
    error SelectionWindowOpen();
    error PriceExceedsBudget();
    error SubmissionWindowOpen();
    error ReviewWindowActive();
    error ReviewWindowExpired();
    error NotSelectedArtist();

    // ─────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────

    IERC20           public immutable usdc;
    IIslandIdentity  public immutable identity;
    IJungleBayIsland public immutable island;
    IBodega          public immutable bodega;

    uint256 public commissionCount;
    uint256 public applicationCount;

    mapping(uint256 => Commission)  public commissions;
    mapping(uint256 => Application) public applications;

    // commissionId => applicationId[]
    mapping(uint256 => uint256[]) private _commissionApplications;

    // commissionId => artistProfileId => applicationId (0 if none)
    mapping(uint256 => mapping(uint256 => uint256)) public artistApplicationId;

    // ─── Reputation ───────────────────────────────────────────────

    /// @notice Earned +1 per approved commission. Permanent. Non-transferable.
    ///         This is your body of work on the island.
    mapping(uint256 => uint256) public artistReputation;

    /// @notice How many times this requester rejected a submitted piece.
    ///         Artists read this before applying. The island does not forget.
    mapping(uint256 => uint256) public requesterRejections;

    /// @notice Admin-set warning. Not a freeze — a visible signal of bad faith.
    ///         Can be set and cleared by the owner.
    mapping(uint256 => bool) public hardcoreWarning;

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    event CommissionPublished(
        uint256 indexed commissionId,
        uint256 indexed requesterProfileId,
        uint256 indexed bungalowId,
        uint256 budget,
        uint64  deadline,
        string  promptURI
    );
    event ApplicationSubmitted(
        uint256 indexed applicationId,
        uint256 indexed commissionId,
        uint256 indexed artistProfileId,
        uint256 proposedPrice
    );
    event ArtistSelected(
        uint256 indexed commissionId,
        uint256 indexed applicationId,
        uint256 indexed artistProfileId,
        uint256 agreedPrice
    );
    event DeliverableSubmitted(
        uint256 indexed commissionId,
        uint256 indexed artistProfileId,
        string  deliverableURI
    );
    event CommissionApproved(
        uint256 indexed commissionId,
        uint256 indexed artistProfileId,
        uint256 artistPayout,
        uint256 itemId
    );
    event CommissionRejected(
        uint256 indexed commissionId,
        uint256 indexed requesterProfileId,
        uint256 requesterRejectionCount
    );
    event CommissionDeadlineMissed(
        uint256 indexed commissionId,
        uint256 indexed requesterProfileId,
        uint256 refundAmount
    );
    event CommissionExpired(uint256 indexed commissionId);
    event CommissionTimedOut(uint256 indexed commissionId, uint256 indexed artistProfileId);
    event ReputationEarned(uint256 indexed artistProfileId, uint256 totalReputation);
    event HardcoreWarningSet(uint256 indexed profileId, bool value);

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(
        address initialOwner,
        address usdc_,
        address identity_,
        address island_,
        address bodega_
    ) Ownable(initialOwner) {
        if (initialOwner == address(0) || usdc_ == address(0) || identity_ == address(0) ||
            island_ == address(0)       || bodega_ == address(0))
            revert InvalidAddress();

        usdc     = IERC20(usdc_);
        identity = IIslandIdentity(identity_);
        island   = IJungleBayIsland(island_);
        bodega   = IBodega(bodega_);
    }

    // ─────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /**
     * @notice Set or clear the hardcore warning on any profile.
     *         This is the admin's tool for signaling bad faith actors.
     *         The profile keeps working. Everyone can see the flag.
     */
    function setHardcoreWarning(uint256 profileId, bool value) external onlyOwner {
        if (!identity.profileExists(profileId)) revert ProfileRequired();
        hardcoreWarning[profileId] = value;
        emit HardcoreWarningSet(profileId, value);
    }

    // ─────────────────────────────────────────────────────────────
    // Commission lifecycle
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Publish a commission request to the island.
     *         No USDC locked yet — that happens when you select an artist.
     *
     *         The promptURI is an IPFS hash pointing to your prompt and any
     *         reference materials: images, links, descriptions, vibes.
     *         The budget is your ceiling. Artists will pitch at or below it.
     *
     * @param bungalowId  The bungalow this commission is for
     * @param promptURI   IPFS hash of prompt + references
     * @param budget      Max USDC you'll pay
     * @param deadline    When the artist must submit by (must be > 24h from now)
     */
    function publishCommission(
        uint256         bungalowId,
        string calldata promptURI,
        uint256         budget,
        uint64          deadline
    ) external whenNotPaused returns (uint256 commissionId) {
        uint256 profileId = _callerProfileId();
        _requireBoundedString(promptURI, 1, MAX_URI_LENGTH);

        if (!island.bungalowExists(bungalowId)) revert BungalowNotFound();
        if (budget == 0) revert InvalidAmount();

        // Deadline must be after the selection window closes
        if (deadline <= uint64(block.timestamp) + SELECTION_WINDOW) revert InvalidTimeline();

        commissionId = ++commissionCount;
        commissions[commissionId] = Commission({
            id:                       commissionId,
            requesterProfileId:       profileId,
            bungalowId:               bungalowId,
            promptURI:                promptURI,
            budget:                   budget,
            deadline:                 deadline,
            publishedAt:              uint64(block.timestamp),
            selectedAt:               0,
            submittedAt:              0,
            selectedArtistProfileId:  0,
            agreedPrice:              0,
            deliverableURI:           "",
            status:                   CommissionStatus.OPEN
        });

        emit CommissionPublished(commissionId, profileId, bungalowId, budget, deadline, promptURI);
    }

    /**
     * @notice Apply to a commission. Open to any profile with a claimed handle.
     *         Your pitch is an IPFS hash. Your price must be at or below the budget.
     *         You can only apply once per commission.
     *
     *         Bayla can apply here. The contract does not know she is an AI.
     */
    function applyToCommission(
        uint256         commissionId,
        string calldata pitchURI,
        uint256         proposedPrice
    ) external whenNotPaused returns (uint256 applicationId) {
        Commission storage c = _requireCommission(commissionId);
        if (c.status != CommissionStatus.OPEN) revert InvalidState();
        if (block.timestamp > c.publishedAt + SELECTION_WINDOW) revert SelectionWindowClosed();
        if (block.timestamp > c.deadline) revert InvalidTimeline();

        uint256 profileId = _callerProfileId();
        if (profileId == c.requesterProfileId) revert Unauthorized();
        if (artistApplicationId[commissionId][profileId] != 0) revert DuplicateApplication();
        if (proposedPrice > c.budget) revert PriceExceedsBudget();

        _requireBoundedString(pitchURI, 1, MAX_URI_LENGTH);

        applicationId = ++applicationCount;
        applications[applicationId] = Application({
            id:              applicationId,
            commissionId:    commissionId,
            artistProfileId: profileId,
            pitchURI:        pitchURI,
            proposedPrice:   proposedPrice,
            appliedAt:       uint64(block.timestamp),
            active:          true
        });

        _commissionApplications[commissionId].push(applicationId);
        artistApplicationId[commissionId][profileId] = applicationId;

        emit ApplicationSubmitted(applicationId, commissionId, profileId, proposedPrice);
    }

    /**
     * @notice Select an artist. This locks the USDC.
     *         Must be called within 24 hours of publishing.
     *         After selection, the artist has until the deadline to submit.
     */
    function selectArtist(uint256 commissionId, uint256 applicationId)
        external whenNotPaused nonReentrant
    {
        Commission storage c = _requireCommission(commissionId);
        if (c.status != CommissionStatus.OPEN) revert InvalidState();
        if (!identity.isWalletLinkedToProfile(c.requesterProfileId, msg.sender)) revert Unauthorized();

        // Selection window: first 24h after publishing
        if (block.timestamp > c.publishedAt + SELECTION_WINDOW) revert SelectionWindowClosed();

        Application storage a = _requireApplication(applicationId);
        if (a.commissionId != commissionId) revert ApplicationNotFound();
        if (!a.active) revert InvalidState();

        // Lock the agreed USDC from the requester
        usdc.safeTransferFrom(msg.sender, address(this), a.proposedPrice);

        c.status                    = CommissionStatus.SELECTED;
        c.selectedArtistProfileId   = a.artistProfileId;
        c.agreedPrice               = a.proposedPrice;
        c.selectedAt                = uint64(block.timestamp);

        emit ArtistSelected(commissionId, applicationId, a.artistProfileId, a.proposedPrice);
    }

    /**
     * @notice Artist submits the deliverable. An IPFS hash — the piece itself.
     *         Must be submitted before the deadline.
     *         The requester now has REVIEW_WINDOW to approve or reject.
     */
    function submitDeliverable(uint256 commissionId, string calldata deliverableURI)
        external whenNotPaused
    {
        Commission storage c = _requireCommission(commissionId);
        if (c.status != CommissionStatus.SELECTED) revert InvalidState();
        if (block.timestamp > c.deadline) revert InvalidTimeline();
        if (!identity.isWalletLinkedToProfile(c.selectedArtistProfileId, msg.sender)) revert NotSelectedArtist();

        _requireBoundedString(deliverableURI, 1, MAX_URI_LENGTH);

        c.deliverableURI = deliverableURI;
        c.submittedAt    = uint64(block.timestamp);
        c.status         = CommissionStatus.SUBMITTED;

        emit DeliverableSubmitted(commissionId, c.selectedArtistProfileId, deliverableURI);
    }

    /**
     * @notice Requester approves the piece.
     *
     *         What happens:
     *         1. USDC settles: 8% to platform, 92% to artist
     *         2. The deliverable is listed in the Bodega as a free, infinite item
     *         3. Artist earns +1 reputation
     *         4. The piece belongs to the island forever
     */
    function approveCommission(uint256 commissionId)
        external whenNotPaused nonReentrant
    {
        Commission storage c = _requireCommission(commissionId);
        if (c.status != CommissionStatus.SUBMITTED) revert InvalidState();
        if (!identity.isWalletLinkedToProfile(c.requesterProfileId, msg.sender)) revert Unauthorized();
        if (block.timestamp >= uint256(c.submittedAt) + REVIEW_WINDOW) revert ReviewWindowExpired();

        c.status = CommissionStatus.APPROVED;
        _settle(commissionId, c);
    }

    /**
     * @notice Requester rejects the piece. USDC returns.
     *         The rejection is recorded permanently on the requester's profile.
     *         Future artists will see this count before they apply.
     */
    function rejectCommission(uint256 commissionId)
        external whenNotPaused nonReentrant
    {
        Commission storage c = _requireCommission(commissionId);
        if (c.status != CommissionStatus.SUBMITTED) revert InvalidState();
        if (!identity.isWalletLinkedToProfile(c.requesterProfileId, msg.sender)) revert Unauthorized();
        if (block.timestamp >= uint256(c.submittedAt) + REVIEW_WINDOW) revert ReviewWindowExpired();

        c.status = CommissionStatus.REJECTED;

        // Return USDC to the requester's calling wallet
        usdc.safeTransfer(msg.sender, c.agreedPrice);

        // Record the rejection. The island does not forget.
        uint256 rejCount = ++requesterRejections[c.requesterProfileId];

        emit CommissionRejected(commissionId, c.requesterProfileId, rejCount);
    }

    /**
     * @notice If the selected artist misses the submission deadline entirely,
     *         the requester can reclaim the locked USDC.
     *
     *         Boundary is explicit:
     *         - Artist may still submit while block.timestamp <= deadline
     *         - Requester may reclaim only once block.timestamp > deadline
     */
    function claimMissedDeadlineRefund(uint256 commissionId)
        external whenNotPaused nonReentrant
    {
        Commission storage c = _requireCommission(commissionId);
        if (c.status != CommissionStatus.SELECTED) revert InvalidState();
        if (block.timestamp <= c.deadline) revert SubmissionWindowOpen();
        if (!identity.isWalletLinkedToProfile(c.requesterProfileId, msg.sender)) revert Unauthorized();

        c.status = CommissionStatus.DEADLINE_MISSED;
        usdc.safeTransfer(msg.sender, c.agreedPrice);

        emit CommissionDeadlineMissed(commissionId, c.requesterProfileId, c.agreedPrice);
    }

    /**
     * @notice If the requester doesn't act within REVIEW_WINDOW after submission,
     *         the artist can claim their payout. Trust the work. Move on.
     */
    function claimTimedOutPayout(uint256 commissionId)
        external whenNotPaused nonReentrant
    {
        Commission storage c = _requireCommission(commissionId);
        if (c.status != CommissionStatus.SUBMITTED) revert InvalidState();
        if (block.timestamp < uint256(c.submittedAt) + REVIEW_WINDOW) revert ReviewWindowActive();
        if (!identity.isWalletLinkedToProfile(c.selectedArtistProfileId, msg.sender)) revert NotSelectedArtist();

        c.status = CommissionStatus.TIMED_OUT;
        _settle(commissionId, c);

        emit CommissionTimedOut(commissionId, c.selectedArtistProfileId);
    }

    /**
     * @notice If no artist was selected within the 24h selection window,
     *         the requester can cancel and close the commission.
     *         No USDC was ever locked, so nothing to refund.
     */
    function expireCommission(uint256 commissionId) external whenNotPaused {
        Commission storage c = _requireCommission(commissionId);
        if (c.status != CommissionStatus.OPEN) revert InvalidState();
        if (block.timestamp <= c.publishedAt + SELECTION_WINDOW) revert SelectionWindowOpen();
        if (!identity.isWalletLinkedToProfile(c.requesterProfileId, msg.sender)) revert Unauthorized();

        c.status = CommissionStatus.EXPIRED;
        emit CommissionExpired(commissionId);
    }

    // ─────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────

    function getCommissionApplications(uint256 commissionId)
        external view returns (uint256[] memory)
    {
        if (commissions[commissionId].id == 0) revert CommissionNotFound();
        return _commissionApplications[commissionId];
    }

    /**
     * @notice Full profile of an artist before you accept their application.
     *         Reputation + hardcore warning in one call.
     */
    function getArtistProfile(uint256 artistProfileId)
        external view
        returns (uint256 reputation, bool warning)
    {
        return (artistReputation[artistProfileId], hardcoreWarning[artistProfileId]);
    }

    /**
     * @notice Full trust profile of a requester before you apply.
     *         Rejection count + hardcore warning in one call.
     */
    function getRequesterProfile(uint256 requesterProfileId)
        external view
        returns (uint256 rejections, bool warning)
    {
        return (requesterRejections[requesterProfileId], hardcoreWarning[requesterProfileId]);
    }

    // ─────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────

    /**
     * @dev Settle a commission: pay the artist, list the item in the Bodega,
     *      award reputation. Called on approval and timeout.
     */
    function _settle(uint256 commissionId, Commission storage c) internal {
        uint256 price    = c.agreedPrice;
        uint256 platform = (price * PLATFORM_BPS) / BPS_DENOM;
        uint256 artist   = price - platform;

        address artistWallet = identity.getMainWallet(c.selectedArtistProfileId);
        if (artistWallet == address(0)) revert InvalidAddress();

        if (platform > 0) usdc.safeTransfer(PLATFORM_RECIPIENT, platform);
        if (artist   > 0) usdc.safeTransfer(artistWallet,       artist);

        // The deliverable becomes a free, infinite Bodega item
        uint256 itemId = bodega.listCommissionedItem(c.selectedArtistProfileId, c.deliverableURI);

        // Artist earns reputation
        uint256 rep = ++artistReputation[c.selectedArtistProfileId];

        emit CommissionApproved(commissionId, c.selectedArtistProfileId, artist, itemId);
        emit ReputationEarned(c.selectedArtistProfileId, rep);
    }

    function _callerProfileId() internal view returns (uint256 profileId) {
        profileId = identity.walletProfileId(msg.sender);
        if (profileId == 0) revert ProfileRequired();
    }

    function _requireCommission(uint256 id) internal view returns (Commission storage c) {
        c = commissions[id];
        if (c.id == 0) revert CommissionNotFound();
    }

    function _requireApplication(uint256 id) internal view returns (Application storage a) {
        a = applications[id];
        if (a.id == 0) revert ApplicationNotFound();
    }

    function _requireBoundedString(string memory s, uint256 minLen, uint256 maxLen) internal pure {
        uint256 len = bytes(s).length;
        if (len < minLen || len > maxLen) revert InvalidStringLength();
    }
}
