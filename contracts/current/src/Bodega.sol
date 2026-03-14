// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║                         THE BODEGA                               ║
 * ║                    Jungle Bay Island                               ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 *
 * The Bodega is the marketplace, the gallery, and the wall.
 *
 * Every item in the Bodega is an ERC1155 NFT. An item can be a drawing,
 * a 3D model, a song, a flier, an animation — anything with an IPFS hash.
 * The creator decides the supply (finite or infinite) and the price
 * (free or paid in USDC). Once listed, the item is permanent.
 *
 * MINTING AND INSTALLING ARE THE SAME ACTION:
 * When you "install" an item into a bungalow, you mint a copy for yourself
 * and simultaneously record that you've placed it there. There is no
 * intermediate step. You see something in the Bodega, you want it in your
 * bungalow (or someone else's), you install it. Done.
 *
 * HEAT GATE:
 * To install something in a bungalow, you need a heat score of at least 10
 * for that specific bungalow. This ensures that only people with actual
 * presence in that token community can decorate that space. It's not a
 * hard wall — it's a minimum signal of belonging.
 *
 * THE JBM BOND:
 * The first time you install anything in a bungalow, a permanent bond
 * activates between you and that bungalow. From that moment, you are
 * forever eligible to claim JBM for the heat you carry there, every day.
 * The bond never closes.
 *
 * COMMISSIONED ITEMS:
 * Items produced through the CommissionManager are always listed as free
 * and infinite supply. The commission itself was the payment. The art now
 * belongs to the island — anyone can install it anywhere.
 *
 * REVENUE SPLIT:
 * When a paid item is installed:
 *   8%  → PLATFORM_RECIPIENT
 *   92% → item creator's main wallet
 *
 * ARCHITECTURE:
 * Reads IslandIdentity for heat scores, wallet profiles, and bond activation.
 * Reads JungleBayIsland for bungalow existence.
 * Called by CommissionManager on commission settlement to list commissioned items.
 */

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IIslandIdentity {
    function walletProfileId(address wallet) external view returns (uint256);
    function getHeat(uint256 profileId, uint256 bungalowId) external view returns (uint256);
    function getMainWallet(uint256 profileId) external view returns (address);
    function bondActivated(uint256 profileId, uint256 bungalowId) external view returns (bool);
    function activateBond(uint256 profileId, uint256 bungalowId) external;
}

interface IJungleBayIsland {
    function bungalowExists(uint256 tokenId) external view returns (bool);
}

contract Bodega is ERC1155, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────

    uint256 internal constant PLATFORM_BPS = 800;
    uint256 internal constant BPS_DENOM = 10_000;

    /// @notice Minimum heat score required to install into a bungalow.
    uint256 public constant MIN_HEAT_TO_INSTALL = 10;

    uint256 internal constant MAX_URI_LENGTH = 512;

    // ─────────────────────────────────────────────────────────────
    // Structs
    // ─────────────────────────────────────────────────────────────

    struct Item {
        uint256 id;
        uint256 creatorProfileId;
        string ipfsURI;
        uint256 supply; // 0 = infinite
        uint256 priceUSDC; // 0 = free
        uint256 totalMinted;
        bool active;
        uint64 listedAt;
    }

    // ─────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────

    error InvalidAddress();
    error InvalidStringLength();
    error ProfileRequired();
    error BungalowNotFound();
    error ItemNotFound();
    error ItemInactive();
    error SupplyExhausted();
    error InsufficientHeat();
    error AlreadyInstalled();
    error Unauthorized();

    // ─────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────

    IERC20 public immutable usdc;
    IIslandIdentity public immutable identity;
    IJungleBayIsland public immutable island;
    address public commissionManager; // set post-deploy
    address public feeRecipient;

    uint256 public itemCount;

    mapping(uint256 => Item) public items;

    // bungalowId => itemId[] (all items installed in this bungalow)
    mapping(uint256 => uint256[]) private _bungalowItems;
    // bungalowId => itemId => installedByProfileId (0 if not installed)
    mapping(uint256 => mapping(uint256 => uint256)) public installedBy;

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    event ItemListed(
        uint256 indexed itemId, uint256 indexed creatorProfileId, string ipfsURI, uint256 supply, uint256 priceUSDC
    );
    event ItemInstalled(
        uint256 indexed itemId, uint256 indexed bungalowId, uint256 indexed installerProfileId, uint256 priceUSDC
    );
    event ItemActiveStatusUpdated(uint256 indexed itemId, bool active);
    event CommissionManagerSet(address indexed manager);
    event FeeRecipientUpdated(address indexed recipient);

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(address initialOwner, address usdc_, address identity_, address island_, address feeRecipient_)
        ERC1155("")
        Ownable(initialOwner)
    {
        if (
            initialOwner == address(0) || usdc_ == address(0) || identity_ == address(0) || island_ == address(0)
                || feeRecipient_ == address(0)
        ) {
            revert InvalidAddress();
        }

        usdc = IERC20(usdc_);
        identity = IIslandIdentity(identity_);
        island = IJungleBayIsland(island_);
        feeRecipient = feeRecipient_;
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

    /// @notice Set after CommissionManager is deployed.
    function setCommissionManager(address manager) external onlyOwner {
        if (manager == address(0)) revert InvalidAddress();
        commissionManager = manager;
        emit CommissionManagerSet(manager);
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert InvalidAddress();
        feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }

    /// @notice Admin can deactivate an item (e.g. DMCA, content violation).
    function setItemActive(uint256 itemId, bool active) external onlyOwner {
        if (items[itemId].id == 0) revert ItemNotFound();
        items[itemId].active = active;
        emit ItemActiveStatusUpdated(itemId, active);
    }

    // ─────────────────────────────────────────────────────────────
    // Listing
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice List an item in the Bodega. Free to call.
     *         Anyone with a profile can list anything.
     *         The item lives forever on-chain, even if deactivated.
     *
     * @param ipfsURI   IPFS hash of the item content
     * @param supply    Max mintable copies. 0 = infinite.
     * @param priceUSDC Price per install. 0 = free.
     */
    function listItem(string calldata ipfsURI, uint256 supply, uint256 priceUSDC)
        external
        whenNotPaused
        returns (uint256 itemId)
    {
        uint256 profileId = identity.walletProfileId(msg.sender);
        if (profileId == 0) revert ProfileRequired();
        _requireBoundedString(ipfsURI, 1, MAX_URI_LENGTH);

        itemId = _createItem(profileId, ipfsURI, supply, priceUSDC);
    }

    /**
     * @notice Called exclusively by CommissionManager on commission settlement.
     *         Commissioned items are always free and infinite — the commission
     *         itself was the payment. The art now belongs to the island.
     */
    function listCommissionedItem(uint256 artistProfileId, string calldata ipfsURI)
        external
        whenNotPaused
        returns (uint256 itemId)
    {
        if (msg.sender != commissionManager) revert Unauthorized();
        _requireBoundedString(ipfsURI, 1, MAX_URI_LENGTH);
        itemId = _createItem(artistProfileId, ipfsURI, 0, 0);
    }

    // ─────────────────────────────────────────────────────────────
    // Installing
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Install an item into a bungalow. This is minting + installing
     *         in a single atomic action.
     *
     *         Requirements:
     *         - You must have a profile
     *         - The item must be active and have supply remaining
     *         - You must have heat ≥ 10 on this bungalow
     *         - The item must not already be installed in this bungalow
     *           (one instance per bungalow — but infinite bungalows)
     *
     *         If the item has a price, USDC is split:
     *           8% → PLATFORM_RECIPIENT, 92% → creator
     *
     *         If this is your first install in this bungalow, the JBM bond
     *         activates. That door opens forever.
     */
    function installItem(uint256 itemId, uint256 bungalowId) external whenNotPaused nonReentrant {
        // Verify caller has a profile
        uint256 profileId = identity.walletProfileId(msg.sender);
        if (profileId == 0) revert ProfileRequired();

        // Verify bungalow exists
        if (!island.bungalowExists(bungalowId)) revert BungalowNotFound();

        // Verify item
        Item storage item = items[itemId];
        if (item.id == 0) revert ItemNotFound();
        if (!item.active) revert ItemInactive();
        if (item.supply > 0 && item.totalMinted >= item.supply) revert SupplyExhausted();

        // Verify heat gate
        uint256 heat = identity.getHeat(profileId, bungalowId);
        if (heat < MIN_HEAT_TO_INSTALL) revert InsufficientHeat();

        // One install per item per bungalow
        if (installedBy[bungalowId][itemId] != 0) revert AlreadyInstalled();

        // Collect payment if any
        if (item.priceUSDC > 0) {
            address creatorWallet = identity.getMainWallet(item.creatorProfileId);
            if (creatorWallet == address(0)) revert InvalidAddress();

            uint256 platformCut = (item.priceUSDC * PLATFORM_BPS) / BPS_DENOM;
            uint256 creatorCut = item.priceUSDC - platformCut;

            usdc.safeTransferFrom(msg.sender, feeRecipient, platformCut);
            usdc.safeTransferFrom(msg.sender, creatorWallet, creatorCut);
        }

        // Mint the ERC1155 token to the installer
        item.totalMinted++;
        _mint(msg.sender, itemId, 1, "");

        // Record installation in this bungalow
        installedBy[bungalowId][itemId] = profileId;
        _bungalowItems[bungalowId].push(itemId);

        // Activate the JBM bond if not already active
        if (!identity.bondActivated(profileId, bungalowId)) {
            identity.activateBond(profileId, bungalowId);
        }

        emit ItemInstalled(itemId, bungalowId, profileId, item.priceUSDC);
    }

    // ─────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Get all items installed in a bungalow.
     *         Used by the frontend to render the bungalow's contents.
     */
    function getBungalowItems(uint256 bungalowId) external view returns (uint256[] memory) {
        return _bungalowItems[bungalowId];
    }

    /**
     * @notice Get full item data.
     */
    function getItem(uint256 itemId) external view returns (Item memory) {
        if (items[itemId].id == 0) revert ItemNotFound();
        return items[itemId];
    }

    /// @notice ERC1155 URI returns the item's IPFS URI directly.
    function uri(uint256 itemId) public view override returns (string memory) {
        return items[itemId].ipfsURI;
    }

    // ─────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────

    function _createItem(uint256 profileId, string memory ipfsURI, uint256 supply, uint256 priceUSDC)
        internal
        returns (uint256 itemId)
    {
        itemId = ++itemCount;
        items[itemId] = Item({
            id: itemId,
            creatorProfileId: profileId,
            ipfsURI: ipfsURI,
            supply: supply,
            priceUSDC: priceUSDC,
            totalMinted: 0,
            active: true,
            listedAt: uint64(block.timestamp)
        });
        emit ItemListed(itemId, profileId, ipfsURI, supply, priceUSDC);
    }

    function _requireBoundedString(string memory s, uint256 minLen, uint256 maxLen) internal pure {
        uint256 len = bytes(s).length;
        if (len < minLen || len > maxLen) revert InvalidStringLength();
    }
}
