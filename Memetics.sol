// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ███╗   ███╗███████╗███╗   ███╗███████╗████████╗██╗ ██████╗███████╗
 * ████╗ ████║██╔════╝████╗ ████║██╔════╝╚══██╔══╝██║██╔════╝██╔════╝
 * ██╔████╔██║█████╗  ██╔████╔██║█████╗     ██║   ██║██║     ███████╗
 * ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║██╔══╝     ██║   ██║██║     ╚════██║
 * ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║███████╗   ██║   ██║╚██████╗███████║
 * ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝╚══════╝   ╚═╝   ╚═╝ ╚═════╝╚══════╝
 *
 * MemeticsV1 — Jungle Bay Island
 * Identity · Bungalows · Bodega · Commissions · Daily Claims
 *
 * Architecture:
 *   - Every write action carries a backend EIP-712 signature that encodes the
 *     caller's current heat score alongside any action-specific data.
 *   - The backend is the sole trusted oracle for heat score and off-chain
 *     attestations (e.g. Jungle Bay Ape ownership on Ethereum mainnet).
 *   - Nonces are per-handle to enable parallel wallet transactions while
 *     still preventing replays.
 *   - Commission budgets are escrowed in the contract on creation.
 *   - 8% platform fee on commission payouts routed to contract owner.
 */

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MemeticsV1 is EIP712, Ownable, ReentrancyGuard {
    using ECDSA for bytes32;

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Platform fee: 8% of commission budget
    uint256 public constant COMMISSION_FEE_BPS = 800;
    uint256 public constant BPS_DENOMINATOR    = 10_000;

    /// @dev Heat thresholds
    uint256 public constant HEAT_PETITION_SIGN     = 50;  // min heat to sign a petition
    uint256 public constant HEAT_BUNGALOW_SOLO      = 65;  // solo bungalow creation shortcut
    uint256 public constant APES_BUNGALOW_THRESHOLD = 10;  // apes shortcut (backend-attested)
    uint256 public constant PETITION_QUORUM         = 5;   // signers required

    // ─────────────────────────────────────────────────────────────────────────
    // EIP-712 Type Hashes
    // ─────────────────────────────────────────────────────────────────────────

    bytes32 public constant VERIFY_WALLET_TYPEHASH =
        keccak256("VerifyWallet(string handle,address wallet,uint256 heatScore,uint256 nonce)");

    bytes32 public constant SET_MAIN_WALLET_TYPEHASH =
        keccak256("SetMainWallet(string handle,address callerWallet,address mainWallet,uint256 heatScore,uint256 nonce)");

    bytes32 public constant CLAIM_MEMES_TYPEHASH =
        keccak256("ClaimMemes(string handle,address wallet,uint256 heatScore,uint256 amount,uint256 nonce)");

    bytes32 public constant CREATE_BUNGALOW_TYPEHASH =
        keccak256("CreateBungalow(string handle,address wallet,uint256 heatScore,string bungalowName,bool ownsEnoughApes,uint256 nonce)");

    bytes32 public constant SIGN_PETITION_TYPEHASH =
        keccak256("SignPetition(string handle,address wallet,uint256 heatScore,uint256 petitionId,uint256 nonce)");

    bytes32 public constant ADD_COLLECTION_TYPEHASH =
        keccak256("AddCollection(string handle,address wallet,uint256 heatScore,uint256 bungalowId,uint8 collectionType,string collectionAddress,uint256 nonce)");

    bytes32 public constant LIST_ARTIFACT_TYPEHASH =
        keccak256("ListArtifact(string handle,address wallet,uint256 heatScore,string link,uint256 price,uint256 nonce)");

    bytes32 public constant INSTALL_ARTIFACT_TYPEHASH =
        keccak256("InstallArtifact(string handle,address wallet,uint256 heatScore,uint256 artifactId,uint256 bungalowId,uint256 nonce)");

    bytes32 public constant CREATE_COMMISSION_TYPEHASH =
        keccak256("CreateCommission(string handle,address wallet,uint256 heatScore,string prompt,uint256 budget,uint256 deadline,uint256 nonce)");

    bytes32 public constant CLAIM_COMMISSION_TYPEHASH =
        keccak256("ClaimCommission(string handle,address wallet,uint256 heatScore,uint256 commissionId,uint256 nonce)");

    // ─────────────────────────────────────────────────────────────────────────
    // Structs
    // ─────────────────────────────────────────────────────────────────────────

    struct UserProfile {
        string   handle;
        address[] wallets;
        address  mainWallet;
        uint256  heatScore;
        uint256  nonce;       // incremented per-handle on every write
        bool     blocked;
    }

    /// @notice A token or NFT collection reference attached to a bungalow.
    ///         collectionAddress is intentionally a string to accommodate
    ///         Base EVM hex addresses, Ethereum ERC-721 addresses, and
    ///         Solana base-58 pubkeys in a single field.
    enum CollectionType { ERC20_BASE, SOLANA_TOKEN, ETH_ERC721, CUSTOM }

    struct Collection {
        CollectionType collectionType;
        string         collectionAddress;
        string         label; // optional human-readable name
    }

    struct Bungalow {
        uint256      id;
        string       name;
        address      admin;        // admin wallet (must be a verified wallet)
        string       adminHandle;
        bool         active;
        uint256      createdAt;
    }

    struct Petition {
        uint256  id;
        string   proposerHandle;
        string   bungalowName;
        bool     executed;
    }

    struct Artifact {
        uint256 id;
        string  sellerHandle;
        string  link;
        uint256 price;  // in JBM (wei-denominated)
        bool    active;
    }

    struct BungalowArtifact {
        uint256 artifactId;
        string  installerHandle;
        bool    downvoted; // false = active/upvoted (default), true = banned from this bungalow
    }

    enum CommissionStatus { OPEN, CLAIMED, COMPLETED, CANCELLED }

    struct Commission {
        uint256          id;
        string           requesterHandle;
        string           artistHandle;
        string           prompt;
        uint256          budget;
        uint256          deadline;
        CommissionStatus status;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    IERC20  public immutable jbmToken;
    address public           backendSigner;

    // Identity
    mapping(string  => UserProfile)  private _profiles;       // handle → profile
    mapping(address => string)       public  walletToHandle;  // wallet → handle
    mapping(address => bool)         public  isVerifiedWallet;

    // Bungalows
    uint256                              public bungalowCount;
    mapping(uint256 => Bungalow)         public bungalows;
    mapping(uint256 => Collection[])     public bungalowCollections;

    // Petitions
    uint256                                          public  petitionCount;
    mapping(uint256 => Petition)                     public  petitions;
    mapping(uint256 => address[])                    public  petitionSignerWallets;
    mapping(uint256 => mapping(string => bool))      private _petitionHasSigned; // petitionId → handle → signed

    // Bodega
    uint256                                              public artifactCount;
    mapping(uint256 => Artifact)                         public artifacts;
    mapping(uint256 => BungalowArtifact[])               public bungalowArtifacts;
    mapping(uint256 => mapping(uint256 => uint256))      public bungalowArtifactIdx; // bungalowId → artifactId → 1-based index

    // Commissions
    uint256                          public commissionCount;
    mapping(uint256 => Commission)   public commissions;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event WalletVerified        (string indexed handle, address indexed wallet, uint256 heatScore);
    event HeatScoreUpdated      (string indexed handle, uint256 newScore);
    event MainWalletSet         (string indexed handle, address mainWallet);
    event MemesClaimed          (string indexed handle, address indexed wallet, uint256 amount);

    event PetitionCreated       (uint256 indexed petitionId, string proposerHandle, string bungalowName);
    event PetitionSigned        (uint256 indexed petitionId, string signerHandle, uint256 signerCount);
    event BungalowCreated       (uint256 indexed bungalowId, string name, address admin, string adminHandle);
    event CollectionAdded       (uint256 indexed bungalowId, CollectionType collectionType, string collectionAddress);

    event ArtifactListed        (uint256 indexed artifactId, string sellerHandle, string link, uint256 price);
    event ArtifactInstalled     (uint256 indexed artifactId, uint256 indexed bungalowId, string installerHandle);
    event ArtifactStatusChanged (uint256 indexed artifactId, uint256 indexed bungalowId, bool downvoted);
    event ArtifactRemovedBodega (uint256 indexed artifactId);

    event CommissionCreated     (uint256 indexed commissionId, string requesterHandle, uint256 budget, uint256 deadline);
    event CommissionClaimed     (uint256 indexed commissionId, string artistHandle);
    event CommissionCompleted   (uint256 indexed commissionId, uint256 artistPayment, uint256 fee);
    event CommissionCancelled   (uint256 indexed commissionId);

    event UserBlocked           (string indexed handle, bool blocked);
    event BackendSignerUpdated  (address indexed newSigner);

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(address _jbmToken, address _backendSigner)
        EIP712("Memetics", "1")
        Ownable(msg.sender)
    {
        require(_jbmToken      != address(0), "zero token");
        require(_backendSigner != address(0), "zero signer");
        jbmToken      = IERC20(_jbmToken);
        backendSigner = _backendSigner;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin — Owner-only governance
    // ─────────────────────────────────────────────────────────────────────────

    function setBackendSigner(address _signer) external onlyOwner {
        require(_signer != address(0), "zero signer");
        backendSigner = _signer;
        emit BackendSignerUpdated(_signer);
    }

    /// @notice Block or unblock a user from creating bungalows / listing artifacts.
    function setUserBlocked(string calldata handle, bool blocked) external onlyOwner {
        _profiles[handle].blocked = blocked;
        emit UserBlocked(handle, blocked);
    }

    /// @notice Admin can permanently remove an artifact from the Bodega.
    function adminRemoveArtifact(uint256 artifactId) external onlyOwner {
        require(artifacts[artifactId].id != 0, "no such artifact");
        artifacts[artifactId].active = false;
        emit ArtifactRemovedBodega(artifactId);
    }

    /// @notice Admin can ban an artifact from a specific bungalow.
    function adminBanFromBungalow(uint256 bungalowId, uint256 artifactId) external onlyOwner {
        _setArtifactDownvote(bungalowId, artifactId, true);
    }

    /// @notice Admin can deactivate a bungalow.
    function adminDeactivateBungalow(uint256 bungalowId) external onlyOwner {
        bungalows[bungalowId].active = false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Identity — verifyWallet
    //
    // The first wallet verification for a handle is when the handle is
    // registered on-chain. Subsequent calls add additional wallets.
    // The backend always signs with the caller's current heat score.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Link msg.sender to a given X handle, verified by backend signature.
     *         First call for a handle registers it; subsequent calls add wallets.
     * @param handle     X handle (without @)
     * @param heatScore  Caller's current heat score from backend
     * @param sig        Backend EIP-712 signature
     */
    function verifyWallet(
        string calldata handle,
        uint256 heatScore,
        bytes calldata sig
    ) external {
        require(bytes(handle).length > 0, "empty handle");
        require(!isVerifiedWallet[msg.sender], "already verified");

        string memory h = _lower(handle);
        uint256 nonce = _profiles[h].nonce;

        _requireBackendSig(
            keccak256(abi.encode(
                VERIFY_WALLET_TYPEHASH,
                keccak256(bytes(h)),
                msg.sender,
                heatScore,
                nonce
            )),
            sig
        );
        _profiles[h].nonce++;

        // First wallet → register the handle
        if (_profiles[h].wallets.length == 0) {
            _profiles[h].handle     = h;
            _profiles[h].mainWallet = msg.sender;
        }
        _profiles[h].wallets.push(msg.sender);
        _profiles[h].heatScore = heatScore;

        walletToHandle[msg.sender] = h;
        isVerifiedWallet[msg.sender] = true;

        emit WalletVerified(h, msg.sender, heatScore);
        emit HeatScoreUpdated(h, heatScore);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Identity — setMainWallet
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Designate which verified wallet receives commission payouts.
     *         The target wallet must already be linked to the same handle.
     */
    function setMainWallet(
        address mainWallet,
        uint256 heatScore,
        bytes calldata sig
    ) external {
        string memory h = _handleOf(msg.sender);
        require(isVerifiedWallet[mainWallet], "target not verified");
        require(
            _strEq(walletToHandle[mainWallet], h),
            "wallet belongs to another handle"
        );

        _requireBackendSig(
            keccak256(abi.encode(
                SET_MAIN_WALLET_TYPEHASH,
                keccak256(bytes(h)),
                msg.sender,
                mainWallet,
                heatScore,
                _profiles[h].nonce
            )),
            sig
        );
        _profiles[h].nonce++;
        _updateHeat(h, heatScore);

        _profiles[h].mainWallet = mainWallet;
        emit MainWalletSet(h, mainWallet);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Daily JBM Claim
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Claim a daily JBM allocation. Amount and eligibility are
     *         determined off-chain; the backend encodes them in the signature.
     *         Heat score is updated as part of this action.
     */
    function claimDailyMemes(
        uint256 amount,
        uint256 heatScore,
        bytes calldata sig
    ) external nonReentrant {
        string memory h = _handleOf(msg.sender);
        _requireNotBlocked(h);

        _requireBackendSig(
            keccak256(abi.encode(
                CLAIM_MEMES_TYPEHASH,
                keccak256(bytes(h)),
                msg.sender,
                heatScore,
                amount,
                _profiles[h].nonce
            )),
            sig
        );
        _profiles[h].nonce++;
        _updateHeat(h, heatScore);

        require(jbmToken.transfer(msg.sender, amount), "transfer failed");
        emit MemesClaimed(h, msg.sender, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Bungalows — Petition to create
    //
    // Three paths to bungalow creation:
    //   A) proposer has heatScore > 65      → instant creation
    //   B) backend attests ownsEnoughApes   → instant creation
    //   C) 5 separate users with heat > 50  → creation on 5th signature
    //
    // The backend signature encodes both heatScore and ownsEnoughApes so the
    // contract can trust those values without on-chain NFT calls across chains.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Propose a new bungalow. May instantly create it if the proposer
     *         meets the solo eligibility criteria.
     */
    function createBungalowPetition(
        string calldata bungalowName,
        uint256 heatScore,
        bool ownsEnoughApes,
        bytes calldata sig
    ) external returns (uint256 petitionId) {
        require(bytes(bungalowName).length > 0, "empty name");
        string memory h = _handleOf(msg.sender);
        _requireNotBlocked(h);

        _requireBackendSig(
            keccak256(abi.encode(
                CREATE_BUNGALOW_TYPEHASH,
                keccak256(bytes(h)),
                msg.sender,
                heatScore,
                keccak256(bytes(bungalowName)),
                ownsEnoughApes,
                _profiles[h].nonce
            )),
            sig
        );
        _profiles[h].nonce++;
        _updateHeat(h, heatScore);

        petitionId = ++petitionCount;
        petitions[petitionId] = Petition({
            id:             petitionId,
            proposerHandle: h,
            bungalowName:   bungalowName,
            executed:       false
        });

        // Proposer auto-signs their own petition
        _petitionHasSigned[petitionId][h] = true;
        petitionSignerWallets[petitionId].push(msg.sender);

        emit PetitionCreated(petitionId, h, bungalowName);
        emit PetitionSigned(petitionId, h, 1);

        // Shortcut paths A & B
        if (heatScore > HEAT_BUNGALOW_SOLO || ownsEnoughApes) {
            _executePetition(petitionId);
        }
    }

    /**
     * @notice Sign an existing petition. Signer must have heat score > 50.
     *         Once quorum is reached the bungalow is created atomically.
     */
    function signBungalowPetition(
        uint256 petitionId,
        uint256 heatScore,
        bytes calldata sig
    ) external {
        Petition storage p = petitions[petitionId];
        require(p.id != 0, "unknown petition");
        require(!p.executed, "petition already executed");

        string memory h = _handleOf(msg.sender);
        _requireNotBlocked(h);
        require(!_petitionHasSigned[petitionId][h], "already signed");
        require(heatScore > HEAT_PETITION_SIGN, "heat too low to sign");

        _requireBackendSig(
            keccak256(abi.encode(
                SIGN_PETITION_TYPEHASH,
                keccak256(bytes(h)),
                msg.sender,
                heatScore,
                petitionId,
                _profiles[h].nonce
            )),
            sig
        );
        _profiles[h].nonce++;
        _updateHeat(h, heatScore);

        _petitionHasSigned[petitionId][h] = true;
        petitionSignerWallets[petitionId].push(msg.sender);

        uint256 count = petitionSignerWallets[petitionId].length;
        emit PetitionSigned(petitionId, h, count);

        if (count >= PETITION_QUORUM) {
            _executePetition(petitionId);
        }
    }

    function _executePetition(uint256 petitionId) internal {
        Petition storage p = petitions[petitionId];
        p.executed = true;

        address adminWallet = _profiles[p.proposerHandle].mainWallet;
        require(adminWallet != address(0), "proposer has no wallet");

        uint256 bungalowId = ++bungalowCount;
        bungalows[bungalowId] = Bungalow({
            id:          bungalowId,
            name:        p.bungalowName,
            admin:       adminWallet,
            adminHandle: p.proposerHandle,
            active:      true,
            createdAt:   block.timestamp
        });

        emit BungalowCreated(bungalowId, p.bungalowName, adminWallet, p.proposerHandle);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Bungalows — Admin curation
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Attach a token/NFT collection reference to a bungalow.
     *         collectionAddress accepts EVM hex addresses and Solana pubkeys.
     */
    function addCollectionToBungalow(
        uint256 bungalowId,
        CollectionType collectionType,
        string calldata collectionAddress,
        string calldata label,
        uint256 heatScore,
        bytes calldata sig
    ) external {
        string memory h = _handleOf(msg.sender);
        _requireBungalowAdmin(bungalowId, h);

        _requireBackendSig(
            keccak256(abi.encode(
                ADD_COLLECTION_TYPEHASH,
                keccak256(bytes(h)),
                msg.sender,
                heatScore,
                bungalowId,
                uint8(collectionType),
                keccak256(bytes(collectionAddress)),
                _profiles[h].nonce
            )),
            sig
        );
        _profiles[h].nonce++;
        _updateHeat(h, heatScore);

        bungalowCollections[bungalowId].push(Collection({
            collectionType:    collectionType,
            collectionAddress: collectionAddress,
            label:             label
        }));

        emit CollectionAdded(bungalowId, collectionType, collectionAddress);
    }

    /**
     * @notice Bungalow admin sets an artifact's status (upvote = active, downvote = banned).
     *         Default is active; no signature required since admin wallet is on-chain.
     */
    function setBungalowArtifactStatus(
        uint256 bungalowId,
        uint256 artifactId,
        bool downvoted
    ) external {
        string memory h = _handleOf(msg.sender);
        _requireBungalowAdmin(bungalowId, h);
        _setArtifactDownvote(bungalowId, artifactId, downvoted);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Bodega — List an artifact
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Put a link up for sale in the Bodega at a given JBM price.
     */
    function listArtifact(
        string calldata link,
        uint256 price,
        uint256 heatScore,
        bytes calldata sig
    ) external returns (uint256 artifactId) {
        require(bytes(link).length > 0, "empty link");
        string memory h = _handleOf(msg.sender);
        _requireNotBlocked(h);

        _requireBackendSig(
            keccak256(abi.encode(
                LIST_ARTIFACT_TYPEHASH,
                keccak256(bytes(h)),
                msg.sender,
                heatScore,
                keccak256(bytes(link)),
                price,
                _profiles[h].nonce
            )),
            sig
        );
        _profiles[h].nonce++;
        _updateHeat(h, heatScore);

        artifactId = ++artifactCount;
        artifacts[artifactId] = Artifact({
            id:           artifactId,
            sellerHandle: h,
            link:         link,
            price:        price,
            active:       true
        });

        emit ArtifactListed(artifactId, h, link, price);
    }

    /**
     * @notice Install a Bodega artifact onto a bungalow by paying the listed JBM price.
     *         Payment goes directly to the seller's main wallet.
     *         Artifacts are upvoted (active) by default upon installation.
     */
    function installArtifact(
        uint256 artifactId,
        uint256 bungalowId,
        uint256 heatScore,
        bytes calldata sig
    ) external nonReentrant {
        Artifact storage art = artifacts[artifactId];
        require(art.id != 0, "unknown artifact");
        require(art.active, "artifact banned from Bodega");
        require(bungalows[bungalowId].active, "bungalow inactive");
        require(bungalowArtifactIdx[bungalowId][artifactId] == 0, "already installed");

        string memory h = _handleOf(msg.sender);
        _requireNotBlocked(h);

        _requireBackendSig(
            keccak256(abi.encode(
                INSTALL_ARTIFACT_TYPEHASH,
                keccak256(bytes(h)),
                msg.sender,
                heatScore,
                artifactId,
                bungalowId,
                _profiles[h].nonce
            )),
            sig
        );
        _profiles[h].nonce++;
        _updateHeat(h, heatScore);

        // Route payment to seller's main wallet
        address sellerWallet = _profiles[art.sellerHandle].mainWallet;
        require(sellerWallet != address(0), "seller has no main wallet");
        require(jbmToken.transferFrom(msg.sender, sellerWallet, art.price), "payment failed");

        BungalowArtifact[] storage list = bungalowArtifacts[bungalowId];
        list.push(BungalowArtifact({
            artifactId:       artifactId,
            installerHandle:  h,
            downvoted:        false
        }));
        bungalowArtifactIdx[bungalowId][artifactId] = list.length; // 1-indexed sentinel

        emit ArtifactInstalled(artifactId, bungalowId, h);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Commissions
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Create a commission request. The budget is escrowed in this
     *         contract immediately — the artist is protected from the outset.
     * @param prompt    Creative brief for the artist
     * @param budget    JBM amount (will be locked until completion or cancellation)
     * @param deadline  Unix timestamp; commission cannot be claimed after this
     */
    function createCommission(
        string calldata prompt,
        uint256 budget,
        uint256 deadline,
        uint256 heatScore,
        bytes calldata sig
    ) external nonReentrant returns (uint256 commissionId) {
        require(bytes(prompt).length > 0, "empty prompt");
        require(budget > 0,                "zero budget");
        require(deadline > block.timestamp, "deadline in past");

        string memory h = _handleOf(msg.sender);
        _requireNotBlocked(h);

        _requireBackendSig(
            keccak256(abi.encode(
                CREATE_COMMISSION_TYPEHASH,
                keccak256(bytes(h)),
                msg.sender,
                heatScore,
                keccak256(bytes(prompt)),
                budget,
                deadline,
                _profiles[h].nonce
            )),
            sig
        );
        _profiles[h].nonce++;
        _updateHeat(h, heatScore);

        // Lock budget in escrow
        require(jbmToken.transferFrom(msg.sender, address(this), budget), "escrow failed");

        commissionId = ++commissionCount;
        commissions[commissionId] = Commission({
            id:               commissionId,
            requesterHandle:  h,
            artistHandle:     "",
            prompt:           prompt,
            budget:           budget,
            deadline:         deadline,
            status:           CommissionStatus.OPEN
        });

        emit CommissionCreated(commissionId, h, budget, deadline);
    }

    /**
     * @notice An artist claims they will fulfil the commission.
     *         Artist must have a verified wallet (i.e. a profile on this contract).
     */
    function claimCommission(
        uint256 commissionId,
        uint256 heatScore,
        bytes calldata sig
    ) external {
        Commission storage c = commissions[commissionId];
        require(c.id != 0,                           "unknown commission");
        require(c.status == CommissionStatus.OPEN,   "not open");
        require(block.timestamp < c.deadline,        "past deadline");

        string memory h = _handleOf(msg.sender);
        _requireNotBlocked(h);
        // Artist cannot claim their own commission
        require(!_strEq(h, c.requesterHandle), "cannot claim own commission");

        _requireBackendSig(
            keccak256(abi.encode(
                CLAIM_COMMISSION_TYPEHASH,
                keccak256(bytes(h)),
                msg.sender,
                heatScore,
                commissionId,
                _profiles[h].nonce
            )),
            sig
        );
        _profiles[h].nonce++;
        _updateHeat(h, heatScore);

        c.artistHandle = h;
        c.status       = CommissionStatus.CLAIMED;

        emit CommissionClaimed(commissionId, h);
    }

    /**
     * @notice Commissioner marks the commission complete and triggers payout.
     *         8% → contract owner (platform fee)
     *         92% → artist's designated main wallet
     *
     * @dev No backend sig required here — the on-chain requester identity is
     *      already established from claimCommission. Pure on-chain flow.
     */
    function completeCommission(uint256 commissionId) external nonReentrant {
        Commission storage c = commissions[commissionId];
        require(c.status == CommissionStatus.CLAIMED, "not in CLAIMED state");

        string memory callerHandle = _handleOf(msg.sender);
        require(_strEq(callerHandle, c.requesterHandle), "not the requester");

        address artistMainWallet = _profiles[c.artistHandle].mainWallet;
        require(artistMainWallet != address(0), "artist has no main wallet");

        uint256 fee           = (c.budget * COMMISSION_FEE_BPS) / BPS_DENOMINATOR;
        uint256 artistPayment = c.budget - fee;

        c.status = CommissionStatus.COMPLETED;

        require(jbmToken.transfer(owner(), fee),           "fee transfer failed");
        require(jbmToken.transfer(artistMainWallet, artistPayment), "artist transfer failed");

        emit CommissionCompleted(commissionId, artistPayment, fee);
    }

    /**
     * @notice Commissioner cancels an OPEN commission and recovers escrowed budget.
     *         Cannot cancel once an artist has claimed it.
     */
    function cancelCommission(uint256 commissionId) external nonReentrant {
        Commission storage c = commissions[commissionId];
        require(c.status == CommissionStatus.OPEN, "not open");

        string memory callerHandle = _handleOf(msg.sender);
        require(_strEq(callerHandle, c.requesterHandle), "not the requester");

        c.status = CommissionStatus.CANCELLED;
        require(jbmToken.transfer(msg.sender, c.budget), "refund failed");

        emit CommissionCancelled(commissionId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View — Read helpers
    // ─────────────────────────────────────────────────────────────────────────

    function getProfile(string calldata handle)
        external view
        returns (
            address[] memory wallets,
            address          mainWallet,
            uint256          heatScore,
            uint256          nonce,
            bool             blocked
        )
    {
        UserProfile storage p = _profiles[_lower(handle)];
        return (p.wallets, p.mainWallet, p.heatScore, p.nonce, p.blocked);
    }

    function getBungalow(uint256 bungalowId)
        external view
        returns (
            string memory    name,
            address          admin,
            string memory    adminHandle,
            bool             active,
            uint256          createdAt,
            Collection[] memory collections
        )
    {
        Bungalow storage b = bungalows[bungalowId];
        return (b.name, b.admin, b.adminHandle, b.active, b.createdAt, bungalowCollections[bungalowId]);
    }

    function getPetitionStatus(uint256 petitionId)
        external view
        returns (
            string memory proposerHandle,
            string memory bungalowName,
            uint256       signerCount,
            bool          executed
        )
    {
        Petition storage p = petitions[petitionId];
        return (p.proposerHandle, p.bungalowName, petitionSignerWallets[petitionId].length, p.executed);
    }

    function hasSigned(uint256 petitionId, string calldata handle) external view returns (bool) {
        return _petitionHasSigned[petitionId][_lower(handle)];
    }

    function getBungalowArtifacts(uint256 bungalowId)
        external view
        returns (BungalowArtifact[] memory)
    {
        return bungalowArtifacts[bungalowId];
    }

    function getCommission(uint256 commissionId)
        external view
        returns (Commission memory)
    {
        return commissions[commissionId];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _requireBackendSig(bytes32 structHash, bytes calldata sig) internal view {
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, sig);
        require(recovered == backendSigner, "invalid backend signature");
    }

    function _handleOf(address wallet) internal view returns (string memory h) {
        h = walletToHandle[wallet];
        require(bytes(h).length > 0, "wallet not registered");
    }

    function _updateHeat(string memory h, uint256 newScore) internal {
        _profiles[h].heatScore = newScore;
        emit HeatScoreUpdated(h, newScore);
    }

    function _requireNotBlocked(string memory h) internal view {
        require(!_profiles[h].blocked, "user is blocked");
    }

    function _requireBungalowAdmin(uint256 bungalowId, string memory h) internal view {
        Bungalow storage b = bungalows[bungalowId];
        require(b.active,                    "bungalow inactive");
        require(_strEq(b.adminHandle, h),    "not bungalow admin");
    }

    function _setArtifactDownvote(uint256 bungalowId, uint256 artifactId, bool downvoted) internal {
        uint256 idx = bungalowArtifactIdx[bungalowId][artifactId];
        require(idx > 0, "artifact not installed in this bungalow");
        bungalowArtifacts[bungalowId][idx - 1].downvoted = downvoted;
        emit ArtifactStatusChanged(artifactId, bungalowId, downvoted);
    }

    /// @dev Naive lowercasing for ASCII handles. Handles are validated off-chain
    ///      by the backend before signing, so this covers the common-path collision.
    function _lower(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x41 && b[i] <= 0x5A) {
                b[i] = bytes1(uint8(b[i]) + 32);
            }
        }
        return string(b);
    }

    function _strEq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
