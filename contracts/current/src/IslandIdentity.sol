// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║                      ISLAND IDENTITY                              ║
 * ║                    Jungle Bay Island                               ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 *
 * This is the soul of the island. Everyone who walks through the gate
 * starts here. Every profile is a person. Every person is a wallet.
 * Every wallet carries heat.
 *
 * Identity on Jungle Bay Island is anchored to your X (Twitter) account.
 * Not because X is sacred — but because X is where the memes live, where
 * the culture flows, and where your presence on this island began before
 * you even knew this island existed.
 *
 * The primary identifier is your X user ID — a number that never changes
 * even if your handle does. The handle is cosmetic. The ID is the truth.
 *
 * HEAT:
 * Heat is a per-profile, per-bungalow score. It is calculated off-chain
 * daily by scanning every wallet that has ever touched a given token.
 * It flows onto this contract whenever you interact with the island —
 * claiming JBM, installing an item, submitting a commission. The contract
 * does not pretend to know your heat at all times. It only records what
 * you've proven when you showed up.
 *
 * JBM BONDS:
 * When you install something in a bungalow, a bond activates. That bond
 * is a permanent door that opens between you and that bungalow's JBM flow.
 * From that moment forward, any wallet linked to your profile can claim
 * the JBM they are owed for the heat they carry — once per wallet per day.
 *
 * ARCHITECTURE:
 * This contract is a dependency of all three others:
 *   - JungleBayIsland reads it to verify bungalow context
 *   - Bodega calls it to activate bonds and check heat
 *   - CommissionManager reads it to verify artist/requester identity
 *
 * Deploy this first.
 */

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract IslandIdentity is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────

    uint256 internal constant MAX_HANDLE_LENGTH = 50;
    // ─────────────────────────────────────────────────────────────
    // EIP-712 type hashes
    // ─────────────────────────────────────────────────────────────

    bytes32 internal constant REGISTER_TYPEHASH =
        keccak256("Register(uint64 xUserId,string xHandle,address wallet,bytes32 salt,uint256 deadline)");

    bytes32 internal constant LINK_WALLET_TYPEHASH =
        keccak256("LinkWallet(uint256 profileId,address wallet,bytes32 salt,uint256 deadline)");

    bytes32 internal constant SYNC_HEAT_TYPEHASH =
        keccak256("SyncHeat(uint256 profileId,uint256 bungalowId,uint256 heatScore,bytes32 salt,uint256 deadline)");

    bytes32 internal constant CLAIM_JBM_TYPEHASH =
        keccak256("ClaimDailyJBM(address wallet,uint256 periodId,uint256 amount,bytes32 salt,uint256 deadline)");

    // ─────────────────────────────────────────────────────────────
    // Structs
    // ─────────────────────────────────────────────────────────────

    struct Profile {
        uint256 id;
        uint64 xUserId; // immutable — the true identity
        string xHandle; // cosmetic — can change, never breaks identity
        address mainWallet;
        uint64 createdAt;
        uint64 updatedAt;
        bool hardcoreWarning; // admin-set flag. a scarlet letter. visible to all.
    }

    // ─────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────

    error Unauthorized();
    error InvalidAddress();
    error InvalidStringLength();
    error ProfileNotFound();
    error WalletAlreadyLinked();
    error WalletNotLinked();
    error LastWalletRemovalForbidden();
    error XUserIdAlreadyRegistered();
    error SignatureExpired();
    error InvalidBackendSignature();
    error AttestationAlreadyUsed();
    error AlreadyClaimedPeriod();
    error InsufficientHeat();
    error BondAlreadyActivated();
    error NoActiveBond();
    error InvalidEscrow();

    // ─────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────

    IERC20 public immutable jbmToken;
    address public backendSigner;
    address public jbmEscrow; // wallet that holds JBM for daily distribution
    address public bodega; // only Bodega can activate bonds

    uint256 public profileCount;

    mapping(bytes32 => bool) public usedDigests;

    mapping(uint256 => Profile) private _profiles;
    mapping(uint64 => uint256) public profileIdByXUserId;
    mapping(address => uint256) public walletProfileId;
    mapping(uint256 => address[]) private _profileWallets;
    mapping(uint256 => mapping(address => uint256)) private _walletIndex;

    // heat: profileId => bungalowId => score
    // updated on every on-chain interaction that carries an EIP-712 heat attestation
    mapping(uint256 => mapping(uint256 => uint256)) public heatScore;

    // bond: profileId => bungalowId => activated
    // once true, this wallet group is forever eligible for JBM from this bungalow
    mapping(uint256 => mapping(uint256 => bool)) public bondActivated;
    mapping(uint256 => uint256) public activeBondCount;

    // JBM claim: wallet => periodId => claimed
    // any linked wallet can claim once per day independently
    mapping(address => mapping(uint256 => bool)) public walletClaimedPeriod;

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    event ProfileRegistered(uint256 indexed profileId, uint64 indexed xUserId, string xHandle, address wallet);
    event WalletLinked(uint256 indexed profileId, address indexed wallet);
    event WalletUnlinked(uint256 indexed profileId, address indexed wallet);
    event HandleUpdated(uint256 indexed profileId, string newHandle);
    event HeatSynced(uint256 indexed profileId, uint256 indexed bungalowId, uint256 score);
    event BondActivated(uint256 indexed profileId, uint256 indexed bungalowId);
    event JBMClaimed(address indexed wallet, uint256 indexed profileId, uint256 indexed periodId, uint256 amount);
    event HardcoreWarningSet(uint256 indexed profileId, bool value);
    event BackendSignerUpdated(address indexed newSigner);
    event JBMEscrowUpdated(address indexed newEscrow);
    event BodegaAddressSet(address indexed bodega);

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(address initialOwner, address jbmToken_, address backendSigner_)
        EIP712("IslandIdentity", "1")
        Ownable(initialOwner)
    {
        if (initialOwner == address(0) || jbmToken_ == address(0) || backendSigner_ == address(0)) {
            revert InvalidAddress();
        }
        jbmToken = IERC20(jbmToken_);
        backendSigner = backendSigner_;
    }

    // ─────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setBackendSigner(address s) external onlyOwner {
        if (s == address(0)) revert InvalidAddress();
        backendSigner = s;
        emit BackendSignerUpdated(s);
    }

    function setJBMEscrow(address escrow) external onlyOwner {
        if (escrow == address(0)) revert InvalidAddress();
        jbmEscrow = escrow;
        emit JBMEscrowUpdated(escrow);
    }

    /// @notice Set after Bodega is deployed. Only Bodega may activate bonds.
    function setBodega(address bodega_) external onlyOwner {
        if (bodega_ == address(0)) revert InvalidAddress();
        bodega = bodega_;
        emit BodegaAddressSet(bodega_);
    }

    /// @notice The scarlet letter. Admin sets a visible warning on any profile.
    ///         This does not freeze the profile — they can still act.
    ///         It just means every artist and requester can see it before engaging.
    function setHardcoreWarning(uint256 profileId, bool value) external onlyOwner {
        _requireProfileExists(profileId);
        _profiles[profileId].hardcoreWarning = value;
        emit HardcoreWarningSet(profileId, value);
    }

    // ─────────────────────────────────────────────────────────────
    // Registration & wallet linking
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Create a new profile. Called once, with profileId = 0.
     *         The X user ID is the soul. The handle is the face.
     *         The backend will only sign this if the X OAuth flow completed.
     */
    function register(uint64 xUserId, string calldata xHandle, bytes32 salt, uint256 deadline, bytes calldata sig)
        external
        whenNotPaused
        returns (uint256 profileId)
    {
        if (walletProfileId[msg.sender] != 0) revert WalletAlreadyLinked();
        if (profileIdByXUserId[xUserId] != 0) revert XUserIdAlreadyRegistered();
        _requireBoundedString(xHandle, 1, MAX_HANDLE_LENGTH);

        _consumeAttestation(
            keccak256(abi.encode(REGISTER_TYPEHASH, xUserId, keccak256(bytes(xHandle)), msg.sender, salt, deadline)),
            sig,
            deadline
        );

        profileId = ++profileCount;
        _profiles[profileId] = Profile({
            id: profileId,
            xUserId: xUserId,
            xHandle: xHandle,
            mainWallet: msg.sender,
            createdAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp),
            hardcoreWarning: false
        });

        profileIdByXUserId[xUserId] = profileId;
        _linkWallet(profileId, msg.sender);

        emit ProfileRegistered(profileId, xUserId, xHandle, msg.sender);
    }

    /**
     * @notice Link an additional wallet to an existing profile.
     *         The backend signs this after verifying the X session.
     */
    function linkWallet(uint256 profileId, bytes32 salt, uint256 deadline, bytes calldata sig) external whenNotPaused {
        if (walletProfileId[msg.sender] != 0) revert WalletAlreadyLinked();
        _requireProfileExists(profileId);

        _consumeAttestation(
            keccak256(abi.encode(LINK_WALLET_TYPEHASH, profileId, msg.sender, salt, deadline)), sig, deadline
        );

        _linkWallet(profileId, msg.sender);
        _profiles[profileId].updatedAt = uint64(block.timestamp);
        emit WalletLinked(profileId, msg.sender);
    }

    /**
     * @notice Unlink a wallet from your profile. Cannot remove the last one.
     */
    function unlinkWallet(address wallet) external whenNotPaused {
        uint256 profileId = _callerProfileId();
        if (walletProfileId[wallet] != profileId) revert WalletNotLinked();
        if (_profileWallets[profileId].length <= 1) revert LastWalletRemovalForbidden();

        address mainWallet = _profiles[profileId].mainWallet;
        if (wallet != msg.sender && msg.sender != mainWallet) revert Unauthorized();

        // If removing main wallet, promote the first remaining one
        if (mainWallet == wallet) {
            address[] storage wallets = _profileWallets[profileId];
            address next = wallets[0] == wallet ? wallets[1] : wallets[0];
            _profiles[profileId].mainWallet = next;
        }

        _unlinkWallet(profileId, wallet);
        _profiles[profileId].updatedAt = uint64(block.timestamp);
        emit WalletUnlinked(profileId, wallet);
    }

    /**
     * @notice Update your X handle on-chain. Identity (xUserId) never changes.
     *         No attestation needed — you already proved identity at registration.
     */
    function updateHandle(string calldata newHandle) external whenNotPaused {
        uint256 profileId = _callerProfileId();
        _requireBoundedString(newHandle, 1, MAX_HANDLE_LENGTH);
        _profiles[profileId].xHandle = newHandle;
        _profiles[profileId].updatedAt = uint64(block.timestamp);
        emit HandleUpdated(profileId, newHandle);
    }

    // ─────────────────────────────────────────────────────────────
    // Heat
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Sync your heat score for a specific bungalow.
     *         Called automatically as part of any island interaction,
     *         or directly if you just want the record updated.
     */
    function syncHeat(
        uint256 profileId,
        uint256 bungalowId,
        uint256 score,
        bytes32 salt,
        uint256 deadline,
        bytes calldata sig
    ) external whenNotPaused {
        if (walletProfileId[msg.sender] != profileId) revert Unauthorized();
        _requireProfileExists(profileId);

        _consumeAttestation(
            keccak256(abi.encode(SYNC_HEAT_TYPEHASH, profileId, bungalowId, score, salt, deadline)), sig, deadline
        );

        _updateHeat(profileId, bungalowId, score);
    }

    // ─────────────────────────────────────────────────────────────
    // JBM bonds & daily claims
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Called exclusively by Bodega when a user installs an item.
     *         Opens the permanent JBM flow between this profile and this bungalow.
     *         Once activated, it never closes.
     */
    function activateBond(uint256 profileId, uint256 bungalowId) external {
        if (msg.sender != bodega) revert Unauthorized();
        if (bondActivated[profileId][bungalowId]) revert BondAlreadyActivated();
        bondActivated[profileId][bungalowId] = true;
        activeBondCount[profileId] += 1;
        emit BondActivated(profileId, bungalowId);
    }

    /**
     * @notice Claim your daily JBM. Any wallet linked to your profile can
     *         claim independently — once per wallet per day.
     *
     *         The backend calculates your amount based on total heat across
     *         all bungalows where your bond is activated. It will only sign
     *         this if at least one bond is active on your profile.
     *
     *         periodId is a daily integer decided by the backend (e.g. unix day).
     */
    function claimDailyJBM(uint256 periodId, uint256 amount, bytes32 salt, uint256 deadline, bytes calldata sig)
        external
        whenNotPaused
        nonReentrant
    {
        if (jbmEscrow == address(0)) revert InvalidEscrow();

        uint256 profileId = walletProfileId[msg.sender];
        if (profileId == 0) revert Unauthorized();
        if (activeBondCount[profileId] == 0) revert NoActiveBond();
        if (walletClaimedPeriod[msg.sender][periodId]) revert AlreadyClaimedPeriod();

        _consumeAttestation(
            keccak256(abi.encode(CLAIM_JBM_TYPEHASH, msg.sender, periodId, amount, salt, deadline)), sig, deadline
        );

        walletClaimedPeriod[msg.sender][periodId] = true;
        jbmToken.safeTransferFrom(jbmEscrow, msg.sender, amount);

        emit JBMClaimed(msg.sender, profileId, periodId, amount);
    }

    // ─────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────

    function getProfile(uint256 profileId)
        external
        view
        returns (
            uint64 xUserId,
            string memory xHandle,
            address mainWallet,
            address[] memory wallets,
            uint64 createdAt,
            bool hardcoreWarning
        )
    {
        _requireProfileExists(profileId);
        Profile storage p = _profiles[profileId];
        return (p.xUserId, p.xHandle, p.mainWallet, _profileWallets[profileId], p.createdAt, p.hardcoreWarning);
    }

    function getProfileWallets(uint256 profileId) external view returns (address[] memory) {
        _requireProfileExists(profileId);
        return _profileWallets[profileId];
    }

    function hasBond(uint256 profileId, uint256 bungalowId) external view returns (bool) {
        return bondActivated[profileId][bungalowId];
    }

    function getHeat(uint256 profileId, uint256 bungalowId) external view returns (uint256) {
        return heatScore[profileId][bungalowId];
    }

    function getProfileWarning(uint256 profileId) external view returns (bool) {
        _requireProfileExists(profileId);
        return _profiles[profileId].hardcoreWarning;
    }

    // ─────────────────────────────────────────────────────────────
    // Callbacks for other contracts
    // ─────────────────────────────────────────────────────────────

    function isWalletLinkedToProfile(uint256 profileId, address wallet) external view returns (bool) {
        return walletProfileId[wallet] == profileId && profileId != 0;
    }

    function getMainWallet(uint256 profileId) external view returns (address) {
        _requireProfileExists(profileId);
        return _profiles[profileId].mainWallet;
    }

    function profileExists(uint256 profileId) external view returns (bool) {
        return profileId != 0 && _profiles[profileId].id != 0;
    }

    // ─────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────

    function _callerProfileId() internal view returns (uint256 profileId) {
        profileId = walletProfileId[msg.sender];
        if (profileId == 0) revert Unauthorized();
    }

    function _linkWallet(uint256 profileId, address wallet) internal {
        walletProfileId[wallet] = profileId;
        _profileWallets[profileId].push(wallet);
        _walletIndex[profileId][wallet] = _profileWallets[profileId].length;
    }

    function _unlinkWallet(uint256 profileId, address wallet) internal {
        uint256 idx = _walletIndex[profileId][wallet];
        if (idx == 0) revert WalletNotLinked();
        uint256 last = _profileWallets[profileId].length;
        if (idx != last) {
            address lastWallet = _profileWallets[profileId][last - 1];
            _profileWallets[profileId][idx - 1] = lastWallet;
            _walletIndex[profileId][lastWallet] = idx;
        }
        _profileWallets[profileId].pop();
        delete _walletIndex[profileId][wallet];
        delete walletProfileId[wallet];
    }

    function _updateHeat(uint256 profileId, uint256 bungalowId, uint256 score) internal {
        heatScore[profileId][bungalowId] = score;
        _profiles[profileId].updatedAt = uint64(block.timestamp);
        emit HeatSynced(profileId, bungalowId, score);
    }

    function _consumeAttestation(bytes32 structHash, bytes calldata sig, uint256 deadline) internal {
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 digest = _hashTypedDataV4(structHash);
        if (usedDigests[digest]) revert AttestationAlreadyUsed();
        if (digest.recover(sig) != backendSigner) revert InvalidBackendSignature();
        usedDigests[digest] = true;
    }

    function _requireProfileExists(uint256 profileId) internal view {
        if (profileId == 0 || _profiles[profileId].id == 0) revert ProfileNotFound();
    }

    function _requireBoundedString(string memory s, uint256 minLen, uint256 maxLen) internal pure {
        uint256 len = bytes(s).length;
        if (len < minLen || len > maxLen) revert InvalidStringLength();
    }
}
