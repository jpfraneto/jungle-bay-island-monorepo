// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * MemeticsV2 — Jungle Bay Island
 *
 * Design goals:
 *   - One contract as the single write surface for profiles, bungalows,
 *     Bodega installs, commissions, and daily JBM claims.
 *   - Backend EIP-712 attestations are only required where off-chain truth is
 *     actually needed: handle ownership, heat-gated bungalow actions, and
 *     daily reward eligibility.
 *   - Profiles are keyed by profileId, not raw X handle strings.
 *   - Handles remain unique, mutable metadata.
 *   - Replay protection uses consumed EIP-712 digests with per-action salts,
 *     not a single sequential nonce that serializes all writes.
 *   - Rich content lives behind URIs. The contract stores relationships,
 *     permissions, payments, and hashes/anchors.
 */

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MemeticsV2 is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    uint256 public constant COMMISSION_FEE_BPS = 800;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    uint256 public constant HEAT_PETITION_SIGN = 50;
    uint256 public constant HEAT_BUNGALOW_SOLO = 65;
    uint256 public constant APES_BUNGALOW_THRESHOLD = 10;
    uint256 public constant PETITION_QUORUM = 5;

    uint256 public constant REVIEW_WINDOW = 3 days;

    uint256 public constant FLAG_BUNGALOW_CREATION_BLOCKED = 1 << 0;
    uint256 public constant FLAG_ARTIFACT_LISTING_BLOCKED = 1 << 1;
    uint256 public constant FLAG_REWARD_BLOCKED = 1 << 2;
    uint256 public constant FLAG_FROZEN = 1 << 3;

    uint256 public constant MAX_HANDLE_LENGTH = 15;
    uint256 public constant MAX_NAME_LENGTH = 80;
    uint256 public constant MAX_URI_LENGTH = 512;
    uint256 public constant MAX_ASSET_REF_LENGTH = 128;
    uint256 public constant MAX_LABEL_LENGTH = 64;

    // ---------------------------------------------------------------------
    // EIP-712 type hashes
    // ---------------------------------------------------------------------

    bytes32 public constant REGISTER_PROFILE_TYPEHASH =
        keccak256(
            "RegisterProfile(address wallet,bytes32 handleHash,uint256 heatScore,bytes32 salt,uint256 deadline)"
        );

    bytes32 public constant LINK_WALLET_TYPEHASH =
        keccak256(
            "LinkWallet(uint256 profileId,address wallet,uint256 heatScore,bytes32 salt,uint256 deadline)"
        );

    bytes32 public constant RENAME_HANDLE_TYPEHASH =
        keccak256(
            "RenameHandle(uint256 profileId,bytes32 oldHandleHash,bytes32 newHandleHash,uint256 heatScore,bytes32 salt,uint256 deadline)"
        );

    bytes32 public constant SYNC_HEAT_TYPEHASH =
        keccak256(
            "SyncHeat(uint256 profileId,uint256 heatScore,bytes32 salt,uint256 deadline)"
        );

    bytes32 public constant CLAIM_DAILY_MEMES_TYPEHASH =
        keccak256(
            "ClaimDailyMemes(uint256 profileId,address wallet,uint256 periodId,uint256 amount,uint256 heatScore,bytes32 salt,uint256 deadline)"
        );

    bytes32 public constant CREATE_BUNGALOW_PETITION_TYPEHASH =
        keccak256(
            "CreateBungalowPetition(uint256 profileId,address wallet,bytes32 bungalowNameHash,bytes32 metadataURIHash,uint8 primaryAssetChain,uint8 primaryAssetKind,bytes32 primaryAssetRefHash,uint256 heatScore,uint256 attestedApesBalance,bytes32 salt,uint256 deadline)"
        );

    bytes32 public constant SIGN_BUNGALOW_PETITION_TYPEHASH =
        keccak256(
            "SignBungalowPetition(uint256 profileId,address wallet,uint256 petitionId,uint256 heatScore,bytes32 salt,uint256 deadline)"
        );

    // ---------------------------------------------------------------------
    // Enums / structs
    // ---------------------------------------------------------------------

    enum AssetChain {
        BASE,
        ETHEREUM,
        SOLANA,
        OTHER
    }

    enum AssetKind {
        ERC20,
        ERC721,
        SPL_TOKEN,
        SPL_NFT,
        CUSTOM
    }

    enum PetitionStatus {
        ACTIVE,
        EXECUTED,
        CANCELLED
    }

    enum CommissionStatus {
        OPEN,
        CLAIMED,
        SUBMITTED,
        DISPUTED,
        COMPLETED,
        CANCELLED
    }

    struct Profile {
        uint256 id;
        bytes32 handleHash;
        string handle;
        address mainWallet;
        uint256 heatScore;
        uint256 flags;
        uint64 createdAt;
        uint64 updatedAt;
    }

    struct AssetRef {
        bytes32 assetKey;
        AssetChain chain;
        AssetKind kind;
        string reference;
        string label;
        bool active;
    }

    struct Bungalow {
        uint256 id;
        uint256 adminProfileId;
        string name;
        string metadataURI;
        bytes32 primaryAssetKey;
        bool active;
        uint64 createdAt;
    }

    struct Petition {
        uint256 id;
        uint256 proposerProfileId;
        string bungalowName;
        string metadataURI;
        bytes32 primaryAssetKey;
        AssetChain primaryAssetChain;
        AssetKind primaryAssetKind;
        string primaryAssetRef;
        PetitionStatus status;
        uint32 signerCount;
        uint64 createdAt;
    }

    struct Artifact {
        uint256 id;
        uint256 sellerProfileId;
        string uri;
        uint256 price;
        bool active;
        uint64 createdAt;
    }

    struct InstalledArtifact {
        uint256 artifactId;
        uint256 installerProfileId;
        bool banned;
        uint64 installedAt;
    }

    struct Commission {
        uint256 id;
        uint256 requesterProfileId;
        uint256 artistProfileId;
        string briefURI;
        string deliverableURI;
        uint256 budget;
        uint64 claimDeadline;
        uint64 deliveryDeadline;
        uint64 submittedAt;
        CommissionStatus status;
    }

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error Unauthorized();
    error InvalidAddress();
    error InvalidHandle();
    error InvalidAmount();
    error InvalidStringLength();
    error HandleUnavailable();
    error ProfileNotFound();
    error WalletAlreadyLinked();
    error WalletNotLinked();
    error LastWalletRemovalForbidden();
    error ReplacementMainWalletRequired();
    error SignatureExpired();
    error InvalidBackendSignature();
    error AttestationAlreadyUsed();
    error AlreadyClaimedPeriod();
    error CapabilityBlocked();
    error ProfileFrozen();
    error DuplicateAsset();
    error AssetNotFound();
    error UnknownPetition();
    error PetitionNotActive();
    error PetitionAlreadySigned();
    error PetitionCriteriaNotMet();
    error PrimaryAssetAlreadyClaimed();
    error ActivePetitionAlreadyExists();
    error UnknownBungalow();
    error InactiveBungalow();
    error UnknownArtifact();
    error ArtifactInactive();
    error ArtifactAlreadyInstalled();
    error UnknownCommission();
    error InvalidState();
    error InvalidTimeline();
    error NothingToResolve();

    // ---------------------------------------------------------------------
    // Immutable / state
    // ---------------------------------------------------------------------

    IERC20 public immutable jbmToken;
    address public backendSigner;

    uint256 public profileCount;
    uint256 public bungalowCount;
    uint256 public petitionCount;
    uint256 public artifactCount;
    uint256 public commissionCount;

    mapping(address => bool) public moderators;
    mapping(bytes32 => bool) public usedActionDigests;

    mapping(uint256 => Profile) private _profiles;
    mapping(bytes32 => uint256) public profileIdByHandleHash;
    mapping(address => uint256) public walletProfileId;
    mapping(uint256 => address[]) private _profileWallets;
    mapping(uint256 => mapping(address => uint256)) private _profileWalletIndex;

    mapping(uint256 => mapping(uint256 => bool)) public dailyClaimedByPeriod;

    mapping(uint256 => Bungalow) public bungalows;
    mapping(uint256 => AssetRef[]) private _bungalowAssets;
    mapping(uint256 => mapping(bytes32 => uint256)) private _bungalowAssetIndex;
    mapping(bytes32 => uint256) public bungalowIdByPrimaryAssetKey;

    mapping(uint256 => Petition) public petitions;
    mapping(uint256 => uint256[]) private _petitionSignerProfileIds;
    mapping(uint256 => mapping(uint256 => bool)) public petitionSignedByProfile;
    mapping(bytes32 => uint256) public activePetitionIdByPrimaryAssetKey;

    mapping(uint256 => Artifact) public artifacts;
    mapping(uint256 => InstalledArtifact[]) private _bungalowInstalledArtifacts;
    mapping(uint256 => mapping(uint256 => uint256)) private _bungalowInstalledArtifactIndex;

    mapping(uint256 => Commission) public commissions;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event BackendSignerUpdated(address indexed newSigner);
    event ModeratorUpdated(address indexed moderator, bool enabled);
    event ProfileFlagsUpdated(uint256 indexed profileId, uint256 previousFlags, uint256 newFlags);

    event ProfileRegistered(
        uint256 indexed profileId,
        bytes32 indexed handleHash,
        string handle,
        address indexed wallet,
        uint256 heatScore
    );
    event WalletLinked(uint256 indexed profileId, address indexed wallet);
    event WalletUnlinked(uint256 indexed profileId, address indexed wallet);
    event HandleUpdated(
        uint256 indexed profileId,
        bytes32 indexed oldHandleHash,
        bytes32 indexed newHandleHash,
        string newHandle
    );
    event MainWalletUpdated(uint256 indexed profileId, address indexed newMainWallet);
    event HeatSynced(uint256 indexed profileId, uint256 newHeatScore);
    event DailyMemesClaimed(
        uint256 indexed profileId,
        address indexed wallet,
        uint256 indexed periodId,
        uint256 amount
    );

    event PetitionCreated(
        uint256 indexed petitionId,
        uint256 indexed proposerProfileId,
        bytes32 indexed primaryAssetKey,
        string bungalowName
    );
    event PetitionSigned(uint256 indexed petitionId, uint256 indexed signerProfileId, uint256 signerCount);
    event PetitionCancelled(uint256 indexed petitionId);

    event BungalowCreated(
        uint256 indexed bungalowId,
        uint256 indexed adminProfileId,
        bytes32 indexed primaryAssetKey,
        string name
    );
    event BungalowMetadataUpdated(uint256 indexed bungalowId, string metadataURI);
    event BungalowAdminTransferred(
        uint256 indexed bungalowId,
        uint256 indexed previousAdminProfileId,
        uint256 indexed newAdminProfileId
    );
    event BungalowStatusUpdated(uint256 indexed bungalowId, bool active);
    event BungalowAssetAdded(
        uint256 indexed bungalowId,
        bytes32 indexed assetKey,
        AssetChain chain,
        AssetKind kind,
        string reference,
        string label
    );
    event BungalowAssetStatusUpdated(uint256 indexed bungalowId, bytes32 indexed assetKey, bool active);

    event ArtifactListed(
        uint256 indexed artifactId,
        uint256 indexed sellerProfileId,
        string uri,
        uint256 price
    );
    event ArtifactListingStatusUpdated(uint256 indexed artifactId, bool active);
    event ArtifactInstalled(
        uint256 indexed artifactId,
        uint256 indexed bungalowId,
        uint256 indexed installerProfileId
    );
    event InstalledArtifactStatusUpdated(uint256 indexed bungalowId, uint256 indexed artifactId, bool banned);

    event CommissionCreated(
        uint256 indexed commissionId,
        uint256 indexed requesterProfileId,
        uint256 budget,
        uint64 claimDeadline,
        uint64 deliveryDeadline,
        string briefURI
    );
    event CommissionClaimed(uint256 indexed commissionId, uint256 indexed artistProfileId);
    event CommissionSubmitted(uint256 indexed commissionId, uint256 indexed artistProfileId, string deliverableURI);
    event CommissionDisputed(uint256 indexed commissionId, uint256 indexed openedByProfileId, string disputeURI);
    event CommissionSettled(
        uint256 indexed commissionId,
        uint256 artistGrossPayout,
        uint256 requesterRefund,
        uint256 fee,
        CommissionStatus status
    );
    event CommissionCancelled(uint256 indexed commissionId);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyOwnerOrModerator() {
        if (msg.sender != owner() && !moderators[msg.sender]) {
            revert Unauthorized();
        }
        _;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address initialOwner, address jbmToken_, address backendSigner_)
        EIP712("Memetics", "2")
        Ownable(initialOwner)
    {
        if (initialOwner == address(0) || jbmToken_ == address(0) || backendSigner_ == address(0)) {
            revert InvalidAddress();
        }

        jbmToken = IERC20(jbmToken_);
        backendSigner = backendSigner_;
    }

    // ---------------------------------------------------------------------
    // Owner / moderation
    // ---------------------------------------------------------------------

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setBackendSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert InvalidAddress();
        backendSigner = newSigner;
        emit BackendSignerUpdated(newSigner);
    }

    function setModerator(address moderator, bool enabled) external onlyOwner {
        if (moderator == address(0)) revert InvalidAddress();
        moderators[moderator] = enabled;
        emit ModeratorUpdated(moderator, enabled);
    }

    function updateProfileFlags(uint256 profileId, uint256 mask, bool enabled) external onlyOwner {
        _requireProfileExists(profileId);

        uint256 previousFlags = _profiles[profileId].flags;
        uint256 newFlags = enabled ? (previousFlags | mask) : (previousFlags & ~mask);
        _profiles[profileId].flags = newFlags;

        emit ProfileFlagsUpdated(profileId, previousFlags, newFlags);
    }

    function adminSetBungalowStatus(uint256 bungalowId, bool active) external onlyOwnerOrModerator {
        _requireBungalowExists(bungalowId);
        bungalows[bungalowId].active = active;
        emit BungalowStatusUpdated(bungalowId, active);
    }

    function adminSetArtifactListingStatus(uint256 artifactId, bool active) external onlyOwnerOrModerator {
        _requireArtifactExists(artifactId);
        artifacts[artifactId].active = active;
        emit ArtifactListingStatusUpdated(artifactId, active);
    }

    function adminSetInstalledArtifactStatus(
        uint256 bungalowId,
        uint256 artifactId,
        bool banned
    ) external onlyOwnerOrModerator {
        _setInstalledArtifactStatus(bungalowId, artifactId, banned);
    }

    // ---------------------------------------------------------------------
    // Identity
    // ---------------------------------------------------------------------

    function registerProfile(
        string calldata handle,
        uint256 heatScore,
        bytes32 salt,
        uint256 deadline,
        bytes calldata sig
    ) external whenNotPaused returns (uint256 profileId) {
        if (walletProfileId[msg.sender] != 0) revert WalletAlreadyLinked();

        (string memory normalizedHandle, bytes32 handleHash) = _normalizeHandle(handle);
        if (profileIdByHandleHash[handleHash] != 0) revert HandleUnavailable();

        _consumeBackendAttestation(
            keccak256(
                abi.encode(
                    REGISTER_PROFILE_TYPEHASH,
                    msg.sender,
                    handleHash,
                    heatScore,
                    salt,
                    deadline
                )
            ),
            sig,
            deadline
        );

        profileId = ++profileCount;
        Profile storage p = _profiles[profileId];
        p.id = profileId;
        p.handleHash = handleHash;
        p.handle = normalizedHandle;
        p.mainWallet = msg.sender;
        p.heatScore = heatScore;
        p.createdAt = uint64(block.timestamp);
        p.updatedAt = uint64(block.timestamp);

        profileIdByHandleHash[handleHash] = profileId;
        _linkWallet(profileId, msg.sender);

        emit ProfileRegistered(profileId, handleHash, normalizedHandle, msg.sender, heatScore);
        emit HeatSynced(profileId, heatScore);
    }

    function linkWallet(
        uint256 profileId,
        uint256 heatScore,
        bytes32 salt,
        uint256 deadline,
        bytes calldata sig
    ) external whenNotPaused {
        if (walletProfileId[msg.sender] != 0) revert WalletAlreadyLinked();
        _requireProfileExists(profileId);
        _requireProfileNotFrozen(profileId);

        _consumeBackendAttestation(
            keccak256(
                abi.encode(
                    LINK_WALLET_TYPEHASH,
                    profileId,
                    msg.sender,
                    heatScore,
                    salt,
                    deadline
                )
            ),
            sig,
            deadline
        );

        _profiles[profileId].heatScore = heatScore;
        _profiles[profileId].updatedAt = uint64(block.timestamp);
        _linkWallet(profileId, msg.sender);

        emit WalletLinked(profileId, msg.sender);
        emit HeatSynced(profileId, heatScore);
    }

    function renameHandle(
        uint256 profileId,
        string calldata newHandle,
        uint256 heatScore,
        bytes32 salt,
        uint256 deadline,
        bytes calldata sig
    ) external whenNotPaused {
        _requireProfileWallet(profileId, msg.sender);
        _requireProfileNotFrozen(profileId);

        Profile storage p = _profiles[profileId];
        bytes32 oldHandleHash = p.handleHash;
        (string memory normalizedHandle, bytes32 newHandleHash) = _normalizeHandle(newHandle);

        if (oldHandleHash == newHandleHash) revert HandleUnavailable();

        uint256 existingProfileId = profileIdByHandleHash[newHandleHash];
        if (existingProfileId != 0 && existingProfileId != profileId) revert HandleUnavailable();

        _consumeBackendAttestation(
            keccak256(
                abi.encode(
                    RENAME_HANDLE_TYPEHASH,
                    profileId,
                    oldHandleHash,
                    newHandleHash,
                    heatScore,
                    salt,
                    deadline
                )
            ),
            sig,
            deadline
        );

        delete profileIdByHandleHash[oldHandleHash];
        profileIdByHandleHash[newHandleHash] = profileId;

        p.handleHash = newHandleHash;
        p.handle = normalizedHandle;
        p.heatScore = heatScore;
        p.updatedAt = uint64(block.timestamp);

        emit HandleUpdated(profileId, oldHandleHash, newHandleHash, normalizedHandle);
        emit HeatSynced(profileId, heatScore);
    }

    function setMainWallet(address newMainWallet) external whenNotPaused {
        uint256 profileId = walletProfileId[msg.sender];
        _requireProfileWallet(profileId, msg.sender);

        if (walletProfileId[newMainWallet] != profileId) revert WalletNotLinked();

        _profiles[profileId].mainWallet = newMainWallet;
        _profiles[profileId].updatedAt = uint64(block.timestamp);

        emit MainWalletUpdated(profileId, newMainWallet);
    }

    function unlinkWallet(address wallet, address replacementMainWallet) external whenNotPaused {
        uint256 profileId = walletProfileId[msg.sender];
        _requireProfileWallet(profileId, msg.sender);

        if (walletProfileId[wallet] != profileId) revert WalletNotLinked();
        if (_profileWallets[profileId].length <= 1) revert LastWalletRemovalForbidden();

        address currentMainWallet = _profiles[profileId].mainWallet;
        if (wallet == currentMainWallet) {
            if (replacementMainWallet == address(0) || replacementMainWallet == wallet) {
                revert ReplacementMainWalletRequired();
            }
            if (walletProfileId[replacementMainWallet] != profileId) revert WalletNotLinked();
            _profiles[profileId].mainWallet = replacementMainWallet;
            emit MainWalletUpdated(profileId, replacementMainWallet);
        }

        _unlinkWallet(profileId, wallet);
        _profiles[profileId].updatedAt = uint64(block.timestamp);

        emit WalletUnlinked(profileId, wallet);
    }

    function syncHeat(
        uint256 profileId,
        uint256 heatScore,
        bytes32 salt,
        uint256 deadline,
        bytes calldata sig
    ) external whenNotPaused {
        _requireProfileWallet(profileId, msg.sender);
        _requireProfileNotFrozen(profileId);

        _consumeBackendAttestation(
            keccak256(
                abi.encode(
                    SYNC_HEAT_TYPEHASH,
                    profileId,
                    heatScore,
                    salt,
                    deadline
                )
            ),
            sig,
            deadline
        );

        _profiles[profileId].heatScore = heatScore;
        _profiles[profileId].updatedAt = uint64(block.timestamp);

        emit HeatSynced(profileId, heatScore);
    }

    // ---------------------------------------------------------------------
    // Daily JBM claim
    // ---------------------------------------------------------------------

    function claimDailyMemes(
        uint256 periodId,
        uint256 amount,
        uint256 heatScore,
        bytes32 salt,
        uint256 deadline,
        bytes calldata sig
    ) external whenNotPaused nonReentrant {
        uint256 profileId = walletProfileId[msg.sender];
        _requireProfileWallet(profileId, msg.sender);
        _requireProfileNotFrozen(profileId);
        _requireProfileCapability(profileId, FLAG_REWARD_BLOCKED, false);

        if (dailyClaimedByPeriod[profileId][periodId]) revert AlreadyClaimedPeriod();

        _consumeBackendAttestation(
            keccak256(
                abi.encode(
                    CLAIM_DAILY_MEMES_TYPEHASH,
                    profileId,
                    msg.sender,
                    periodId,
                    amount,
                    heatScore,
                    salt,
                    deadline
                )
            ),
            sig,
            deadline
        );

        dailyClaimedByPeriod[profileId][periodId] = true;
        _profiles[profileId].heatScore = heatScore;
        _profiles[profileId].updatedAt = uint64(block.timestamp);

        jbmToken.safeTransfer(msg.sender, amount);

        emit HeatSynced(profileId, heatScore);
        emit DailyMemesClaimed(profileId, msg.sender, periodId, amount);
    }

    // ---------------------------------------------------------------------
    // Bungalows
    // ---------------------------------------------------------------------

    function createBungalowPetition(
        string calldata bungalowName,
        string calldata metadataURI,
        AssetChain primaryAssetChain,
        AssetKind primaryAssetKind,
        string calldata primaryAssetRef,
        uint256 heatScore,
        uint256 attestedApesBalance,
        bytes32 salt,
        uint256 deadline,
        bytes calldata sig
    ) external whenNotPaused returns (uint256 petitionId) {
        uint256 profileId = walletProfileId[msg.sender];
        _requireProfileWallet(profileId, msg.sender);
        _requireProfileNotFrozen(profileId);
        _requireProfileCapability(profileId, FLAG_BUNGALOW_CREATION_BLOCKED, false);

        _requireBoundedString(bungalowName, 1, MAX_NAME_LENGTH);
        _requireBoundedString(metadataURI, 0, MAX_URI_LENGTH);
        _requireBoundedString(primaryAssetRef, 1, MAX_ASSET_REF_LENGTH);

        if (
            heatScore < HEAT_PETITION_SIGN &&
            heatScore < HEAT_BUNGALOW_SOLO &&
            attestedApesBalance < APES_BUNGALOW_THRESHOLD
        ) {
            revert PetitionCriteriaNotMet();
        }

        bytes32 primaryAssetKey = _computeAssetKey(primaryAssetChain, primaryAssetKind, primaryAssetRef);
        if (bungalowIdByPrimaryAssetKey[primaryAssetKey] != 0) revert PrimaryAssetAlreadyClaimed();

        uint256 existingPetitionId = activePetitionIdByPrimaryAssetKey[primaryAssetKey];
        if (existingPetitionId != 0 && petitions[existingPetitionId].status == PetitionStatus.ACTIVE) {
            revert ActivePetitionAlreadyExists();
        }

        _consumeBackendAttestation(
            keccak256(
                abi.encode(
                    CREATE_BUNGALOW_PETITION_TYPEHASH,
                    profileId,
                    msg.sender,
                    keccak256(bytes(bungalowName)),
                    keccak256(bytes(metadataURI)),
                    uint8(primaryAssetChain),
                    uint8(primaryAssetKind),
                    keccak256(bytes(primaryAssetRef)),
                    heatScore,
                    attestedApesBalance,
                    salt,
                    deadline
                )
            ),
            sig,
            deadline
        );

        petitionId = ++petitionCount;
        petitions[petitionId] = Petition({
            id: petitionId,
            proposerProfileId: profileId,
            bungalowName: bungalowName,
            metadataURI: metadataURI,
            primaryAssetKey: primaryAssetKey,
            primaryAssetChain: primaryAssetChain,
            primaryAssetKind: primaryAssetKind,
            primaryAssetRef: primaryAssetRef,
            status: PetitionStatus.ACTIVE,
            signerCount: 0,
            createdAt: uint64(block.timestamp)
        });
        activePetitionIdByPrimaryAssetKey[primaryAssetKey] = petitionId;

        _profiles[profileId].heatScore = heatScore;
        _profiles[profileId].updatedAt = uint64(block.timestamp);

        emit PetitionCreated(petitionId, profileId, primaryAssetKey, bungalowName);
        emit HeatSynced(profileId, heatScore);

        if (heatScore >= HEAT_PETITION_SIGN) {
            _signPetition(petitionId, profileId);
        }

        if (heatScore >= HEAT_BUNGALOW_SOLO || attestedApesBalance >= APES_BUNGALOW_THRESHOLD) {
            _executePetition(petitionId);
        }
    }

    function signBungalowPetition(
        uint256 petitionId,
        uint256 heatScore,
        bytes32 salt,
        uint256 deadline,
        bytes calldata sig
    ) external whenNotPaused {
        Petition storage petition = petitions[petitionId];
        if (petition.id == 0) revert UnknownPetition();
        if (petition.status != PetitionStatus.ACTIVE) revert PetitionNotActive();

        uint256 profileId = walletProfileId[msg.sender];
        _requireProfileWallet(profileId, msg.sender);
        _requireProfileNotFrozen(profileId);
        _requireProfileCapability(profileId, FLAG_BUNGALOW_CREATION_BLOCKED, false);

        if (heatScore < HEAT_PETITION_SIGN) revert PetitionCriteriaNotMet();

        _consumeBackendAttestation(
            keccak256(
                abi.encode(
                    SIGN_BUNGALOW_PETITION_TYPEHASH,
                    profileId,
                    msg.sender,
                    petitionId,
                    heatScore,
                    salt,
                    deadline
                )
            ),
            sig,
            deadline
        );

        _profiles[profileId].heatScore = heatScore;
        _profiles[profileId].updatedAt = uint64(block.timestamp);
        emit HeatSynced(profileId, heatScore);

        _signPetition(petitionId, profileId);

        if (petitions[petitionId].signerCount >= PETITION_QUORUM) {
            _executePetition(petitionId);
        }
    }

    function cancelBungalowPetition(uint256 petitionId) external whenNotPaused {
        Petition storage petition = petitions[petitionId];
        if (petition.id == 0) revert UnknownPetition();
        if (petition.status != PetitionStatus.ACTIVE) revert PetitionNotActive();

        _requireProfileWallet(petition.proposerProfileId, msg.sender);

        petition.status = PetitionStatus.CANCELLED;
        delete activePetitionIdByPrimaryAssetKey[petition.primaryAssetKey];

        emit PetitionCancelled(petitionId);
    }

    function setBungalowMetadataURI(uint256 bungalowId, string calldata metadataURI) external whenNotPaused {
        _requireBungalowAdmin(bungalowId, msg.sender);
        _requireBoundedString(metadataURI, 0, MAX_URI_LENGTH);

        bungalows[bungalowId].metadataURI = metadataURI;
        emit BungalowMetadataUpdated(bungalowId, metadataURI);
    }

    function transferBungalowAdmin(uint256 bungalowId, uint256 newAdminProfileId) external whenNotPaused {
        _requireBungalowAdmin(bungalowId, msg.sender);
        _requireProfileExists(newAdminProfileId);
        _requireProfileNotFrozen(newAdminProfileId);

        uint256 previousAdminProfileId = bungalows[bungalowId].adminProfileId;
        bungalows[bungalowId].adminProfileId = newAdminProfileId;

        emit BungalowAdminTransferred(bungalowId, previousAdminProfileId, newAdminProfileId);
    }

    function addBungalowAsset(
        uint256 bungalowId,
        AssetChain chain,
        AssetKind kind,
        string calldata reference,
        string calldata label
    ) external whenNotPaused {
        _requireBungalowAdmin(bungalowId, msg.sender);
        _requireBoundedString(reference, 1, MAX_ASSET_REF_LENGTH);
        _requireBoundedString(label, 0, MAX_LABEL_LENGTH);

        bytes32 assetKey = _computeAssetKey(chain, kind, reference);
        if (_bungalowAssetIndex[bungalowId][assetKey] != 0) revert DuplicateAsset();

        _bungalowAssets[bungalowId].push(
            AssetRef({
                assetKey: assetKey,
                chain: chain,
                kind: kind,
                reference: reference,
                label: label,
                active: true
            })
        );
        _bungalowAssetIndex[bungalowId][assetKey] = _bungalowAssets[bungalowId].length;

        emit BungalowAssetAdded(bungalowId, assetKey, chain, kind, reference, label);
    }

    function setBungalowAssetStatus(uint256 bungalowId, bytes32 assetKey, bool active) external whenNotPaused {
        _requireBungalowAdmin(bungalowId, msg.sender);

        uint256 index = _bungalowAssetIndex[bungalowId][assetKey];
        if (index == 0) revert AssetNotFound();

        _bungalowAssets[bungalowId][index - 1].active = active;
        emit BungalowAssetStatusUpdated(bungalowId, assetKey, active);
    }

    // ---------------------------------------------------------------------
    // Bodega
    // ---------------------------------------------------------------------

    function listArtifact(string calldata uri, uint256 price) external whenNotPaused returns (uint256 artifactId) {
        uint256 profileId = walletProfileId[msg.sender];
        _requireProfileWallet(profileId, msg.sender);
        _requireProfileNotFrozen(profileId);
        _requireProfileCapability(profileId, FLAG_ARTIFACT_LISTING_BLOCKED, false);
        _requireBoundedString(uri, 1, MAX_URI_LENGTH);

        if (price == 0) revert InvalidAmount();

        artifactId = ++artifactCount;
        artifacts[artifactId] = Artifact({
            id: artifactId,
            sellerProfileId: profileId,
            uri: uri,
            price: price,
            active: true,
            createdAt: uint64(block.timestamp)
        });

        emit ArtifactListed(artifactId, profileId, uri, price);
    }

    function setArtifactListingStatus(uint256 artifactId, bool active) external whenNotPaused {
        _requireArtifactExists(artifactId);

        uint256 sellerProfileId = artifacts[artifactId].sellerProfileId;
        _requireProfileWallet(sellerProfileId, msg.sender);

        artifacts[artifactId].active = active;
        emit ArtifactListingStatusUpdated(artifactId, active);
    }

    function installArtifact(uint256 artifactId, uint256 bungalowId) external whenNotPaused nonReentrant {
        _requireArtifactExists(artifactId);
        _requireBungalowExists(bungalowId);

        Artifact storage artifact = artifacts[artifactId];
        Bungalow storage bungalow = bungalows[bungalowId];

        if (!artifact.active) revert ArtifactInactive();
        if (!bungalow.active) revert InactiveBungalow();
        if (_bungalowInstalledArtifactIndex[bungalowId][artifactId] != 0) revert ArtifactAlreadyInstalled();

        uint256 installerProfileId = walletProfileId[msg.sender];
        _requireProfileWallet(installerProfileId, msg.sender);
        _requireProfileNotFrozen(installerProfileId);

        address sellerMainWallet = _profiles[artifact.sellerProfileId].mainWallet;
        if (sellerMainWallet == address(0)) revert InvalidAddress();

        jbmToken.safeTransferFrom(msg.sender, sellerMainWallet, artifact.price);

        _bungalowInstalledArtifacts[bungalowId].push(
            InstalledArtifact({
                artifactId: artifactId,
                installerProfileId: installerProfileId,
                banned: false,
                installedAt: uint64(block.timestamp)
            })
        );
        _bungalowInstalledArtifactIndex[bungalowId][artifactId] = _bungalowInstalledArtifacts[bungalowId].length;

        emit ArtifactInstalled(artifactId, bungalowId, installerProfileId);
    }

    function setInstalledArtifactStatus(
        uint256 bungalowId,
        uint256 artifactId,
        bool banned
    ) external whenNotPaused {
        _requireBungalowAdmin(bungalowId, msg.sender);
        _setInstalledArtifactStatus(bungalowId, artifactId, banned);
    }

    // ---------------------------------------------------------------------
    // Commissions
    // ---------------------------------------------------------------------

    function createCommission(
        string calldata briefURI,
        uint256 budget,
        uint64 claimDeadline,
        uint64 deliveryDeadline
    ) external whenNotPaused nonReentrant returns (uint256 commissionId) {
        uint256 requesterProfileId = walletProfileId[msg.sender];
        _requireProfileWallet(requesterProfileId, msg.sender);
        _requireProfileNotFrozen(requesterProfileId);
        _requireBoundedString(briefURI, 1, MAX_URI_LENGTH);

        if (budget == 0) revert InvalidAmount();
        if (
            claimDeadline <= block.timestamp ||
            deliveryDeadline <= claimDeadline
        ) {
            revert InvalidTimeline();
        }

        jbmToken.safeTransferFrom(msg.sender, address(this), budget);

        commissionId = ++commissionCount;
        commissions[commissionId] = Commission({
            id: commissionId,
            requesterProfileId: requesterProfileId,
            artistProfileId: 0,
            briefURI: briefURI,
            deliverableURI: "",
            budget: budget,
            claimDeadline: claimDeadline,
            deliveryDeadline: deliveryDeadline,
            submittedAt: 0,
            status: CommissionStatus.OPEN
        });

        emit CommissionCreated(
            commissionId,
            requesterProfileId,
            budget,
            claimDeadline,
            deliveryDeadline,
            briefURI
        );
    }

    function claimCommission(uint256 commissionId) external whenNotPaused {
        Commission storage commission = commissions[commissionId];
        if (commission.id == 0) revert UnknownCommission();
        if (commission.status != CommissionStatus.OPEN) revert InvalidState();
        if (block.timestamp > commission.claimDeadline) revert InvalidTimeline();

        uint256 artistProfileId = walletProfileId[msg.sender];
        _requireProfileWallet(artistProfileId, msg.sender);
        _requireProfileNotFrozen(artistProfileId);

        if (artistProfileId == commission.requesterProfileId) revert Unauthorized();

        commission.artistProfileId = artistProfileId;
        commission.status = CommissionStatus.CLAIMED;

        emit CommissionClaimed(commissionId, artistProfileId);
    }

    function submitCommission(
        uint256 commissionId,
        string calldata deliverableURI
    ) external whenNotPaused {
        Commission storage commission = commissions[commissionId];
        if (commission.id == 0) revert UnknownCommission();
        if (commission.status != CommissionStatus.CLAIMED) revert InvalidState();
        if (block.timestamp > commission.deliveryDeadline) revert InvalidTimeline();

        _requireProfileWallet(commission.artistProfileId, msg.sender);
        _requireBoundedString(deliverableURI, 1, MAX_URI_LENGTH);

        commission.deliverableURI = deliverableURI;
        commission.submittedAt = uint64(block.timestamp);
        commission.status = CommissionStatus.SUBMITTED;

        emit CommissionSubmitted(commissionId, commission.artistProfileId, deliverableURI);
    }

    function approveCommission(uint256 commissionId) external whenNotPaused nonReentrant {
        Commission storage commission = commissions[commissionId];
        if (commission.id == 0) revert UnknownCommission();
        if (commission.status != CommissionStatus.SUBMITTED) revert InvalidState();

        _requireProfileWallet(commission.requesterProfileId, msg.sender);
        _settleCommission(commissionId, commission.budget, 0, CommissionStatus.COMPLETED);
    }

    function cancelCommission(uint256 commissionId) external whenNotPaused nonReentrant {
        Commission storage commission = commissions[commissionId];
        if (commission.id == 0) revert UnknownCommission();

        _requireProfileWallet(commission.requesterProfileId, msg.sender);

        if (commission.status == CommissionStatus.OPEN) {
            _settleCommission(commissionId, 0, commission.budget, CommissionStatus.CANCELLED);
            emit CommissionCancelled(commissionId);
            return;
        }

        if (
            commission.status == CommissionStatus.CLAIMED &&
            block.timestamp > commission.deliveryDeadline
        ) {
            _settleCommission(commissionId, 0, commission.budget, CommissionStatus.CANCELLED);
            emit CommissionCancelled(commissionId);
            return;
        }

        revert InvalidState();
    }

    function openCommissionDispute(
        uint256 commissionId,
        string calldata disputeURI
    ) external whenNotPaused {
        Commission storage commission = commissions[commissionId];
        if (commission.id == 0) revert UnknownCommission();
        if (
            commission.status != CommissionStatus.CLAIMED &&
            commission.status != CommissionStatus.SUBMITTED
        ) {
            revert InvalidState();
        }

        uint256 callerProfileId = walletProfileId[msg.sender];
        _requireProfileWallet(callerProfileId, msg.sender);

        if (
            callerProfileId != commission.requesterProfileId &&
            callerProfileId != commission.artistProfileId
        ) {
            revert Unauthorized();
        }

        _requireBoundedString(disputeURI, 0, MAX_URI_LENGTH);

        commission.status = CommissionStatus.DISPUTED;
        emit CommissionDisputed(commissionId, callerProfileId, disputeURI);
    }

    function resolveCommissionDispute(
        uint256 commissionId,
        uint256 artistGrossPayout,
        uint256 requesterRefund
    ) external onlyOwner nonReentrant {
        Commission storage commission = commissions[commissionId];
        if (commission.id == 0) revert UnknownCommission();
        if (commission.status != CommissionStatus.DISPUTED) revert InvalidState();
        if (artistGrossPayout + requesterRefund > commission.budget) revert NothingToResolve();

        CommissionStatus finalStatus = artistGrossPayout > 0
            ? CommissionStatus.COMPLETED
            : CommissionStatus.CANCELLED;

        _settleCommission(commissionId, artistGrossPayout, requesterRefund, finalStatus);
    }

    function claimTimedOutCommissionPayout(uint256 commissionId) external whenNotPaused nonReentrant {
        Commission storage commission = commissions[commissionId];
        if (commission.id == 0) revert UnknownCommission();
        if (commission.status != CommissionStatus.SUBMITTED) revert InvalidState();
        if (block.timestamp < uint256(commission.submittedAt) + REVIEW_WINDOW) revert InvalidTimeline();

        _requireProfileWallet(commission.artistProfileId, msg.sender);
        _settleCommission(commissionId, commission.budget, 0, CommissionStatus.COMPLETED);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getProfile(uint256 profileId)
        external
        view
        returns (
            bytes32 handleHash,
            string memory handle,
            address mainWallet,
            uint256 heatScore,
            uint256 flags,
            uint64 createdAt,
            uint64 updatedAt,
            address[] memory wallets
        )
    {
        _requireProfileExists(profileId);
        Profile storage p = _profiles[profileId];
        return (
            p.handleHash,
            p.handle,
            p.mainWallet,
            p.heatScore,
            p.flags,
            p.createdAt,
            p.updatedAt,
            _profileWallets[profileId]
        );
    }

    function getProfileWallets(uint256 profileId) external view returns (address[] memory) {
        _requireProfileExists(profileId);
        return _profileWallets[profileId];
    }

    function getBungalowAssets(uint256 bungalowId) external view returns (AssetRef[] memory) {
        _requireBungalowExists(bungalowId);
        return _bungalowAssets[bungalowId];
    }

    function getPetitionSigners(uint256 petitionId) external view returns (uint256[] memory) {
        if (petitions[petitionId].id == 0) revert UnknownPetition();
        return _petitionSignerProfileIds[petitionId];
    }

    function getBungalowInstalledArtifacts(
        uint256 bungalowId
    ) external view returns (InstalledArtifact[] memory) {
        _requireBungalowExists(bungalowId);
        return _bungalowInstalledArtifacts[bungalowId];
    }

    function getHandleHash(string calldata handle) external pure returns (bytes32) {
        (, bytes32 handleHash) = _normalizeHandle(handle);
        return handleHash;
    }

    function getPrimaryAssetKey(
        AssetChain chain,
        AssetKind kind,
        string calldata reference
    ) external pure returns (bytes32) {
        return _computeAssetKey(chain, kind, reference);
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _consumeBackendAttestation(
        bytes32 structHash,
        bytes calldata sig,
        uint256 deadline
    ) internal {
        if (block.timestamp > deadline) revert SignatureExpired();

        bytes32 digest = _hashTypedDataV4(structHash);
        if (usedActionDigests[digest]) revert AttestationAlreadyUsed();

        address recovered = digest.recover(sig);
        if (recovered != backendSigner) revert InvalidBackendSignature();

        usedActionDigests[digest] = true;
    }

    function _linkWallet(uint256 profileId, address wallet) internal {
        walletProfileId[wallet] = profileId;
        _profileWallets[profileId].push(wallet);
        _profileWalletIndex[profileId][wallet] = _profileWallets[profileId].length;
    }

    function _unlinkWallet(uint256 profileId, address wallet) internal {
        uint256 index = _profileWalletIndex[profileId][wallet];
        if (index == 0) revert WalletNotLinked();

        uint256 lastIndex = _profileWallets[profileId].length;
        if (index != lastIndex) {
            address lastWallet = _profileWallets[profileId][lastIndex - 1];
            _profileWallets[profileId][index - 1] = lastWallet;
            _profileWalletIndex[profileId][lastWallet] = index;
        }

        _profileWallets[profileId].pop();
        delete _profileWalletIndex[profileId][wallet];
        delete walletProfileId[wallet];
    }

    function _signPetition(uint256 petitionId, uint256 profileId) internal {
        if (petitionSignedByProfile[petitionId][profileId]) revert PetitionAlreadySigned();

        petitionSignedByProfile[petitionId][profileId] = true;
        _petitionSignerProfileIds[petitionId].push(profileId);
        petitions[petitionId].signerCount += 1;

        emit PetitionSigned(petitionId, profileId, petitions[petitionId].signerCount);
    }

    function _executePetition(uint256 petitionId) internal {
        Petition storage petition = petitions[petitionId];
        if (petition.status != PetitionStatus.ACTIVE) revert PetitionNotActive();

        petition.status = PetitionStatus.EXECUTED;
        delete activePetitionIdByPrimaryAssetKey[petition.primaryAssetKey];

        uint256 bungalowId = ++bungalowCount;
        bungalows[bungalowId] = Bungalow({
            id: bungalowId,
            adminProfileId: petition.proposerProfileId,
            name: petition.bungalowName,
            metadataURI: petition.metadataURI,
            primaryAssetKey: petition.primaryAssetKey,
            active: true,
            createdAt: uint64(block.timestamp)
        });
        bungalowIdByPrimaryAssetKey[petition.primaryAssetKey] = bungalowId;

        _bungalowAssets[bungalowId].push(
            AssetRef({
                assetKey: petition.primaryAssetKey,
                chain: petition.primaryAssetChain,
                kind: petition.primaryAssetKind,
                reference: petition.primaryAssetRef,
                label: "primary",
                active: true
            })
        );
        _bungalowAssetIndex[bungalowId][petition.primaryAssetKey] = 1;

        emit BungalowCreated(
            bungalowId,
            petition.proposerProfileId,
            petition.primaryAssetKey,
            petition.bungalowName
        );
    }

    function _settleCommission(
        uint256 commissionId,
        uint256 artistGrossPayout,
        uint256 requesterRefund,
        CommissionStatus finalStatus
    ) internal {
        Commission storage commission = commissions[commissionId];
        if (
            finalStatus != CommissionStatus.COMPLETED &&
            finalStatus != CommissionStatus.CANCELLED
        ) {
            revert InvalidState();
        }

        uint256 budget = commission.budget;
        if (artistGrossPayout + requesterRefund > budget) revert NothingToResolve();

        uint256 fee = (artistGrossPayout * COMMISSION_FEE_BPS) / BPS_DENOMINATOR;
        uint256 artistNetPayout = artistGrossPayout - fee;
        uint256 requesterNetRefund = requesterRefund + (budget - artistGrossPayout - requesterRefund);

        if (artistGrossPayout > 0) {
            if (commission.artistProfileId == 0) revert InvalidState();
            address artistMainWallet = _profiles[commission.artistProfileId].mainWallet;
            if (artistMainWallet == address(0)) revert InvalidAddress();

            if (fee > 0) {
                jbmToken.safeTransfer(owner(), fee);
            }
            if (artistNetPayout > 0) {
                jbmToken.safeTransfer(artistMainWallet, artistNetPayout);
            }
        }

        if (requesterNetRefund > 0) {
            address requesterMainWallet = _profiles[commission.requesterProfileId].mainWallet;
            if (requesterMainWallet == address(0)) revert InvalidAddress();
            jbmToken.safeTransfer(requesterMainWallet, requesterNetRefund);
        }

        commission.status = finalStatus;

        emit CommissionSettled(
            commissionId,
            artistGrossPayout,
            requesterNetRefund,
            fee,
            finalStatus
        );
    }

    function _setInstalledArtifactStatus(
        uint256 bungalowId,
        uint256 artifactId,
        bool banned
    ) internal {
        _requireBungalowExists(bungalowId);
        uint256 index = _bungalowInstalledArtifactIndex[bungalowId][artifactId];
        if (index == 0) revert UnknownArtifact();

        _bungalowInstalledArtifacts[bungalowId][index - 1].banned = banned;
        emit InstalledArtifactStatusUpdated(bungalowId, artifactId, banned);
    }

    function _requireProfileExists(uint256 profileId) internal view {
        if (profileId == 0 || _profiles[profileId].id == 0) revert ProfileNotFound();
    }

    function _requireProfileWallet(uint256 profileId, address wallet) internal view {
        _requireProfileExists(profileId);
        if (walletProfileId[wallet] != profileId) revert Unauthorized();
    }

    function _requireProfileNotFrozen(uint256 profileId) internal view {
        if ((_profiles[profileId].flags & FLAG_FROZEN) != 0) revert ProfileFrozen();
    }

    function _requireProfileCapability(uint256 profileId, uint256 mask, bool required) internal view {
        bool enabled = (_profiles[profileId].flags & mask) != 0;
        if (required != enabled) revert CapabilityBlocked();
    }

    function _requireBungalowExists(uint256 bungalowId) internal view {
        if (bungalowId == 0 || bungalows[bungalowId].id == 0) revert UnknownBungalow();
    }

    function _requireBungalowAdmin(uint256 bungalowId, address wallet) internal view {
        _requireBungalowExists(bungalowId);
        if (!bungalows[bungalowId].active) revert InactiveBungalow();
        _requireProfileWallet(bungalows[bungalowId].adminProfileId, wallet);
        _requireProfileNotFrozen(bungalows[bungalowId].adminProfileId);
    }

    function _requireArtifactExists(uint256 artifactId) internal view {
        if (artifactId == 0 || artifacts[artifactId].id == 0) revert UnknownArtifact();
    }

    function _requireBoundedString(
        string memory value,
        uint256 minLen,
        uint256 maxLen
    ) internal pure {
        uint256 len = bytes(value).length;
        if (len < minLen || len > maxLen) revert InvalidStringLength();
    }

    function _computeAssetKey(
        AssetChain chain,
        AssetKind kind,
        string memory reference
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(chain, kind, keccak256(bytes(reference))));
    }

    function _normalizeHandle(
        string memory handle
    ) internal pure returns (string memory normalizedHandle, bytes32 handleHash) {
        bytes memory raw = bytes(handle);
        uint256 len = raw.length;
        if (len == 0 || len > MAX_HANDLE_LENGTH) revert InvalidHandle();

        bytes memory normalized = new bytes(len);
        for (uint256 i = 0; i < len; ++i) {
            bytes1 char = raw[i];

            if (char >= 0x41 && char <= 0x5A) {
                char = bytes1(uint8(char) + 32);
            }

            bool isLowerAlpha = char >= 0x61 && char <= 0x7A;
            bool isNumber = char >= 0x30 && char <= 0x39;
            bool isUnderscore = char == 0x5f;

            if (!isLowerAlpha && !isNumber && !isUnderscore) {
                revert InvalidHandle();
            }

            normalized[i] = char;
        }

        normalizedHandle = string(normalized);
        handleHash = keccak256(normalized);
    }
}
