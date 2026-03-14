# Signature Matrix

This file is the canonical backend-signature reference for the current
4-contract suite.

Only `IslandIdentity` and `JungleBayIsland` use backend EIP-712 attestations.
`Bodega` and `CommissionManager` are actor-authorized onchain and do not
currently require backend signatures.

## IslandIdentity

Domain:

- Name: `IslandIdentity`
- Version: `1`

Replay model:

- Contract field: `usedDigests[digest]`
- Each signed action is consumed once
- `salt: bytes32` is part of every signed struct and should be unique per action
- `deadline: uint256` is enforced onchain

### Register

- Function: `register(uint64 xUserId, string xHandle, bytes32 salt, uint256 deadline, bytes sig)`
- Signer: backend signer stored in `IslandIdentity.backendSigner`
- Caller: registering wallet (`msg.sender`)
- Typed data:
  - `xUserId: uint64`
  - `xHandle: string`
  - `wallet: address`
  - `salt: bytes32`
  - `deadline: uint256`
- Typehash string:
  - `Register(uint64 xUserId,string xHandle,address wallet,bytes32 salt,uint256 deadline)`
- Onchain struct encoding details:
  - the contract encodes `keccak256(bytes(xHandle))`, not the raw string bytes
- Offchain attestation:
  - X OAuth/session completed
  - `xUserId` belongs to the logged-in user
  - `xHandle` is the current cosmetic handle for that user
  - backend is willing to initialize the profile for `msg.sender`

### LinkWallet

- Function: `linkWallet(uint256 profileId, bytes32 salt, uint256 deadline, bytes sig)`
- Signer: backend signer stored in `IslandIdentity.backendSigner`
- Caller: wallet being linked (`msg.sender`)
- Typed data:
  - `profileId: uint256`
  - `wallet: address`
  - `salt: bytes32`
  - `deadline: uint256`
- Typehash string:
  - `LinkWallet(uint256 profileId,address wallet,bytes32 salt,uint256 deadline)`
- Offchain attestation:
  - backend verified that this wallet link is authorized for the target profile
  - backend verified the user session/identity before allowing the link

### SyncHeat

- Function: `syncHeat(uint256 profileId, uint256 bungalowId, uint256 score, bytes32 salt, uint256 deadline, bytes sig)`
- Signer: backend signer stored in `IslandIdentity.backendSigner`
- Caller: wallet linked to `profileId`
- Typed data:
  - `profileId: uint256`
  - `bungalowId: uint256`
  - `heatScore: uint256`
  - `salt: bytes32`
  - `deadline: uint256`
- Typehash string:
  - `SyncHeat(uint256 profileId,uint256 bungalowId,uint256 heatScore,bytes32 salt,uint256 deadline)`
- Offchain attestation:
  - backend-calculated per-profile, per-bungalow heat score at the time of action

### ClaimDailyJBM

- Function: `claimDailyJBM(uint256 periodId, uint256 amount, bytes32 salt, uint256 deadline, bytes sig)`
- Signer: backend signer stored in `IslandIdentity.backendSigner`
- Caller: linked wallet claiming JBM (`msg.sender`)
- Typed data:
  - `wallet: address`
  - `periodId: uint256`
  - `amount: uint256`
  - `salt: bytes32`
  - `deadline: uint256`
- Typehash string:
  - `ClaimDailyJBM(address wallet,uint256 periodId,uint256 amount,bytes32 salt,uint256 deadline)`
- Offchain attestation:
  - claim amount for that wallet and day
  - backend has determined the wallet/profile is eligible
  - backend has calculated the JBM owed from active bungalow bonds
- Additional onchain guard:
  - `walletClaimedPeriod[wallet][periodId]` must be false

## JungleBayIsland

Domain:

- Name: `JungleBayIsland`
- Version: `1`

Replay model:

- Contract field: `usedDigests[digest]`
- Each signed action is consumed once
- `salt: bytes32` is part of the signed struct and should be unique per quote
- `deadline: uint256` is enforced onchain

### MintPrice

- Function: `mintBungalow(string chain, string tokenAddress, uint256 priceUSDC, bytes32 salt, uint256 deadline, bytes sig)`
- Signer: backend signer stored in `JungleBayIsland.backendSigner`
- Caller: wallet minting the bungalow (`msg.sender`)
- Typed data:
  - `assetKey: bytes32`
  - `wallet: address`
  - `priceUSDC: uint256`
  - `salt: bytes32`
  - `deadline: uint256`
- Typehash string:
  - `MintPrice(bytes32 assetKey,address wallet,uint256 priceUSDC,bytes32 salt,uint256 deadline)`
- Onchain struct encoding details:
  - the signed value is `assetKey`, not the raw `chain` and `tokenAddress`
  - `assetKey = keccak256(abi.encode(normalizedChain, keccak256(bytes(normalizedTokenAddress))))`
  - `chain` is normalized to lowercase
  - token address/reference is normalized only for case-insensitive chains
- Offchain attestation:
  - backend-approved mint price in USDC for that asset
  - backend approved that quote for the specific normalized asset key and caller wallet

## Bodega

Current signature requirement:

- None

Notes:

- `listItem` is direct actor-authorized onchain
- `installItem` is direct actor-authorized onchain
- `listCommissionedItem` is contract-authorized by `CommissionManager`, not backend-signed
- Heat gating is enforced by reading `IslandIdentity.getHeat(profileId, bungalowId)`, not by a signed payload

## CommissionManager

Current signature requirement:

- None

Notes:

- `publishCommission`, `applyToCommission`, `selectArtist`,
- `submitDeliverable`, `approveCommission`, `rejectCommission`,
- `claimMissedDeadlineRefund`, `claimTimedOutPayout`, and `expireCommission`
- are direct actor-authorized onchain
- Reputation, rejection counters, and commissioned-item listing are driven by
  onchain state transitions, not backend signatures

## Global Notes

- Current deployment metadata is in `contracts/current/deployments/base.json`
- That deployment file currently records one shared `backendSigner` address
- Even so, `IslandIdentity` and `JungleBayIsland` each store their own
  `backendSigner` onchain and can diverge if updated separately by the owner
- The backend must generate typed data exactly matching the field order above
- String fields included in the typehash are hashed before `abi.encode` in the
  current Solidity implementation where noted above
