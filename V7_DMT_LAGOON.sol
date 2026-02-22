// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════════════╗
 * ║                                                                                               ║
 * ║                                    JUNGLE BAY ISLAND V7                                       ║
 * ║                                                                                               ║
 * ║                    "Protocol-level infrastructure for the appcoin ecosystem."                 ║
 * ║                                                                                               ║
 * ║                                   Built for humans and agents.                                ║
 * ║                                                                                               ║
 * ║                                        Base Network                                           ║
 * ║                                                                                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════════════╝
 *
 * @title JungleBayIslandV7
 * @author Jungle Bay Island
 * @notice Permissionless bungalow registry with open claiming, admin buyout priority,
 *         DMT Lagoon community treasury, 12 prime spot auctions with defaults,
 *         and AI-assisted content updates via Bayla signatures.
 *         Registry + community treasury + prime spot auctions.
 *
 * @dev Key changes from V6: Daimo Pay integration for off-chain payments,
 *      distributeLagoonRewards for heat-gated community rewards, emergency withdraw
 *      protects deposited funds, global Pausable, finalizeAuction for permissionless
 *      settlement, signature replay protection via address(this).
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @dev Interface for Clanker tokens to verify ownership
 */
interface IClankerToken {
    function admin() external view returns (address);
    function originalAdmin() external view returns (address);
}

/**
 * @dev Interface for burnable tokens
 */
interface IERC20Burnable is IERC20 {
    function burn(uint256 amount) external;
}

/**
 * @dev Interface for Net Protocol messaging
 */
interface INet {
    struct Message {
        address app;
        address sender;
        uint256 timestamp;
        bytes data;
        string text;
        string topic;
    }

    function sendMessageViaApp(
        address sender,
        string calldata text,
        string calldata topic,
        bytes calldata data
    ) external;

    function getTotalMessagesForAppTopicCount(address app, string calldata topic) external view returns (uint256);
}

contract JungleBayIslandV7 is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                        CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    uint256 public constant MAX_NAME_LENGTH = 64;
    uint256 public constant MAX_HEAT = 100;
    uint256 public constant PRIME_SPOTS_COUNT = 12;
    uint256 public constant AUCTION_DURATION = 7 days;

    /// @notice Net Protocol contract address
    address public constant NET = 0x00000000B24D62781dB359b07880a105cD0b64e6;

    /// @notice Chain identifier (Base)
    string public constant CHAIN = "base";

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                         STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    struct Bungalow {
        uint256 id;
        address currentOwner;           // Custodian or verified admin
        address verifiedAdmin;          // Permanent once set via admin verification
        address originalClaimer;        // Receives buyout payment if admin takes over
        address tokenAddress;           // The Clanker token this bungalow represents
        string ipfsHash;               // IPFS hash pointing to HTML/React/Phaser content
        string name;
        uint256 createdAt;
        uint256 lastUpdated;
        bool active;
        bool isVerifiedClaimed;        // Locks IPFS control to verified admin
        uint256 jbmPaid;
        uint256 nativeTokenPaid;
        string daimoPaymentId;     // Cross-references off-chain Daimo Pay receipt
    }

    struct PrimeSpot {
        uint256 bungalowId;            // 0 if no auction winner
        address bidder;
        uint256 bidAmount;
        uint256 auctionStart;
    }

    struct PrimeDisplayInfo {
        uint256 bungalowId;
        address tokenAddress;
        string ipfsHash;
        string name;
        bool isAuctionWinner;          // true if won via auction, false if default
        uint256 currentBid;
        uint256 auctionEnds;
    }

    struct UserStats {
        uint256 totalJbmSpent;
        uint256 bungalowsCreated;
        uint256 lastActivityTimestamp;
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                     STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    IERC20 public immutable jbmToken;
    address public treasury;
    address public baylaSigner;
    bool public burnMode;

    mapping(uint256 => uint256) public bungalowNonces;
    uint256 public bungalowCount;
    uint256 public totalJbmCollected;

    mapping(uint256 => Bungalow) public bungalows;
    mapping(address => UserStats) public userStats;
    mapping(address => uint256[]) public userBungalows;

    /// @notice Token address => Bungalow ID (one bungalow per token)
    mapping(address => uint256) public bungalowByToken;

    /// @notice The 12 prime spots
    mapping(uint8 => PrimeSpot) public primeSpots;

    /// @notice Default bungalows for empty prime spots
    mapping(uint8 => uint256) public defaultPrimeSpots;

    /// @notice Pending refunds for outbid users
    mapping(address => uint256) public pendingRefunds;

    /// @notice Total sum of all pending refunds (JBM)
    uint256 public totalPendingRefunds;

    /// @notice Total sum of active auction bids not yet finalized (JBM)
    uint256 public totalActiveBids;

    /// @notice Per-bungalow per-token lagoon deposit balances
    mapping(uint256 => mapping(address => uint256)) public lagoonDeposits;

    /// @notice Total lagoon deposits per token across all bungalows
    mapping(address => uint256) public totalLagoonDeposits;

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                         EVENTS
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    event BungalowCreated(
        uint256 indexed bungalowId,
        address indexed owner,
        address indexed tokenAddress,
        string name,
        uint256 jbmPaid,
        uint256 nativeTokenPaid,
        bool isVerifiedClaimed,
        uint256 timestamp
    );

    event BungalowContentUpdated(
        uint256 indexed bungalowId,
        string oldIpfsHash,
        string newIpfsHash,
        uint256 timestamp
    );

    event BungalowOwnershipTransferred(
        uint256 indexed bungalowId,
        address indexed previousOwner,
        address indexed newOwner
    );

    event BungalowStatusChanged(uint256 indexed bungalowId, bool active);

    event PrimeSpotBid(
        uint8 indexed spotId,
        uint256 indexed bungalowId,
        address indexed bidder,
        uint256 bidAmount,
        uint256 auctionEnds
    );

    event PrimeSpotWon(
        uint8 indexed spotId,
        uint256 indexed bungalowId,
        address indexed winner,
        uint256 winningBid
    );

    event AuctionFinalized(
        uint8 indexed spotId,
        uint256 indexed bungalowId,
        address indexed winner,
        uint256 winningBid
    );

    event PrimeSpotDefaultSet(uint8 indexed spotId, uint256 indexed bungalowId);
    event RefundClaimed(address indexed user, uint256 amount);
    event BurnModeToggled(bool burnMode);
    event TreasuryUpdated(address indexed newTreasury);
    event BaylaSignerUpdated(address indexed newSigner);
    event MessageSentToNet(address indexed sender, address indexed tokenAddress, string text);

    event AdminTakeover(
        uint256 indexed bungalowId,
        address indexed admin,
        address indexed originalClaimer,
        uint256 jbmBuyout,
        uint256 nativeTokenBuyout,
        uint256 timestamp
    );

    event LagoonDeposit(
        uint256 indexed bungalowId,
        address indexed token,
        address indexed depositor,
        uint256 amount
    );

    event LagoonWithdrawal(
        uint256 indexed bungalowId,
        address indexed token,
        address indexed recipient,
        uint256 amount
    );

    event CustodianChanged(
        uint256 indexed bungalowId,
        address indexed previousCustodian,
        address indexed newCustodian
    );

    event LagoonRewardsDistributed(
        uint256 indexed bungalowId,
        address indexed token,
        uint256 recipientCount,
        uint256 totalAmount
    );

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                         ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    error EmptyString();
    error NameTooLong();
    error BungalowNotFound();
    error BungalowAlreadyExists();
    error ZeroAddress();
    error NotBungalowOwner();
    error BungalowNotActive();
    error InvalidSignature();
    error SignatureExpired();
    error InvalidSpotId();
    error BidTooLow();
    error NoRefundAvailable();
    error NotTokenAdmin();
    error AuctionStillActive();
    error AlreadyVerifiedClaimed();
    error NotVerifiedAdmin();
    error InsufficientLagoonBalance();
    error ZeroAmount();
    error ExceedsWithdrawableBalance();
    error AuctionNotEnded();
    error InsufficientHeat();
    error CannotSelfOutbid();
    error LimitTooHigh();
    error ArrayLengthMismatch();

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                       CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    constructor(
        address _owner,
        address _jbmToken,
        address _treasury,
        address _baylaSigner
    ) Ownable(_owner) {
        if (_jbmToken == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();
        if (_baylaSigner == address(0)) revert ZeroAddress();

        jbmToken = IERC20(_jbmToken);
        treasury = _treasury;
        baylaSigner = _baylaSigner;
        burnMode = false; // Default: hodl
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                   BUNGALOW CLAIMING
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Claim a bungalow for a Clanker token. Anyone can call with Bayla signature.
     * @dev If msg.sender is the token's admin(), the bungalow is marked as verified.
     *      Otherwise, it's an unverified custodial claim that the real admin can take over.
     * @param tokenAddress The Clanker token contract address
     * @param ipfsHash IPFS hash pointing to the bungalow content
     * @param name Display name for the bungalow
     * @param jbmAmount Amount of JBM to pay
     * @param nativeTokenAmount Amount of the native token to pay
     * @param daimoPaymentId Off-chain Daimo Pay payment ID (empty string if not applicable)
     * @param signature Bayla's signature authorizing this claim
     * @param deadline Signature expiry timestamp
     */
    function claimBungalow(
        address tokenAddress,
        string calldata ipfsHash,
        string calldata name,
        uint256 jbmAmount,
        uint256 nativeTokenAmount,
        string calldata daimoPaymentId,
        bytes calldata signature,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256) {
        if (tokenAddress == address(0)) revert ZeroAddress();
        if (bytes(ipfsHash).length == 0) revert EmptyString();
        if (bytes(name).length == 0) revert EmptyString();
        if (bytes(name).length > MAX_NAME_LENGTH) revert NameTooLong();
        if (bungalowByToken[tokenAddress] != 0) revert BungalowAlreadyExists();
        if (block.timestamp > deadline) revert SignatureExpired();

        // Verify Bayla's signature (includes address(this) to prevent cross-contract replay)
        bytes32 messageHash = keccak256(abi.encodePacked(
            "claimBungalow",
            msg.sender,
            tokenAddress,
            ipfsHash,
            name,
            jbmAmount,
            nativeTokenAmount,
            daimoPaymentId,
            deadline,
            block.chainid,
            address(this)
        ));

        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address recoveredSigner = ethSignedHash.recover(signature);

        if (recoveredSigner != baylaSigner) revert InvalidSignature();

        // Handle JBM payment -> treasury via _handlePayment (burn/hodl)
        if (jbmAmount > 0) {
            jbmToken.safeTransferFrom(msg.sender, address(this), jbmAmount);
            _handlePayment(address(jbmToken), jbmAmount);
        }

        // Handle native token payment -> stays in contract as lagoon deposit
        uint256 actualNativeDeposit;
        if (nativeTokenAmount > 0) {
            IERC20 nativeToken = IERC20(tokenAddress);

            uint256 balanceBefore = nativeToken.balanceOf(address(this));
            nativeToken.safeTransferFrom(msg.sender, address(this), nativeTokenAmount);
            actualNativeDeposit = nativeToken.balanceOf(address(this)) - balanceBefore;
        }

        bungalowCount++;
        uint256 bungalowId = bungalowCount;

        // Check if sender is the Clanker token admin
        bool senderIsAdmin;
        try IClankerToken(tokenAddress).admin() returns (address tokenAdmin) {
            senderIsAdmin = (msg.sender == tokenAdmin);
        } catch {
            senderIsAdmin = false;
        }

        // Track native token deposit in lagoon
        if (actualNativeDeposit > 0) {
            lagoonDeposits[bungalowId][tokenAddress] += actualNativeDeposit;
            totalLagoonDeposits[tokenAddress] += actualNativeDeposit;
        }

        bungalows[bungalowId] = Bungalow({
            id: bungalowId,
            currentOwner: msg.sender,
            verifiedAdmin: senderIsAdmin ? msg.sender : address(0),
            originalClaimer: msg.sender,
            tokenAddress: tokenAddress,
            ipfsHash: ipfsHash,
            name: name,
            createdAt: block.timestamp,
            lastUpdated: block.timestamp,
            active: true,
            isVerifiedClaimed: senderIsAdmin,
            jbmPaid: jbmAmount,
            nativeTokenPaid: actualNativeDeposit,
            daimoPaymentId: daimoPaymentId
        });

        bungalowByToken[tokenAddress] = bungalowId;

        UserStats storage stats = userStats[msg.sender];
        stats.totalJbmSpent += jbmAmount;
        stats.bungalowsCreated++;
        stats.lastActivityTimestamp = block.timestamp;

        totalJbmCollected += jbmAmount;
        userBungalows[msg.sender].push(bungalowId);

        emit BungalowCreated(
            bungalowId,
            msg.sender,
            tokenAddress,
            name,
            jbmAmount,
            nativeTokenAmount,
            senderIsAdmin,
            block.timestamp
        );

        return bungalowId;
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                   ADMIN BUYOUT
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Admin takes over an unverified bungalow, compensating the original claimer.
     * @dev Only callable when bungalow exists and isVerifiedClaimed == false.
     *      Admin's JBM and native token payments go directly to the original claimer.
     * @param bungalowId The bungalow to take over
     * @param newIpfsHash New IPFS hash for admin's content
     * @param jbmAmount JBM buyout amount paid to original claimer
     * @param nativeTokenAmount Native token buyout amount paid to original claimer
     * @param signature Bayla's signature authorizing this takeover
     * @param deadline Signature expiry timestamp
     */
    function adminClaimBungalow(
        uint256 bungalowId,
        string calldata newIpfsHash,
        uint256 jbmAmount,
        uint256 nativeTokenAmount,
        bytes calldata signature,
        uint256 deadline
    ) external nonReentrant whenNotPaused {
        Bungalow storage b = bungalows[bungalowId];
        if (b.id == 0) revert BungalowNotFound();
        if (b.isVerifiedClaimed) revert AlreadyVerifiedClaimed();
        if (bytes(newIpfsHash).length == 0) revert EmptyString();
        if (block.timestamp > deadline) revert SignatureExpired();

        // Must be the actual Clanker token admin (no try/catch - must succeed)
        address tokenAdmin = IClankerToken(b.tokenAddress).admin();
        if (msg.sender != tokenAdmin) revert NotTokenAdmin();

        // Verify Bayla's signature (includes address(this) to prevent cross-contract replay)
        bytes32 messageHash = keccak256(abi.encodePacked(
            "adminClaimBungalow",
            msg.sender,
            bungalowId,
            newIpfsHash,
            jbmAmount,
            nativeTokenAmount,
            deadline,
            block.chainid,
            address(this)
        ));

        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address recoveredSigner = ethSignedHash.recover(signature);

        if (recoveredSigner != baylaSigner) revert InvalidSignature();

        address claimer = b.originalClaimer;

        // Admin's JBM -> sent directly to original claimer
        if (jbmAmount > 0) {
            jbmToken.safeTransferFrom(msg.sender, claimer, jbmAmount);
        }

        // Admin's native token -> sent directly to original claimer
        if (nativeTokenAmount > 0) {
            IERC20 nativeToken = IERC20(b.tokenAddress);
            nativeToken.safeTransferFrom(msg.sender, claimer, nativeTokenAmount);
        }

        // Update bungalow state
        address previousOwner = b.currentOwner;
        b.verifiedAdmin = msg.sender;
        b.currentOwner = msg.sender;
        b.isVerifiedClaimed = true;
        b.ipfsHash = newIpfsHash;
        b.lastUpdated = block.timestamp;

        // Lagoon deposits from original creation stay untouched

        emit AdminTakeover(
            bungalowId,
            msg.sender,
            claimer,
            jbmAmount,
            nativeTokenAmount,
            block.timestamp
        );

        emit CustodianChanged(bungalowId, previousOwner, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                   BUNGALOW CONTENT UPDATES
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Update bungalow content using Bayla's signature.
     * @dev Two paths:
     *      - If isVerifiedClaimed: ONLY verifiedAdmin can update
     *      - If NOT isVerifiedClaimed: ANYONE can update (with Bayla sig), becoming new currentOwner
     */
    function updateBungalowContent(
        uint256 bungalowId,
        string calldata newIpfsHash,
        bytes calldata signature,
        uint256 deadline
    ) external nonReentrant whenNotPaused {
        Bungalow storage b = bungalows[bungalowId];
        if (b.id == 0) revert BungalowNotFound();
        if (!b.active) revert BungalowNotActive();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (bytes(newIpfsHash).length == 0) revert EmptyString();

        if (b.isVerifiedClaimed) {
            // Only verified admin can update
            if (msg.sender != b.verifiedAdmin) revert NotVerifiedAdmin();
        }

        uint256 currentNonce = bungalowNonces[bungalowId];

        // Includes address(this) to prevent cross-contract replay
        bytes32 messageHash = keccak256(abi.encodePacked(
            "updateContent",
            bungalowId,
            msg.sender,
            newIpfsHash,
            currentNonce,
            deadline,
            block.chainid,
            address(this)
        ));

        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address recoveredSigner = ethSignedHash.recover(signature);

        if (recoveredSigner != baylaSigner) revert InvalidSignature();

        bungalowNonces[bungalowId] = currentNonce + 1;

        string memory oldIpfsHash = b.ipfsHash;
        b.ipfsHash = newIpfsHash;
        b.lastUpdated = block.timestamp;

        // If not verified, anyone with valid sig becomes the new currentOwner
        if (!b.isVerifiedClaimed && msg.sender != b.currentOwner) {
            address previousOwner = b.currentOwner;
            b.currentOwner = msg.sender;
            emit CustodianChanged(bungalowId, previousOwner, msg.sender);
        }

        emit BungalowContentUpdated(bungalowId, oldIpfsHash, newIpfsHash, block.timestamp);
    }

    /**
     * @notice Transfer bungalow ownership.
     * @dev If verified: only verifiedAdmin can transfer. If not: only currentOwner.
     *      Transfer changes currentOwner but NOT verifiedAdmin.
     */
    function transferBungalowOwnership(uint256 bungalowId, address newOwner) external whenNotPaused {
        Bungalow storage b = bungalows[bungalowId];
        if (b.id == 0) revert BungalowNotFound();
        if (newOwner == address(0)) revert ZeroAddress();

        if (b.isVerifiedClaimed) {
            if (msg.sender != b.verifiedAdmin) revert NotVerifiedAdmin();
        } else {
            if (msg.sender != b.currentOwner) revert NotBungalowOwner();
        }

        address previousOwner = b.currentOwner;
        b.currentOwner = newOwner;

        emit BungalowOwnershipTransferred(bungalowId, previousOwner, newOwner);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                   DMT LAGOON DEPOSITS
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Deposit ERC20 tokens to a bungalow's lagoon pool.
     * @dev Anyone can deposit. Uses balance-before/after for fee-on-transfer token safety.
     * @param bungalowId The bungalow to deposit to
     * @param token The ERC20 token to deposit
     * @param amount The amount to deposit
     */
    function depositToLagoon(
        uint256 bungalowId,
        address token,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        Bungalow storage b = bungalows[bungalowId];
        if (b.id == 0) revert BungalowNotFound();
        if (!b.active) revert BungalowNotActive();
        if (amount == 0) revert ZeroAmount();
        if (token == address(0)) revert ZeroAddress();

        IERC20 depositToken = IERC20(token);
        uint256 balanceBefore = depositToken.balanceOf(address(this));
        depositToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 actualDeposit = depositToken.balanceOf(address(this)) - balanceBefore;

        lagoonDeposits[bungalowId][token] += actualDeposit;
        totalLagoonDeposits[token] += actualDeposit;

        emit LagoonDeposit(bungalowId, token, msg.sender, actualDeposit);
    }

    /**
     * @notice Withdraw ERC20 tokens from a bungalow's lagoon pool.
     * @dev Access control: if verified, only verifiedAdmin; else only currentOwner.
     *      CEI pattern: state updates before transfer.
     * @param bungalowId The bungalow to withdraw from
     * @param token The ERC20 token to withdraw
     * @param amount The amount to withdraw
     * @param recipient The address to receive the tokens
     */
    function withdrawFromLagoon(
        uint256 bungalowId,
        address token,
        uint256 amount,
        address recipient
    ) external nonReentrant {
        Bungalow storage b = bungalows[bungalowId];
        if (b.id == 0) revert BungalowNotFound();
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();

        // Access control: matches verified/unverified pattern
        if (b.isVerifiedClaimed) {
            if (msg.sender != b.verifiedAdmin) revert NotVerifiedAdmin();
        } else {
            if (msg.sender != b.currentOwner) revert NotBungalowOwner();
        }

        if (lagoonDeposits[bungalowId][token] < amount) revert InsufficientLagoonBalance();

        // CEI: decrement balance before transfer
        lagoonDeposits[bungalowId][token] -= amount;
        totalLagoonDeposits[token] -= amount;

        IERC20(token).safeTransfer(recipient, amount);

        emit LagoonWithdrawal(bungalowId, token, recipient, amount);
    }

    /**
     * @notice Distribute lagoon rewards to multiple recipients in a single call.
     * @dev Access control: matches verified/unverified pattern. Gas-capped at 200 recipients.
     * @param bungalowId The bungalow whose lagoon pool to distribute from
     * @param token The ERC20 token to distribute
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts corresponding to each recipient
     */
    function distributeLagoonRewards(
        uint256 bungalowId,
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant whenNotPaused {
        Bungalow storage b = bungalows[bungalowId];
        if (b.id == 0) revert BungalowNotFound();

        // Access control: matches verified/unverified pattern
        if (b.isVerifiedClaimed) {
            if (msg.sender != b.verifiedAdmin) revert NotVerifiedAdmin();
        } else {
            if (msg.sender != b.currentOwner) revert NotBungalowOwner();
        }

        if (recipients.length != amounts.length) revert ArrayLengthMismatch();
        if (recipients.length == 0) revert ZeroAmount();
        if (recipients.length > 200) revert LimitTooHigh(); // gas safety cap

        uint256 totalAmount;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
        }

        if (lagoonDeposits[bungalowId][token] < totalAmount) revert InsufficientLagoonBalance();

        // CEI: decrement total before transfers
        lagoonDeposits[bungalowId][token] -= totalAmount;
        totalLagoonDeposits[token] -= totalAmount;

        IERC20 rewardToken = IERC20(token);
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            if (amounts[i] > 0) {
                rewardToken.safeTransfer(recipients[i], amounts[i]);
            }
        }

        emit LagoonRewardsDistributed(bungalowId, token, recipients.length, totalAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                   PRIME SPOTS AUCTION
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Bid for a prime spot on the main island
     */
    function bidForPrimeSpot(
        uint8 spotId,
        uint256 bungalowId,
        uint256 bidAmount
    ) external nonReentrant whenNotPaused {
        if (spotId >= PRIME_SPOTS_COUNT) revert InvalidSpotId();

        Bungalow storage b = bungalows[bungalowId];
        if (b.id == 0) revert BungalowNotFound();
        if (b.currentOwner != msg.sender) revert NotBungalowOwner();
        if (!b.active) revert BungalowNotActive();

        PrimeSpot storage spot = primeSpots[spotId];

        // Check if auction period ended - start new period
        if (spot.auctionStart == 0 || block.timestamp > spot.auctionStart + AUCTION_DURATION) {
            if (spot.bungalowId != 0 && spot.bidAmount > 0) {
                // Finalize previous auction
                totalActiveBids -= spot.bidAmount;
                _handlePayment(address(jbmToken), spot.bidAmount);
                emit PrimeSpotWon(spotId, spot.bungalowId, spot.bidder, spot.bidAmount);
            }
            spot.auctionStart = block.timestamp;
            spot.bidAmount = 0;
            spot.bidder = address(0);
            // Note: bungalowId persists - winner keeps spot until outbid
        }

        if (bidAmount <= spot.bidAmount) revert BidTooLow();
        if (msg.sender == spot.bidder) revert CannotSelfOutbid();

        // Refund previous bidder — moves from active bids to pending refunds
        if (spot.bidder != address(0) && spot.bidAmount > 0) {
            totalActiveBids -= spot.bidAmount;
            pendingRefunds[spot.bidder] += spot.bidAmount;
            totalPendingRefunds += spot.bidAmount;
        }

        // Transfer new bid
        jbmToken.safeTransferFrom(msg.sender, address(this), bidAmount);
        totalActiveBids += bidAmount;

        spot.bungalowId = bungalowId;
        spot.bidder = msg.sender;
        spot.bidAmount = bidAmount;

        emit PrimeSpotBid(
            spotId,
            bungalowId,
            msg.sender,
            bidAmount,
            spot.auctionStart + AUCTION_DURATION
        );
    }

    /**
     * @notice Finalize an auction after the auction period has ended.
     * @dev Anyone can call. Processes the winning bid payment and resets for next cycle.
     * @param spotId The prime spot to finalize
     */
    function finalizeAuction(uint8 spotId) external nonReentrant whenNotPaused {
        if (spotId >= PRIME_SPOTS_COUNT) revert InvalidSpotId();

        PrimeSpot storage spot = primeSpots[spotId];
        if (spot.auctionStart == 0) revert AuctionNotEnded();
        if (block.timestamp <= spot.auctionStart + AUCTION_DURATION) revert AuctionNotEnded();

        if (spot.bungalowId != 0 && spot.bidAmount > 0) {
            totalActiveBids -= spot.bidAmount;
            _handlePayment(address(jbmToken), spot.bidAmount);

            emit AuctionFinalized(spotId, spot.bungalowId, spot.bidder, spot.bidAmount);
            emit PrimeSpotWon(spotId, spot.bungalowId, spot.bidder, spot.bidAmount);
        }

        // Reset auction state for next cycle (winner's bungalowId persists)
        uint256 winnerBungalowId = spot.bungalowId;
        spot.auctionStart = 0;
        spot.bidAmount = 0;
        spot.bidder = address(0);
        spot.bungalowId = winnerBungalowId;
    }

    /**
     * @notice Claim refund from being outbid
     */
    function claimRefund() external nonReentrant {
        uint256 refundAmount = pendingRefunds[msg.sender];
        if (refundAmount == 0) revert NoRefundAvailable();

        pendingRefunds[msg.sender] = 0;
        totalPendingRefunds -= refundAmount;

        jbmToken.safeTransfer(msg.sender, refundAmount);

        emit RefundClaimed(msg.sender, refundAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                   PRIME SPOTS VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Get the current 12 prime bungalow IDs (auction winners or defaults)
     */
    function getCurrentPrimeDisplay() external view returns (uint256[12] memory bungalowIds) {
        for (uint8 i = 0; i < 12; i++) {
            PrimeSpot memory spot = primeSpots[i];
            if (spot.bungalowId != 0) {
                bungalowIds[i] = spot.bungalowId;
            } else {
                bungalowIds[i] = defaultPrimeSpots[i];
            }
        }
    }

    /**
     * @notice Get full display data for the 12 prime spots
     * @return displayData Array of PrimeDisplayInfo for rendering the dodecagon
     */
    function getPrimeDisplayData() external view returns (PrimeDisplayInfo[12] memory displayData) {
        for (uint8 i = 0; i < 12; i++) {
            PrimeSpot memory spot = primeSpots[i];
            uint256 displayBungalowId;
            bool isWinner;

            if (spot.bungalowId != 0) {
                displayBungalowId = spot.bungalowId;
                isWinner = true;
            } else {
                displayBungalowId = defaultPrimeSpots[i];
                isWinner = false;
            }

            if (displayBungalowId != 0) {
                Bungalow memory bung = bungalows[displayBungalowId];
                displayData[i] = PrimeDisplayInfo({
                    bungalowId: displayBungalowId,
                    tokenAddress: bung.tokenAddress,
                    ipfsHash: bung.ipfsHash,
                    name: bung.name,
                    isAuctionWinner: isWinner,
                    currentBid: spot.bidAmount,
                    auctionEnds: spot.auctionStart > 0 ? spot.auctionStart + AUCTION_DURATION : 0
                });
            } else {
                // Empty spot
                displayData[i] = PrimeDisplayInfo({
                    bungalowId: 0,
                    tokenAddress: address(0),
                    ipfsHash: "",
                    name: "",
                    isAuctionWinner: false,
                    currentBid: 0,
                    auctionEnds: 0
                });
            }
        }
    }

    /**
     * @notice Get topic string for a token (base:{address})
     */
    function getTopic(address tokenAddress) public pure returns (string memory) {
        return string(abi.encodePacked(CHAIN, ":", _addressToString(tokenAddress)));
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                    GENERAL VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    function getBungalow(uint256 bungalowId) external view returns (Bungalow memory) {
        return bungalows[bungalowId];
    }

    function getBungalowByToken(address tokenAddress) external view returns (Bungalow memory) {
        uint256 id = bungalowByToken[tokenAddress];
        return bungalows[id];
    }

    function getBungalowIdByToken(address tokenAddress) external view returns (uint256) {
        return bungalowByToken[tokenAddress];
    }

    /**
     * @notice Get multiple bungalows in a single call.
     * @param offset Starting index (0-indexed, maps to bungalow ID offset+1)
     * @param limit Maximum number of bungalows to return (capped at 100)
     * @return result Array of Bungalow structs
     */
    function getBungalows(uint256 offset, uint256 limit) external view returns (Bungalow[] memory result) {
        if (limit > 100) revert LimitTooHigh();
        if (offset >= bungalowCount) {
            return new Bungalow[](0);
        }

        uint256 remaining = bungalowCount - offset;
        uint256 count = limit < remaining ? limit : remaining;

        result = new Bungalow[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = bungalows[offset + 1 + i];
        }
    }

    function getPrimeSpot(uint8 spotId) external view returns (PrimeSpot memory) {
        return primeSpots[spotId];
    }

    function getHeat(address user) public view returns (uint256 heat) {
        UserStats memory stats = userStats[user];
        if (stats.lastActivityTimestamp == 0) return 0;

        uint256 spendPoints = _calculateSpendPoints(stats.totalJbmSpent);
        uint256 bungalowPoints = _min(stats.bungalowsCreated * 6, 30);
        uint256 recencyPoints = _calculateRecencyPoints(stats.lastActivityTimestamp);

        heat = _min(spendPoints + bungalowPoints + recencyPoints, MAX_HEAT);
    }

    function getUserBungalows(address user) external view returns (uint256[] memory) {
        return userBungalows[user];
    }

    function getUserStats(address user) external view returns (UserStats memory) {
        return userStats[user];
    }

    function getBungalowNonce(uint256 bungalowId) external view returns (uint256) {
        return bungalowNonces[bungalowId];
    }

    function getLagoonBalance(uint256 bungalowId, address token) external view returns (uint256) {
        return lagoonDeposits[bungalowId][token];
    }

    function getTotalLagoonBalance(address token) external view returns (uint256) {
        return totalLagoonDeposits[token];
    }

    function isBungalowVerified(uint256 bungalowId) external view returns (bool) {
        return bungalows[bungalowId].isVerifiedClaimed;
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                 NET PROTOCOL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Send a message to a bungalow's chat
     * @dev Requires sender to have non-zero heat
     */
    function sendMessage(
        uint256 bungalowId,
        string calldata text,
        bytes calldata data
    ) external nonReentrant whenNotPaused {
        Bungalow storage b = bungalows[bungalowId];
        if (b.id == 0) revert BungalowNotFound();
        if (!b.active) revert BungalowNotActive();
        if (bytes(text).length == 0) revert EmptyString();
        if (getHeat(msg.sender) == 0) revert InsufficientHeat();

        string memory topic = getTopic(b.tokenAddress);

        INet(NET).sendMessageViaApp(msg.sender, text, topic, data);

        userStats[msg.sender].lastActivityTimestamp = block.timestamp;

        emit MessageSentToNet(msg.sender, b.tokenAddress, text);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                      ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Set default bungalows for the 12 prime spots
     */
    function setDefaultPrimeSpots(uint256[12] calldata bungalowIds) external onlyOwner {
        for (uint8 i = 0; i < 12; i++) {
            defaultPrimeSpots[i] = bungalowIds[i];
            emit PrimeSpotDefaultSet(i, bungalowIds[i]);
        }
    }

    /**
     * @notice Set a single default prime spot
     */
    function setDefaultPrimeSpot(uint8 spotId, uint256 bungalowId) external onlyOwner {
        if (spotId >= PRIME_SPOTS_COUNT) revert InvalidSpotId();
        defaultPrimeSpots[spotId] = bungalowId;
        emit PrimeSpotDefaultSet(spotId, bungalowId);
    }

    function setBurnMode(bool _burnMode) external onlyOwner {
        burnMode = _burnMode;
        emit BurnModeToggled(_burnMode);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setBaylaSigner(address _baylaSigner) external onlyOwner {
        if (_baylaSigner == address(0)) revert ZeroAddress();
        baylaSigner = _baylaSigner;
        emit BaylaSignerUpdated(_baylaSigner);
    }

    function setBungalowStatus(uint256 bungalowId, bool active) external onlyOwner {
        if (bungalows[bungalowId].id == 0) revert BungalowNotFound();
        bungalows[bungalowId].active = active;
        emit BungalowStatusChanged(bungalowId, active);
    }

    /// @notice Pause all state-changing functions
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause all state-changing functions
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Emergency withdraw tokens to treasury, protecting lagoon deposits, pending refunds, and active bids.
     * @dev For JBM: withdrawable = balance - totalLagoonDeposits[jbm] - totalPendingRefunds - totalActiveBids
     *      For other tokens: withdrawable = balance - totalLagoonDeposits[token]
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 reserved = totalLagoonDeposits[token];

        // JBM also has pending refunds and active auction bids reserved
        if (token == address(jbmToken)) {
            reserved += totalPendingRefunds;
            reserved += totalActiveBids;
        }

        uint256 withdrawable = balance > reserved ? balance - reserved : 0;
        if (amount > withdrawable) revert ExceedsWithdrawableBalance();

        IERC20(token).safeTransfer(treasury, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //                                     INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    function _handlePayment(address token, uint256 amount) internal {
        if (burnMode) {
            try IERC20Burnable(token).burn(amount) {
            } catch {
                IERC20(token).safeTransfer(treasury, amount);
            }
        } else {
            IERC20(token).safeTransfer(treasury, amount);
        }
    }

    function _calculateSpendPoints(uint256 totalSpent) internal pure returns (uint256) {
        if (totalSpent == 0) return 0;
        uint256 scaled = totalSpent / 1e18;
        if (scaled >= 5000) return 50;
        if (scaled >= 2000) return 40 + ((scaled - 2000) * 10) / 3000;
        if (scaled >= 500) return 25 + ((scaled - 500) * 15) / 1500;
        if (scaled >= 100) return 10 + ((scaled - 100) * 15) / 400;
        return (scaled * 10) / 100;
    }

    function _calculateRecencyPoints(uint256 lastActivity) internal view returns (uint256) {
        if (lastActivity == 0) return 0;
        uint256 elapsed = block.timestamp - lastActivity;
        if (elapsed <= 7 days) return 20;
        if (elapsed <= 30 days) return 15;
        if (elapsed <= 90 days) return 10;
        if (elapsed <= 180 days) return 5;
        return 0;
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _addressToString(address addr) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            str[2 + i * 2] = alphabet[uint8(uint160(addr) >> (8 * (19 - i)) >> 4) & 0xf];
            str[3 + i * 2] = alphabet[uint8(uint160(addr) >> (8 * (19 - i))) & 0xf];
        }
        return string(str);
    }
}
