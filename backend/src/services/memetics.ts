import { randomBytes } from 'node:crypto'
import {
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  http,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import { CONFIG, normalizeAddress, publicClients, type SupportedChain } from '../config'

export const MEMETICS_EIP712_DOMAIN = {
  name: 'Memetics',
  version: '3',
  chainId: 8453,
} as const

export enum MemeticsAssetChain {
  BASE = 0,
  ETHEREUM = 1,
  SOLANA = 2,
  OTHER = 3,
}

export enum MemeticsAssetKind {
  ERC20 = 0,
  ERC721 = 1,
  SPL_TOKEN = 2,
  SPL_NFT = 3,
  CUSTOM = 4,
}

export interface MemeticsProfile {
  id: number
  handleHash: Hex
  handle: string
  mainWallet: Address
  heatScore: bigint
  flags: bigint
  createdAt: number
  updatedAt: number
  wallets: Address[]
}

export interface CommissionManagerCommission {
  id: number
  requesterProfileId: number
  bungalowId: number
  artistProfileId: number
  selectedApplicationId: number
  briefURI: string
  deliverableURI: string
  budget: bigint
  acceptanceDeadline: number
  deliveryDeadline: number
  submittedAt: number
  status: number
}

export interface CommissionManagerApplication {
  id: number
  commissionId: number
  artistProfileId: number
  applicationURI: string
  createdAt: number
  status: number
}

export const MEMETICS_ABI = [
  {
    type: 'event',
    name: 'ArtifactInstalled',
    inputs: [
      { indexed: true, name: 'artifactId', type: 'uint256' },
      { indexed: true, name: 'bungalowId', type: 'uint256' },
      { indexed: true, name: 'installerProfileId', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'ArtifactListed',
    inputs: [
      { indexed: true, name: 'artifactId', type: 'uint256' },
      { indexed: true, name: 'sellerProfileId', type: 'uint256' },
      { indexed: false, name: 'uri', type: 'string' },
      { indexed: false, name: 'price', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'BungalowCreated',
    inputs: [
      { indexed: true, name: 'bungalowId', type: 'uint256' },
      { indexed: true, name: 'adminProfileId', type: 'uint256' },
      { indexed: true, name: 'primaryAssetKey', type: 'bytes32' },
      { indexed: false, name: 'name', type: 'string' },
    ],
  },
  {
    type: 'event',
    name: 'DailyMemesClaimed',
    inputs: [
      { indexed: true, name: 'profileId', type: 'uint256' },
      { indexed: true, name: 'wallet', type: 'address' },
      { indexed: true, name: 'periodId', type: 'uint256' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'PetitionCreated',
    inputs: [
      { indexed: true, name: 'petitionId', type: 'uint256' },
      { indexed: true, name: 'proposerProfileId', type: 'uint256' },
      { indexed: true, name: 'primaryAssetKey', type: 'bytes32' },
      { indexed: false, name: 'bungalowName', type: 'string' },
    ],
  },
  {
    type: 'event',
    name: 'PetitionSigned',
    inputs: [
      { indexed: true, name: 'petitionId', type: 'uint256' },
      { indexed: true, name: 'signerProfileId', type: 'uint256' },
      { indexed: false, name: 'signerCount', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'activePetitionIdByPrimaryAssetKey',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'adminCreateBungalow',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'adminProfileId', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'metadataURI', type: 'string' },
      { name: 'primaryAssetChain', type: 'uint8' },
      { name: 'primaryAssetKind', type: 'uint8' },
      { name: 'primaryAssetRef', type: 'string' },
    ],
    outputs: [{ name: 'bungalowId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'bungalowIdByPrimaryAssetKey',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'dailyClaimedByPeriod',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getProfile',
    stateMutability: 'view',
    inputs: [{ name: 'profileId', type: 'uint256' }],
    outputs: [
      { name: 'handleHash', type: 'bytes32' },
      { name: 'handle', type: 'string' },
      { name: 'mainWallet', type: 'address' },
      { name: 'heatScore', type: 'uint256' },
      { name: 'flags', type: 'uint256' },
      { name: 'createdAt', type: 'uint64' },
      { name: 'updatedAt', type: 'uint64' },
      { name: 'wallets', type: 'address[]' },
    ],
  },
  {
    type: 'function',
    name: 'petitionSignedByProfile',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'petitions',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'id', type: 'uint256' },
      { name: 'proposerProfileId', type: 'uint256' },
      { name: 'bungalowName', type: 'string' },
      { name: 'metadataURI', type: 'string' },
      { name: 'primaryAssetKey', type: 'bytes32' },
      { name: 'primaryAssetChain', type: 'uint8' },
      { name: 'primaryAssetKind', type: 'uint8' },
      { name: 'primaryAssetRef', type: 'string' },
      { name: 'status', type: 'uint8' },
      { name: 'signerCount', type: 'uint32' },
      { name: 'createdAt', type: 'uint64' },
    ],
  },
  {
    type: 'function',
    name: 'walletProfileId',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const COMMISSION_MANAGER_ABI = [
  {
    type: 'event',
    name: 'CommissionCreated',
    inputs: [
      { indexed: true, name: 'commissionId', type: 'uint256' },
      { indexed: true, name: 'requesterProfileId', type: 'uint256' },
      { indexed: true, name: 'bungalowId', type: 'uint256' },
      { indexed: false, name: 'budget', type: 'uint256' },
      { indexed: false, name: 'deliveryDeadline', type: 'uint64' },
      { indexed: false, name: 'briefURI', type: 'string' },
    ],
  },
  {
    type: 'event',
    name: 'CommissionApplicationCreated',
    inputs: [
      { indexed: true, name: 'applicationId', type: 'uint256' },
      { indexed: true, name: 'commissionId', type: 'uint256' },
      { indexed: true, name: 'artistProfileId', type: 'uint256' },
      { indexed: false, name: 'applicationURI', type: 'string' },
    ],
  },
  {
    type: 'event',
    name: 'CommissionApplicationWithdrawn',
    inputs: [
      { indexed: true, name: 'applicationId', type: 'uint256' },
      { indexed: true, name: 'commissionId', type: 'uint256' },
      { indexed: true, name: 'artistProfileId', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'CommissionArtistSelected',
    inputs: [
      { indexed: true, name: 'commissionId', type: 'uint256' },
      { indexed: true, name: 'applicationId', type: 'uint256' },
      { indexed: true, name: 'artistProfileId', type: 'uint256' },
      { indexed: false, name: 'acceptanceDeadline', type: 'uint64' },
    ],
  },
  {
    type: 'event',
    name: 'CommissionSelectionCleared',
    inputs: [
      { indexed: true, name: 'commissionId', type: 'uint256' },
      { indexed: true, name: 'applicationId', type: 'uint256' },
      { indexed: true, name: 'artistProfileId', type: 'uint256' },
      { indexed: false, name: 'applicationStatus', type: 'uint8' },
    ],
  },
  {
    type: 'event',
    name: 'CommissionAccepted',
    inputs: [
      { indexed: true, name: 'commissionId', type: 'uint256' },
      { indexed: true, name: 'applicationId', type: 'uint256' },
      { indexed: true, name: 'artistProfileId', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'CommissionSubmitted',
    inputs: [
      { indexed: true, name: 'commissionId', type: 'uint256' },
      { indexed: true, name: 'artistProfileId', type: 'uint256' },
      { indexed: false, name: 'deliverableURI', type: 'string' },
    ],
  },
  {
    type: 'event',
    name: 'CommissionDisputed',
    inputs: [
      { indexed: true, name: 'commissionId', type: 'uint256' },
      { indexed: true, name: 'openedByProfileId', type: 'uint256' },
      { indexed: false, name: 'disputeURI', type: 'string' },
    ],
  },
  {
    type: 'event',
    name: 'CommissionSettled',
    inputs: [
      { indexed: true, name: 'commissionId', type: 'uint256' },
      { indexed: false, name: 'artistNetPayout', type: 'uint256' },
      { indexed: false, name: 'requesterRefund', type: 'uint256' },
      { indexed: false, name: 'fee', type: 'uint256' },
      { indexed: false, name: 'status', type: 'uint8' },
    ],
  },
  {
    type: 'event',
    name: 'CommissionCancelled',
    inputs: [
      { indexed: true, name: 'commissionId', type: 'uint256' },
      { indexed: true, name: 'requesterProfileId', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'commissions',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'id', type: 'uint256' },
      { name: 'requesterProfileId', type: 'uint256' },
      { name: 'bungalowId', type: 'uint256' },
      { name: 'artistProfileId', type: 'uint256' },
      { name: 'selectedApplicationId', type: 'uint256' },
      { name: 'briefURI', type: 'string' },
      { name: 'deliverableURI', type: 'string' },
      { name: 'budget', type: 'uint256' },
      { name: 'acceptanceDeadline', type: 'uint64' },
      { name: 'deliveryDeadline', type: 'uint64' },
      { name: 'submittedAt', type: 'uint64' },
      { name: 'status', type: 'uint8' },
    ],
  },
  {
    type: 'function',
    name: 'getCommissionApplications',
    stateMutability: 'view',
    inputs: [{ name: 'commissionId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'commissionId', type: 'uint256' },
          { name: 'artistProfileId', type: 'uint256' },
          { name: 'applicationURI', type: 'string' },
          { name: 'createdAt', type: 'uint64' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
  },
] as const

let memeticsSigner: PrivateKeyAccount | null | undefined
let memeticsOwnerSigner: PrivateKeyAccount | null | undefined
let memeticsOwnerWalletClient: WalletClient | null | undefined

export function getMemeticsContractAddress(): Address | null {
  const address = normalizeAddress(CONFIG.MEMETICS_CONTRACT_ADDRESS)
  return address ? (address as Address) : null
}

export function getCommissionManagerContractAddress(): Address | null {
  const address = normalizeAddress(CONFIG.COMMISSION_MANAGER_CONTRACT_ADDRESS)
  return address ? (address as Address) : null
}

export function getMemeticsSigner(): PrivateKeyAccount | null {
  if (memeticsSigner !== undefined) {
    return memeticsSigner
  }

  const privateKey = CONFIG.MEMETICS_SIGNER_PRIVATE_KEY.trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    memeticsSigner = null
    return memeticsSigner
  }

  memeticsSigner = privateKeyToAccount(privateKey as Hex)
  return memeticsSigner
}

export function getMemeticsOwnerSigner(): PrivateKeyAccount | null {
  if (memeticsOwnerSigner !== undefined) {
    return memeticsOwnerSigner
  }

  const privateKey = CONFIG.MEMETICS_OWNER_PRIVATE_KEY.trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    memeticsOwnerSigner = null
    return memeticsOwnerSigner
  }

  memeticsOwnerSigner = privateKeyToAccount(privateKey as Hex)
  return memeticsOwnerSigner
}

export function getMemeticsOwnerWalletClient(): WalletClient | null {
  if (memeticsOwnerWalletClient !== undefined) {
    return memeticsOwnerWalletClient
  }

  const account = getMemeticsOwnerSigner()
  if (!account) {
    memeticsOwnerWalletClient = null
    return memeticsOwnerWalletClient
  }

  memeticsOwnerWalletClient = createWalletClient({
    account,
    chain: base,
    transport: http(CONFIG.PONDER_RPC_URL_8453),
  })
  return memeticsOwnerWalletClient
}

export function createMemeticsSalt(): Hex {
  return `0x${randomBytes(32).toString('hex')}` as Hex
}

export function getMemeticsDeadline(ttlSeconds = 3600): number {
  return Math.floor(Date.now() / 1000) + ttlSeconds
}

export function normalizeMemeticsHandle(handle: string): string {
  const normalized = handle.trim().replace(/^@+/, '').toLowerCase()
  if (!normalized || normalized.length > 15 || !/^[a-z0-9_]+$/.test(normalized)) {
    throw new Error('Invalid handle')
  }
  return normalized
}

export function getMemeticsHandleHash(handle: string): Hex {
  return keccak256(stringToHex(normalizeMemeticsHandle(handle)))
}

export function toMemeticsAssetChain(chain: SupportedChain): MemeticsAssetChain {
  if (chain === 'base') return MemeticsAssetChain.BASE
  if (chain === 'ethereum') return MemeticsAssetChain.ETHEREUM
  if (chain === 'solana') return MemeticsAssetChain.SOLANA
  return MemeticsAssetChain.OTHER
}

export function inferMemeticsAssetKind(input: {
  chain: SupportedChain
  decimals?: number | null
}): MemeticsAssetKind {
  if (input.chain === 'solana') {
    return input.decimals === 0 ? MemeticsAssetKind.SPL_NFT : MemeticsAssetKind.SPL_TOKEN
  }

  return input.decimals === 0 ? MemeticsAssetKind.ERC721 : MemeticsAssetKind.ERC20
}

export function computeMemeticsPrimaryAssetKey(
  chain: MemeticsAssetChain,
  kind: MemeticsAssetKind,
  assetRef: string,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { name: 'chain', type: 'uint8' },
        { name: 'kind', type: 'uint8' },
        { name: 'assetRefHash', type: 'bytes32' },
      ],
      [chain, kind, keccak256(stringToHex(assetRef))],
    ),
  )
}

export async function readWalletProfileId(wallet: string): Promise<number> {
  const contractAddress = getMemeticsContractAddress()
  const normalizedWallet = normalizeAddress(wallet)
  if (!contractAddress || !normalizedWallet) {
    return 0
  }

  const profileId = await publicClients.base.readContract({
    address: contractAddress,
    abi: MEMETICS_ABI,
    functionName: 'walletProfileId',
    args: [normalizedWallet as Address],
  })

  return Number(profileId)
}

export async function readMemeticsProfile(profileId: number): Promise<MemeticsProfile | null> {
  const contractAddress = getMemeticsContractAddress()
  if (!contractAddress || profileId <= 0) {
    return null
  }

  try {
    const result = await publicClients.base.readContract({
      address: contractAddress,
      abi: MEMETICS_ABI,
      functionName: 'getProfile',
      args: [BigInt(profileId)],
    })

    return {
      id: profileId,
      handleHash: result[0] as Hex,
      handle: result[1],
      mainWallet: result[2],
      heatScore: result[3],
      flags: result[4],
      createdAt: Number(result[5]),
      updatedAt: Number(result[6]),
      wallets: result[7] as Address[],
    }
  } catch {
    return null
  }
}

export async function findMemeticsProfileByWallets(
  wallets: string[],
): Promise<{ profile: MemeticsProfile; matchedWallet: Address } | null> {
  const candidates = [...new Set(
    wallets
      .map((wallet) => normalizeAddress(wallet))
      .filter((wallet): wallet is Address => Boolean(wallet)),
  )]

  for (const wallet of candidates) {
    const profileId = await readWalletProfileId(wallet)
    if (profileId <= 0) continue

    const profile = await readMemeticsProfile(profileId)
    if (!profile) continue

    return {
      profile,
      matchedWallet: wallet,
    }
  }

  return null
}

export async function readMemeticsBungalowIdByAssetKey(assetKey: Hex): Promise<number> {
  const contractAddress = getMemeticsContractAddress()
  if (!contractAddress) {
    return 0
  }

  const bungalowId = await publicClients.base.readContract({
    address: contractAddress,
    abi: MEMETICS_ABI,
    functionName: 'bungalowIdByPrimaryAssetKey',
    args: [assetKey],
  })

  return Number(bungalowId)
}

export async function readMemeticsActivePetitionIdByAssetKey(assetKey: Hex): Promise<number> {
  const contractAddress = getMemeticsContractAddress()
  if (!contractAddress) {
    return 0
  }

  const petitionId = await publicClients.base.readContract({
    address: contractAddress,
    abi: MEMETICS_ABI,
    functionName: 'activePetitionIdByPrimaryAssetKey',
    args: [assetKey],
  })

  return Number(petitionId)
}

export async function readMemeticsPetition(petitionId: number) {
  const contractAddress = getMemeticsContractAddress()
  if (!contractAddress || petitionId <= 0) {
    return null
  }

  try {
    const result = await publicClients.base.readContract({
      address: contractAddress,
      abi: MEMETICS_ABI,
      functionName: 'petitions',
      args: [BigInt(petitionId)],
    })

    return {
      id: Number(result[0]),
      proposerProfileId: Number(result[1]),
      bungalowName: result[2],
      metadataURI: result[3],
      primaryAssetKey: result[4] as Hex,
      primaryAssetChain: Number(result[5]),
      primaryAssetKind: Number(result[6]),
      primaryAssetRef: result[7],
      status: Number(result[8]),
      signerCount: Number(result[9]),
      createdAt: Number(result[10]),
    }
  } catch {
    return null
  }
}

export async function hasMemeticsPetitionSignature(
  petitionId: number,
  profileId: number,
): Promise<boolean> {
  const contractAddress = getMemeticsContractAddress()
  if (!contractAddress || petitionId <= 0 || profileId <= 0) {
    return false
  }

  const hasSigned = await publicClients.base.readContract({
    address: contractAddress,
    abi: MEMETICS_ABI,
    functionName: 'petitionSignedByProfile',
    args: [BigInt(petitionId), BigInt(profileId)],
  })

  return Boolean(hasSigned)
}

export async function isMemeticsDailyClaimed(profileId: number, periodId: number): Promise<boolean> {
  const contractAddress = getMemeticsContractAddress()
  if (!contractAddress || profileId <= 0 || periodId < 0) {
    return false
  }

  const claimed = await publicClients.base.readContract({
    address: contractAddress,
    abi: MEMETICS_ABI,
    functionName: 'dailyClaimedByPeriod',
    args: [BigInt(profileId), BigInt(periodId)],
  })

  return Boolean(claimed)
}

export async function readCommissionManagerCommission(
  commissionId: number,
): Promise<CommissionManagerCommission | null> {
  const contractAddress = getCommissionManagerContractAddress()
  if (!contractAddress || commissionId <= 0) {
    return null
  }

  try {
    const result = await publicClients.base.readContract({
      address: contractAddress,
      abi: COMMISSION_MANAGER_ABI,
      functionName: 'commissions',
      args: [BigInt(commissionId)],
    })

    return {
      id: Number(result[0]),
      requesterProfileId: Number(result[1]),
      bungalowId: Number(result[2]),
      artistProfileId: Number(result[3]),
      selectedApplicationId: Number(result[4]),
      briefURI: result[5],
      deliverableURI: result[6],
      budget: result[7],
      acceptanceDeadline: Number(result[8]),
      deliveryDeadline: Number(result[9]),
      submittedAt: Number(result[10]),
      status: Number(result[11]),
    }
  } catch {
    return null
  }
}

export async function readCommissionManagerApplications(
  commissionId: number,
): Promise<CommissionManagerApplication[]> {
  const contractAddress = getCommissionManagerContractAddress()
  if (!contractAddress || commissionId <= 0) {
    return []
  }

  try {
    const result = await publicClients.base.readContract({
      address: contractAddress,
      abi: COMMISSION_MANAGER_ABI,
      functionName: 'getCommissionApplications',
      args: [BigInt(commissionId)],
    })

    return result.map((entry) => ({
      id: Number(entry.id),
      commissionId: Number(entry.commissionId),
      artistProfileId: Number(entry.artistProfileId),
      applicationURI: entry.applicationURI,
      createdAt: Number(entry.createdAt),
      status: Number(entry.status),
    }))
  } catch {
    return []
  }
}

export function decodeMemeticsLog(log: { data: Hex; topics: Hex[]; address?: string }) {
  const contractAddress = getMemeticsContractAddress()
  if (!contractAddress || !log.address || log.address.toLowerCase() !== contractAddress.toLowerCase()) {
    return null
  }

  try {
    return decodeEventLog({
      abi: MEMETICS_ABI,
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
      strict: false,
    })
  } catch {
    return null
  }
}

export function decodeCommissionManagerLog(log: { data: Hex; topics: Hex[]; address?: string }) {
  const contractAddress = getCommissionManagerContractAddress()
  if (!contractAddress || !log.address || log.address.toLowerCase() !== contractAddress.toLowerCase()) {
    return null
  }

  try {
    return decodeEventLog({
      abi: COMMISSION_MANAGER_ABI,
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
      strict: false,
    })
  } catch {
    return null
  }
}
