// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║                    JUNGLE BAY ISLAND                              ║
 * ║                   The Bungalow Registry                           ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 *
 * Every meme token in the world deserves a home.
 *
 * A bungalow is still an ERC721 NFT, but it now acts as an umbrella of
 * culture. Each bungalow has one immutable seed asset and can link
 * additional assets from other chains over time. Any linked asset routes
 * to the same bungalow page.
 *
 * The registry enforces one global rule:
 * an asset can belong to one bungalow only.
 *
 * Chain identifiers are normalized to lowercase. Asset identifiers are
 * canonicalized only when the underlying chain is case-insensitive
 * (for example EVM hex addresses). This prevents duplicate bungalows
 * without corrupting case-sensitive identifiers on non-EVM chains.
 *
 * Bungalow metadata is lightweight and culture-native:
 * - optional name
 * - optional ticker
 * - optional IPFS content hash
 */

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IIslandIdentity {
    function walletProfileId(address wallet) external view returns (uint256);
}

contract JungleBayIsland is ERC721, ERC2981, EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    uint256 internal constant PLATFORM_BPS = 800;
    uint256 internal constant BPS_DENOM = 10_000;
    uint96 internal constant ROYALTY_BPS = 80;

    uint256 internal constant MAX_URI_LENGTH = 512;
    uint256 internal constant MAX_REF_LENGTH = 256;
    uint256 internal constant MAX_NAME_LENGTH = 64;
    uint256 internal constant MAX_TICKER_LENGTH = 16;

    bytes32 internal constant MINT_PRICE_TYPEHASH =
        keccak256("MintPrice(bytes32 assetKey,address wallet,uint256 priceUSDC,bytes32 salt,uint256 deadline)");

    struct Asset {
        string chain;
        string tokenAddress;
        uint64 addedAt;
    }

    struct Bungalow {
        uint256 id;
        string name;
        string ticker;
        string ipfsHash;
        uint64 mintedAt;
        bytes32 seedAssetKey;
    }

    error InvalidAddress();
    error InvalidStringLength();
    error AssetAlreadyLinked();
    error BungalowNotFound();
    error NotBungalowOwner();
    error SignatureExpired();
    error InvalidBackendSignature();
    error AttestationAlreadyUsed();
    error ProfileRequired();

    IERC20 public immutable usdc;
    IIslandIdentity public immutable identity;
    address public backendSigner;
    address public feeRecipient;

    uint256 public bungalowCount;

    mapping(uint256 => Bungalow) public bungalows;
    mapping(bytes32 => uint256) public bungalowIdByAssetKey;
    mapping(bytes32 => Asset) private _assetsByKey;
    mapping(uint256 => bytes32[]) private _bungalowAssetKeys;
    mapping(bytes32 => bool) public usedDigests;

    event BungalowMinted(
        uint256 indexed tokenId, address indexed owner, string seedChain, string seedTokenAddress, uint256 priceUSDC
    );
    event BungalowUpdated(uint256 indexed tokenId, string ipfsHash);
    event BungalowIdentityUpdated(uint256 indexed tokenId, string name, string ticker);
    event AssetLinked(uint256 indexed tokenId, string chain, string tokenAddress);
    event BackendSignerUpdated(address indexed newSigner);
    event FeeRecipientUpdated(address indexed newRecipient);

    constructor(address initialOwner, address usdc_, address identity_, address backendSigner_, address feeRecipient_)
        ERC721("Jungle Bay Island Bungalow", "BNGW")
        EIP712("JungleBayIsland", "1")
        Ownable(initialOwner)
    {
        if (
            initialOwner == address(0) || usdc_ == address(0) || identity_ == address(0) || backendSigner_ == address(0)
                || feeRecipient_ == address(0)
        ) revert InvalidAddress();

        usdc = IERC20(usdc_);
        identity = IIslandIdentity(identity_);
        backendSigner = backendSigner_;
        feeRecipient = feeRecipient_;

        _setDefaultRoyalty(initialOwner, ROYALTY_BPS);
    }

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

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert InvalidAddress();
        feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }

    function updateRoyaltyReceiver(address receiver) external onlyOwner {
        if (receiver == address(0)) revert InvalidAddress();
        _setDefaultRoyalty(receiver, ROYALTY_BPS);
    }

    function mintBungalow(
        string calldata chain,
        string calldata tokenAddress,
        uint256 priceUSDC,
        bytes32 salt,
        uint256 deadline,
        bytes calldata sig
    ) external whenNotPaused nonReentrant returns (uint256 tokenId) {
        if (identity.walletProfileId(msg.sender) == 0) revert ProfileRequired();

        (string memory normalizedChain, string memory normalizedTokenAddress) = _normalizeAsset(chain, tokenAddress);
        bytes32 assetKey = _assetKey(normalizedChain, normalizedTokenAddress);
        if (bungalowIdByAssetKey[assetKey] != 0) revert AssetAlreadyLinked();

        _consumeAttestation(
            keccak256(abi.encode(MINT_PRICE_TYPEHASH, assetKey, msg.sender, priceUSDC, salt, deadline)), sig, deadline
        );

        if (priceUSDC > 0) {
            uint256 platformCut = (priceUSDC * PLATFORM_BPS) / BPS_DENOM;
            uint256 ownerCut = priceUSDC - platformCut;

            usdc.safeTransferFrom(msg.sender, feeRecipient, platformCut);
            usdc.safeTransferFrom(msg.sender, owner(), ownerCut);
        }

        tokenId = ++bungalowCount;
        bungalows[tokenId] = Bungalow({
            id: tokenId,
            name: "",
            ticker: "",
            ipfsHash: "",
            mintedAt: uint64(block.timestamp),
            seedAssetKey: assetKey
        });

        _linkAsset(tokenId, assetKey, normalizedChain, normalizedTokenAddress);
        _safeMint(msg.sender, tokenId);

        emit BungalowMinted(tokenId, msg.sender, normalizedChain, normalizedTokenAddress, priceUSDC);
    }

    function linkAsset(uint256 tokenId, string calldata chain, string calldata tokenAddress) external whenNotPaused {
        if (ownerOf(tokenId) != msg.sender) revert NotBungalowOwner();

        (string memory normalizedChain, string memory normalizedTokenAddress) = _normalizeAsset(chain, tokenAddress);
        bytes32 assetKey = _assetKey(normalizedChain, normalizedTokenAddress);
        if (bungalowIdByAssetKey[assetKey] != 0) revert AssetAlreadyLinked();

        _linkAsset(tokenId, assetKey, normalizedChain, normalizedTokenAddress);
    }

    function setBungalowIdentity(uint256 tokenId, string calldata name, string calldata ticker)
        external
        whenNotPaused
    {
        if (ownerOf(tokenId) != msg.sender) revert NotBungalowOwner();

        string memory normalizedName = _normalizeLower(name);
        string memory normalizedTicker = _normalizeLower(ticker);

        _requireBoundedString(normalizedName, 0, MAX_NAME_LENGTH);
        _requireBoundedString(normalizedTicker, 0, MAX_TICKER_LENGTH);

        bungalows[tokenId].name = normalizedName;
        bungalows[tokenId].ticker = normalizedTicker;

        emit BungalowIdentityUpdated(tokenId, normalizedName, normalizedTicker);
    }

    function updateBungalow(uint256 tokenId, string calldata ipfsHash) external whenNotPaused {
        if (ownerOf(tokenId) != msg.sender) revert NotBungalowOwner();
        _requireBoundedString(ipfsHash, 0, MAX_URI_LENGTH);

        bungalows[tokenId].ipfsHash = ipfsHash;
        emit BungalowUpdated(tokenId, ipfsHash);
    }

    function getBungalowPage(string calldata chain, string calldata tokenAddress)
        external
        view
        returns (
            bool exists,
            uint256 tokenId,
            address owner_,
            string memory name,
            string memory ticker,
            string memory ipfsHash,
            uint64 mintedAt,
            string memory seedChain,
            string memory seedTokenAddress,
            uint256 assetCount
        )
    {
        (string memory normalizedChain, string memory normalizedTokenAddress) = _normalizeAsset(chain, tokenAddress);
        bytes32 key = _assetKey(normalizedChain, normalizedTokenAddress);
        tokenId = bungalowIdByAssetKey[key];
        if (tokenId == 0) {
            return (false, 0, address(0), "", "", "", 0, "", "", 0);
        }

        Bungalow storage bungalow = bungalows[tokenId];
        Asset storage seed = _assetsByKey[bungalow.seedAssetKey];

        return (
            true,
            tokenId,
            ownerOf(tokenId),
            bungalow.name,
            bungalow.ticker,
            bungalow.ipfsHash,
            bungalow.mintedAt,
            seed.chain,
            seed.tokenAddress,
            _bungalowAssetKeys[tokenId].length
        );
    }

    function getBungalowAssets(uint256 tokenId) external view returns (Asset[] memory assets) {
        if (!_bungalowExists(tokenId)) revert BungalowNotFound();

        bytes32[] storage keys = _bungalowAssetKeys[tokenId];
        assets = new Asset[](keys.length);

        for (uint256 i = 0; i < keys.length; ++i) {
            Asset storage asset = _assetsByKey[keys[i]];
            assets[i] = Asset({chain: asset.chain, tokenAddress: asset.tokenAddress, addedAt: asset.addedAt});
        }
    }

    function bungalowExists(uint256 tokenId) external view returns (bool) {
        return _bungalowExists(tokenId);
    }

    function getAssetKey(string calldata chain, string calldata tokenAddress) external pure returns (bytes32) {
        (string memory normalizedChain, string memory normalizedTokenAddress) = _normalizeAsset(chain, tokenAddress);
        return _assetKey(normalizedChain, normalizedTokenAddress);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _linkAsset(uint256 tokenId, bytes32 assetKey, string memory chain, string memory tokenAddress) internal {
        bungalowIdByAssetKey[assetKey] = tokenId;
        _assetsByKey[assetKey] = Asset({chain: chain, tokenAddress: tokenAddress, addedAt: uint64(block.timestamp)});
        _bungalowAssetKeys[tokenId].push(assetKey);

        emit AssetLinked(tokenId, chain, tokenAddress);
    }

    function _bungalowExists(uint256 tokenId) internal view returns (bool) {
        return tokenId != 0 && bungalows[tokenId].id != 0;
    }

    function _assetKey(string memory chain, string memory tokenAddress) internal pure returns (bytes32) {
        return keccak256(abi.encode(keccak256(bytes(chain)), keccak256(bytes(tokenAddress))));
    }

    function _normalizeAsset(string memory chain, string memory tokenAddress)
        internal
        pure
        returns (string memory normalizedChain, string memory normalizedTokenAddress)
    {
        normalizedChain = _normalizeLower(chain);
        normalizedTokenAddress = _canonicalizeAssetIdentifier(normalizedChain, tokenAddress);

        _requireBoundedString(normalizedChain, 1, MAX_REF_LENGTH);
        _requireBoundedString(normalizedTokenAddress, 1, MAX_REF_LENGTH);
    }

    function _canonicalizeAssetIdentifier(string memory normalizedChain, string memory tokenAddress)
        internal
        pure
        returns (string memory)
    {
        if (_isCaseInsensitiveChain(normalizedChain)) {
            return _normalizeLower(tokenAddress);
        }

        return tokenAddress;
    }

    function _isCaseInsensitiveChain(string memory normalizedChain) internal pure returns (bool) {
        bytes32 chainHash = keccak256(bytes(normalizedChain));

        return chainHash == keccak256("ethereum") || chainHash == keccak256("base")
            || chainHash == keccak256("optimism") || chainHash == keccak256("arbitrum") || chainHash == keccak256("polygon")
            || chainHash == keccak256("bsc") || chainHash == keccak256("avalanche") || chainHash == keccak256("fantom")
            || chainHash == keccak256("zora") || chainHash == keccak256("linea") || chainHash == keccak256("blast")
            || chainHash == keccak256("scroll") || chainHash == keccak256("mode") || chainHash == keccak256("ink")
            || chainHash == keccak256("mantle") || chainHash == keccak256("sei") || chainHash == keccak256("worldchain")
            || chainHash == keccak256("berachain");
    }

    function _normalizeLower(string memory s) internal pure returns (string memory) {
        bytes memory out = bytes(s);

        for (uint256 i = 0; i < out.length; ++i) {
            uint8 charCode = uint8(out[i]);
            if (charCode >= 65 && charCode <= 90) {
                out[i] = bytes1(charCode + 32);
            }
        }

        return string(out);
    }

    function _consumeAttestation(bytes32 structHash, bytes calldata sig, uint256 deadline) internal {
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 digest = _hashTypedDataV4(structHash);
        if (usedDigests[digest]) revert AttestationAlreadyUsed();
        if (digest.recover(sig) != backendSigner) revert InvalidBackendSignature();
        usedDigests[digest] = true;
    }

    function _requireBoundedString(string memory s, uint256 minLen, uint256 maxLen) internal pure {
        uint256 len = bytes(s).length;
        if (len < minLen || len > maxLen) revert InvalidStringLength();
    }
}
