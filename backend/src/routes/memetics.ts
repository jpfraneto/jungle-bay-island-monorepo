import { Hono } from 'hono'
import { keccak256 } from 'viem'
import {
  CONFIG,
  db,
  normalizeAddress,
  publicClients,
  toSupportedChain,
  type SupportedChain,
} from '../config'
import {
  getAggregatedUserByWallets,
  getBungalow,
  getIdentityClusterByWallet,
  getTokenRegistry,
  getUserByPrivyUserId,
  getUserWallets,
} from '../db/queries'
import { requirePrivyAuth } from '../middleware/auth'
import { getPrivyLinkedAccounts } from '../services/privyClaims'
import { clearCache } from '../services/cache'
import { getCanonicalProjectContext } from '../services/canonicalProjects'
import { COMMUNITY_POLICY } from '../services/communityPolicy'
import { ApiError } from '../services/errors'
import {
  MEMETICS_EIP712_DOMAIN,
  computeMemeticsPrimaryAssetKey,
  createMemeticsSalt,
  decodeMemeticsLog,
  findMemeticsProfileByWallets,
  getMemeticsContractAddress,
  getMemeticsDeadline,
  getMemeticsHandleHash,
  getMemeticsSigner,
  hasMemeticsPetitionSignature,
  inferMemeticsAssetKind,
  normalizeMemeticsHandle,
  readMemeticsActivePetitionIdByAssetKey,
  readMemeticsBungalowIdByAssetKey,
  readMemeticsPetition,
  readMemeticsProfile,
  readWalletProfileId,
  toMemeticsAssetChain,
} from '../services/memetics'
import { resolveTokenMetadata } from '../services/tokenMetadata'
import type { AppEnv } from '../types'

const memeticsRoute = new Hono<AppEnv>()

function extractTwitterHandleFromClaims(claims: Record<string, unknown> | undefined): string | null {
  if (!claims) return null

  for (const account of getPrivyLinkedAccounts(claims)) {
    const candidate = account as Record<string, unknown>
    const type = typeof candidate.type === 'string' ? candidate.type : ''
    if (type !== 'twitter_oauth' && type !== 'twitter') {
      continue
    }

    const username =
      typeof candidate.username === 'string'
        ? candidate.username
        : typeof candidate.screen_name === 'string'
          ? candidate.screen_name
          : ''
    if (!username.trim()) continue

    return normalizeMemeticsHandle(username)
  }

  return null
}

async function resolveAuthorizedWallets(c: any, privyUserId: string): Promise<string[]> {
  const claimWallets = Array.isArray(c.get('walletAddresses'))
    ? (c.get('walletAddresses') as string[])
    : []
  const storedWallets = (await getUserWallets(privyUserId)).map((row) => row.address)

  return [...new Set(
    [...claimWallets, ...storedWallets]
      .map((wallet) => normalizeAddress(wallet) ?? normalizeAddress(wallet, 'solana'))
      .filter((wallet): wallet is string => Boolean(wallet)),
  )]
}

function assertWalletAuthorized(wallet: string | null, authorizedWallets: string[]): string {
  const normalizedWallet = wallet
    ? normalizeAddress(wallet) ?? normalizeAddress(wallet, 'solana')
    : null

  if (!normalizedWallet) {
    throw new ApiError(400, 'invalid_wallet', 'A valid wallet is required')
  }

  if (!authorizedWallets.some((entry) => entry.toLowerCase() === normalizedWallet.toLowerCase())) {
    throw new ApiError(401, 'wallet_not_owned', 'wallet_not_owned')
  }

  return normalizedWallet
}

async function getViewerHeatSnapshot(wallet: string): Promise<{
  islandHeat: number
  wallets: string[]
  evmWallets: string[]
  jbacBalance: bigint
}> {
  const identity = await getIdentityClusterByWallet(wallet)
  const scopedWallets = identity?.wallets.length
    ? identity.wallets.map((entry) => entry.wallet)
    : [wallet]
  const evmWallets = identity?.evm_wallets ?? []
  const aggregated = await getAggregatedUserByWallets(scopedWallets)

  let jbacBalance = 0n
  if (evmWallets.length > 0) {
    const normalizedEvmWallets = [...new Set(evmWallets)]
      .map((entry) => normalizeAddress(entry))
      .filter((entry): entry is `0x${string}` => Boolean(entry))

    const balanceOfAbi = [
      {
        inputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
        name: 'balanceOf',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
      },
    ] as const

    const balances = await Promise.all(
      normalizedEvmWallets.map(async (entry) => {
        try {
          const balance = await publicClients.ethereum.readContract({
            address: COMMUNITY_POLICY.jbac_shortcut_token_address as `0x${string}`,
            abi: balanceOfAbi,
            functionName: 'balanceOf',
            args: [entry],
          })
          return BigInt(balance)
        } catch {
          return 0n
        }
      }),
    )

    jbacBalance = balances.reduce((sum, balance) => sum + balance, 0n)
  }

  return {
    islandHeat: aggregated?.island_heat ?? 0,
    wallets: scopedWallets,
    evmWallets,
    jbacBalance,
  }
}

function pickPreferredHandle(input: {
  userHandle?: string | null
  claimsHandle?: string | null
}): string | null {
  const rawHandle = input.userHandle || input.claimsHandle || null
  if (!rawHandle) return null

  try {
    return normalizeMemeticsHandle(rawHandle)
  } catch {
    return null
  }
}

function getCanonicalPath(input: { slug?: string | null; tokenAddress: string }): string {
  return `/bungalow/${input.slug?.trim() || input.tokenAddress}`
}

async function resolvePrimaryAsset(input: {
  chain: SupportedChain
  tokenAddress: string
}) {
  const projectContext = await getCanonicalProjectContext(input.chain, input.tokenAddress)
  const primaryDeployment = projectContext.primaryDeployment
  const [tokenRegistry, fallbackMetadata] = await Promise.all([
    getTokenRegistry(primaryDeployment.token_address, primaryDeployment.chain),
    resolveTokenMetadata(primaryDeployment.token_address, primaryDeployment.chain).catch(() => null),
  ])

  const primaryAssetChain = toMemeticsAssetChain(primaryDeployment.chain)
  const primaryAssetKind = inferMemeticsAssetKind({
    chain: primaryDeployment.chain,
    decimals: tokenRegistry?.decimals ?? null,
  })
  const primaryAssetRef = primaryDeployment.token_address
  const primaryAssetKey = computeMemeticsPrimaryAssetKey(
    primaryAssetChain,
    primaryAssetKind,
    primaryAssetRef,
  )

  return {
    projectContext,
    primaryDeployment,
    primaryAssetChain,
    primaryAssetKind,
    primaryAssetRef,
    primaryAssetKey,
    tokenName: tokenRegistry?.name ?? fallbackMetadata?.name ?? null,
    tokenSymbol: tokenRegistry?.symbol ?? fallbackMetadata?.symbol ?? null,
    imageUrl: fallbackMetadata?.image_url ?? null,
  }
}

memeticsRoute.get('/memetics/me', requirePrivyAuth, async (c) => {
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const [userRow, authorizedWallets] = await Promise.all([
    getUserByPrivyUserId(privyUserId),
    resolveAuthorizedWallets(c, privyUserId),
  ])
  const preferredHandle = pickPreferredHandle({
    userHandle: userRow?.x_username ?? null,
    claimsHandle: extractTwitterHandleFromClaims(claims),
  })
  const aggregated = authorizedWallets.length > 0
    ? await getAggregatedUserByWallets(authorizedWallets)
    : null
  const profileMatch = authorizedWallets.length > 0
    ? await findMemeticsProfileByWallets(authorizedWallets)
    : null

  return c.json({
    contract_address: getMemeticsContractAddress(),
    preferred_handle: preferredHandle,
    backend_heat_score: aggregated?.island_heat ?? 0,
    authenticated_wallets: authorizedWallets,
    profile: profileMatch
      ? {
          id: profileMatch.profile.id,
          handle: profileMatch.profile.handle,
          handle_hash: profileMatch.profile.handleHash,
          main_wallet: profileMatch.profile.mainWallet,
          heat_score: profileMatch.profile.heatScore.toString(),
          flags: profileMatch.profile.flags.toString(),
          created_at: profileMatch.profile.createdAt,
          updated_at: profileMatch.profile.updatedAt,
          wallets: profileMatch.profile.wallets,
        }
      : null,
  })
})

memeticsRoute.post('/memetics/register/sign', requirePrivyAuth, async (c) => {
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const signer = getMemeticsSigner()
  const contractAddress = getMemeticsContractAddress()
  if (!signer || !contractAddress) {
    throw new ApiError(500, 'memetics_not_configured', 'Memetics contract signer is not configured')
  }

  const body = await c.req.json<{ wallet?: unknown }>()
  const [userRow, authorizedWallets] = await Promise.all([
    getUserByPrivyUserId(privyUserId),
    resolveAuthorizedWallets(c, privyUserId),
  ])
  const selectedWallet = assertWalletAuthorized(
    typeof body.wallet === 'string' ? body.wallet : c.get('walletAddress') ?? null,
    authorizedWallets,
  )
  const preferredHandle = pickPreferredHandle({
    userHandle: userRow?.x_username ?? null,
    claimsHandle: extractTwitterHandleFromClaims(claims),
  })
  if (!preferredHandle) {
    throw new ApiError(403, 'handle_required', 'Link your X handle before creating an onchain profile')
  }

  if (await readWalletProfileId(selectedWallet)) {
    throw new ApiError(409, 'wallet_already_linked', 'This wallet is already linked to an onchain profile')
  }

  const existingProfile = await findMemeticsProfileByWallets(authorizedWallets)
  if (existingProfile) {
    throw new ApiError(409, 'profile_exists', 'This account already has an onchain profile')
  }

  const aggregated = await getAggregatedUserByWallets(authorizedWallets)
  const heatScore = Math.max(0, Math.round(aggregated?.island_heat ?? 0))
  const salt = createMemeticsSalt()
  const deadline = getMemeticsDeadline()

  const sig = await signer.signTypedData({
    domain: {
      ...MEMETICS_EIP712_DOMAIN,
      verifyingContract: contractAddress,
    },
    types: {
      RegisterProfile: [
        { name: 'wallet', type: 'address' },
        { name: 'handleHash', type: 'bytes32' },
        { name: 'heatScore', type: 'uint256' },
        { name: 'salt', type: 'bytes32' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'RegisterProfile',
    message: {
      wallet: selectedWallet as `0x${string}`,
      handleHash: getMemeticsHandleHash(preferredHandle),
      heatScore: BigInt(heatScore),
      salt,
      deadline: BigInt(deadline),
    },
  })

  return c.json({
    contract_address: contractAddress,
    wallet: selectedWallet,
    handle: preferredHandle,
    heat_score: heatScore,
    salt,
    deadline,
    sig,
  })
})

memeticsRoute.post('/memetics/link-wallet/sign', requirePrivyAuth, async (c) => {
  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const signer = getMemeticsSigner()
  const contractAddress = getMemeticsContractAddress()
  if (!signer || !contractAddress) {
    throw new ApiError(500, 'memetics_not_configured', 'Memetics contract signer is not configured')
  }

  const body = await c.req.json<{ wallet?: unknown }>()
  const authorizedWallets = await resolveAuthorizedWallets(c, privyUserId)
  const selectedWallet = assertWalletAuthorized(
    typeof body.wallet === 'string' ? body.wallet : c.get('walletAddress') ?? null,
    authorizedWallets,
  )
  if (await readWalletProfileId(selectedWallet)) {
    throw new ApiError(409, 'wallet_already_linked', 'This wallet is already linked to an onchain profile')
  }

  const existingProfile = await findMemeticsProfileByWallets(
    authorizedWallets.filter((wallet) => wallet.toLowerCase() !== selectedWallet.toLowerCase()),
  )
  if (!existingProfile) {
    throw new ApiError(404, 'profile_not_found', 'Create your onchain profile before linking more wallets')
  }

  const aggregated = await getAggregatedUserByWallets(authorizedWallets)
  const heatScore = Math.max(0, Math.round(aggregated?.island_heat ?? 0))
  const salt = createMemeticsSalt()
  const deadline = getMemeticsDeadline()

  const sig = await signer.signTypedData({
    domain: {
      ...MEMETICS_EIP712_DOMAIN,
      verifyingContract: contractAddress,
    },
    types: {
      LinkWallet: [
        { name: 'profileId', type: 'uint256' },
        { name: 'wallet', type: 'address' },
        { name: 'heatScore', type: 'uint256' },
        { name: 'salt', type: 'bytes32' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'LinkWallet',
    message: {
      profileId: BigInt(existingProfile.profile.id),
      wallet: selectedWallet as `0x${string}`,
      heatScore: BigInt(heatScore),
      salt,
      deadline: BigInt(deadline),
    },
  })

  return c.json({
    contract_address: contractAddress,
    profile_id: existingProfile.profile.id,
    wallet: selectedWallet,
    heat_score: heatScore,
    salt,
    deadline,
    sig,
  })
})

memeticsRoute.post('/memetics/sync-heat/sign', requirePrivyAuth, async (c) => {
  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const signer = getMemeticsSigner()
  const contractAddress = getMemeticsContractAddress()
  if (!signer || !contractAddress) {
    throw new ApiError(500, 'memetics_not_configured', 'Memetics contract signer is not configured')
  }

  const body = await c.req.json<{ wallet?: unknown }>()
  const authorizedWallets = await resolveAuthorizedWallets(c, privyUserId)
  const selectedWallet = assertWalletAuthorized(
    typeof body.wallet === 'string' ? body.wallet : c.get('walletAddress') ?? null,
    authorizedWallets,
  )
  const profileId = await readWalletProfileId(selectedWallet)
  if (!profileId) {
    throw new ApiError(404, 'profile_not_found', 'This wallet is not linked to an onchain profile')
  }

  const aggregated = await getAggregatedUserByWallets(authorizedWallets)
  const heatScore = Math.max(0, Math.round(aggregated?.island_heat ?? 0))
  const salt = createMemeticsSalt()
  const deadline = getMemeticsDeadline()

  const sig = await signer.signTypedData({
    domain: {
      ...MEMETICS_EIP712_DOMAIN,
      verifyingContract: contractAddress,
    },
    types: {
      SyncHeat: [
        { name: 'profileId', type: 'uint256' },
        { name: 'heatScore', type: 'uint256' },
        { name: 'salt', type: 'bytes32' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'SyncHeat',
    message: {
      profileId: BigInt(profileId),
      heatScore: BigInt(heatScore),
      salt,
      deadline: BigInt(deadline),
    },
  })

  return c.json({
    contract_address: contractAddress,
    profile_id: profileId,
    wallet: selectedWallet,
    heat_score: heatScore,
    salt,
    deadline,
    sig,
  })
})

memeticsRoute.get('/memetics/bungalow/:chain/:ca/qualification', async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  if (!chain) {
    throw new ApiError(400, 'invalid_chain', 'Invalid chain')
  }

  const tokenAddress = normalizeAddress(c.req.param('ca'), chain)
  if (!tokenAddress) {
    throw new ApiError(400, 'invalid_token', 'Invalid token address')
  }

  const primaryAsset = await resolvePrimaryAsset({
    chain,
    tokenAddress,
  })
  const [bungalowId, activePetitionId] = await Promise.all([
    readMemeticsBungalowIdByAssetKey(primaryAsset.primaryAssetKey),
    readMemeticsActivePetitionIdByAssetKey(primaryAsset.primaryAssetKey),
  ])
  const petition = activePetitionId > 0
    ? await readMemeticsPetition(activePetitionId)
    : null

  const rawViewerWallet = c.req.query('viewer_wallet')
  const viewerWallet =
    (rawViewerWallet ? normalizeAddress(rawViewerWallet) : null) ??
    (rawViewerWallet ? normalizeAddress(rawViewerWallet, 'solana') : null) ??
    c.get('walletAddress') ??
    null

  const viewerSnapshot = viewerWallet
    ? await getViewerHeatSnapshot(viewerWallet)
    : null
  const viewerProfileId = viewerWallet ? await readWalletProfileId(viewerWallet) : 0
  const hasSupported =
    petition && viewerProfileId > 0
      ? await hasMemeticsPetitionSignature(petition.id, viewerProfileId)
      : false

  const qualificationPath =
    viewerSnapshot?.islandHeat !== undefined
      ? viewerSnapshot.islandHeat >= 65
        ? 'single_hot_wallet'
        : viewerSnapshot.jbacBalance >= COMMUNITY_POLICY.jbac_shortcut_min_balance
          ? 'jbac_shortcut'
          : petition
            ? 'community_support'
            : viewerSnapshot.islandHeat >= 50
              ? 'community_support'
              : null
      : null

  return c.json({
    token_address: primaryAsset.primaryDeployment.token_address,
    chain: primaryAsset.primaryDeployment.chain,
    exists: bungalowId > 0,
    thresholds: {
      submit_heat_min: 50,
      support_heat_min: 50,
      single_builder_heat_min: 65,
      required_supporters: 5,
      jbac_shortcut_min_balance: COMMUNITY_POLICY.jbac_shortcut_min_balance.toString(),
      steward_heat_min: COMMUNITY_POLICY.bungalow_steward_min_heat,
    },
    support: {
      supporter_count: petition?.signerCount ?? 0,
      required_supporters: 5,
      has_supported: hasSupported,
      community_support_ready: bungalowId > 0 || (petition?.signerCount ?? 0) >= 5,
    },
    viewer: viewerSnapshot
      ? {
          island_heat: Number(viewerSnapshot.islandHeat.toFixed(2)),
          jbac_balance: viewerSnapshot.jbacBalance.toString(),
          has_supported: hasSupported,
          can_submit_to_bungalow: viewerSnapshot.islandHeat >= 50,
          can_support:
            activePetitionId > 0 &&
            viewerProfileId > 0 &&
            viewerSnapshot.islandHeat >= 50 &&
            !hasSupported,
          can_create_petition:
            bungalowId === 0 &&
            activePetitionId === 0 &&
            (viewerSnapshot.islandHeat >= 50 ||
              viewerSnapshot.jbacBalance >= COMMUNITY_POLICY.jbac_shortcut_min_balance),
          profile_ready: viewerProfileId > 0,
          qualifies_to_construct_now:
            bungalowId === 0 &&
            activePetitionId === 0 &&
            (viewerSnapshot.islandHeat >= 50 ||
              viewerSnapshot.jbacBalance >= COMMUNITY_POLICY.jbac_shortcut_min_balance),
          qualification_path: qualificationPath,
          active_petition_id: activePetitionId || null,
          profile_id: viewerProfileId || null,
        }
      : null,
    token: {
      name: primaryAsset.tokenName,
      symbol: primaryAsset.tokenSymbol,
      image_url: primaryAsset.imageUrl,
    },
    canonical_path: getCanonicalPath({
      slug: primaryAsset.projectContext.project?.slug ?? null,
      tokenAddress: primaryAsset.primaryDeployment.token_address,
    }),
    contract: {
      contract_address: getMemeticsContractAddress(),
      bungalow_id: bungalowId || null,
      petition_id: activePetitionId || null,
      primary_asset_key: primaryAsset.primaryAssetKey,
      primary_asset_chain: primaryAsset.primaryAssetChain,
      primary_asset_kind: primaryAsset.primaryAssetKind,
      primary_asset_ref: primaryAsset.primaryAssetRef,
    },
  })
})

memeticsRoute.post('/memetics/bungalow/:chain/:ca/create/sign', requirePrivyAuth, async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  if (!chain) {
    throw new ApiError(400, 'invalid_chain', 'Invalid chain')
  }

  const tokenAddress = normalizeAddress(c.req.param('ca'), chain)
  if (!tokenAddress) {
    throw new ApiError(400, 'invalid_token', 'Invalid token address')
  }

  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const signer = getMemeticsSigner()
  const contractAddress = getMemeticsContractAddress()
  if (!signer || !contractAddress) {
    throw new ApiError(500, 'memetics_not_configured', 'Memetics contract signer is not configured')
  }

  const body = await c.req.json<{
    wallet?: unknown
    bungalow_name?: unknown
    metadata_uri?: unknown
  }>()
  const authorizedWallets = await resolveAuthorizedWallets(c, privyUserId)
  const selectedWallet = assertWalletAuthorized(
    typeof body.wallet === 'string' ? body.wallet : c.get('walletAddress') ?? null,
    authorizedWallets,
  )
  const profileId = await readWalletProfileId(selectedWallet)
  if (!profileId) {
    throw new ApiError(403, 'profile_required', 'Create your onchain profile before opening a bungalow')
  }

  const primaryAsset = await resolvePrimaryAsset({
    chain,
    tokenAddress,
  })
  const [existingBungalowId, activePetitionId, viewerSnapshot] = await Promise.all([
    readMemeticsBungalowIdByAssetKey(primaryAsset.primaryAssetKey),
    readMemeticsActivePetitionIdByAssetKey(primaryAsset.primaryAssetKey),
    getViewerHeatSnapshot(selectedWallet),
  ])
  if (existingBungalowId > 0) {
    throw new ApiError(409, 'already_exists', 'This bungalow is already open onchain')
  }
  if (activePetitionId > 0) {
    throw new ApiError(409, 'petition_exists', 'A petition for this bungalow is already active')
  }

  const heatScore = Math.max(0, Math.round(viewerSnapshot.islandHeat))
  const attestedApesBalance = viewerSnapshot.jbacBalance
  if (heatScore < 50 && attestedApesBalance < COMMUNITY_POLICY.jbac_shortcut_min_balance) {
    throw new ApiError(403, 'not_qualified', 'This wallet does not meet the current bungalow creation threshold')
  }

  const bungalowName =
    typeof body.bungalow_name === 'string' && body.bungalow_name.trim()
      ? body.bungalow_name.trim().slice(0, 80)
      : primaryAsset.tokenName || primaryAsset.tokenSymbol || primaryAsset.primaryDeployment.token_address
  const metadataURI =
    typeof body.metadata_uri === 'string'
      ? body.metadata_uri.trim().slice(0, 512)
      : ''
  const salt = createMemeticsSalt()
  const deadline = getMemeticsDeadline()

  const sig = await signer.signTypedData({
    domain: {
      ...MEMETICS_EIP712_DOMAIN,
      verifyingContract: contractAddress,
    },
    types: {
      CreateBungalowPetition: [
        { name: 'profileId', type: 'uint256' },
        { name: 'wallet', type: 'address' },
        { name: 'bungalowNameHash', type: 'bytes32' },
        { name: 'metadataURIHash', type: 'bytes32' },
        { name: 'primaryAssetChain', type: 'uint8' },
        { name: 'primaryAssetKind', type: 'uint8' },
        { name: 'primaryAssetRefHash', type: 'bytes32' },
        { name: 'heatScore', type: 'uint256' },
        { name: 'attestedApesBalance', type: 'uint256' },
        { name: 'salt', type: 'bytes32' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'CreateBungalowPetition',
    message: {
      profileId: BigInt(profileId),
      wallet: selectedWallet as `0x${string}`,
      bungalowNameHash: keccak256(`0x${Buffer.from(bungalowName, 'utf8').toString('hex')}`),
      metadataURIHash: keccak256(`0x${Buffer.from(metadataURI, 'utf8').toString('hex')}`),
      primaryAssetChain: primaryAsset.primaryAssetChain,
      primaryAssetKind: primaryAsset.primaryAssetKind,
      primaryAssetRefHash: keccak256(`0x${Buffer.from(primaryAsset.primaryAssetRef, 'utf8').toString('hex')}`),
      heatScore: BigInt(heatScore),
      attestedApesBalance,
      salt,
      deadline: BigInt(deadline),
    },
  })

  return c.json({
    contract_address: contractAddress,
    wallet: selectedWallet,
    profile_id: profileId,
    bungalow_name: bungalowName,
    metadata_uri: metadataURI,
    heat_score: heatScore,
    attested_apes_balance: attestedApesBalance.toString(),
    primary_asset_chain: primaryAsset.primaryAssetChain,
    primary_asset_kind: primaryAsset.primaryAssetKind,
    primary_asset_ref: primaryAsset.primaryAssetRef,
    primary_asset_key: primaryAsset.primaryAssetKey,
    salt,
    deadline,
    sig,
  })
})

memeticsRoute.post('/memetics/bungalow/:chain/:ca/petition/sign', requirePrivyAuth, async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  if (!chain) {
    throw new ApiError(400, 'invalid_chain', 'Invalid chain')
  }

  const tokenAddress = normalizeAddress(c.req.param('ca'), chain)
  if (!tokenAddress) {
    throw new ApiError(400, 'invalid_token', 'Invalid token address')
  }

  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const signer = getMemeticsSigner()
  const contractAddress = getMemeticsContractAddress()
  if (!signer || !contractAddress) {
    throw new ApiError(500, 'memetics_not_configured', 'Memetics contract signer is not configured')
  }

  const body = await c.req.json<{ wallet?: unknown }>()
  const authorizedWallets = await resolveAuthorizedWallets(c, privyUserId)
  const selectedWallet = assertWalletAuthorized(
    typeof body.wallet === 'string' ? body.wallet : c.get('walletAddress') ?? null,
    authorizedWallets,
  )
  const profileId = await readWalletProfileId(selectedWallet)
  if (!profileId) {
    throw new ApiError(403, 'profile_required', 'Create your onchain profile before signing petitions')
  }

  const primaryAsset = await resolvePrimaryAsset({
    chain,
    tokenAddress,
  })
  const petitionId = await readMemeticsActivePetitionIdByAssetKey(primaryAsset.primaryAssetKey)
  if (!petitionId) {
    throw new ApiError(404, 'petition_not_found', 'No active petition exists for this bungalow yet')
  }

  if (await hasMemeticsPetitionSignature(petitionId, profileId)) {
    throw new ApiError(409, 'already_signed', 'This profile already signed the active petition')
  }

  const viewerSnapshot = await getViewerHeatSnapshot(selectedWallet)
  const heatScore = Math.max(0, Math.round(viewerSnapshot.islandHeat))
  if (heatScore < 50) {
    throw new ApiError(403, 'not_qualified', 'You need at least 50 heat to sign this petition')
  }

  const salt = createMemeticsSalt()
  const deadline = getMemeticsDeadline()

  const sig = await signer.signTypedData({
    domain: {
      ...MEMETICS_EIP712_DOMAIN,
      verifyingContract: contractAddress,
    },
    types: {
      SignBungalowPetition: [
        { name: 'profileId', type: 'uint256' },
        { name: 'wallet', type: 'address' },
        { name: 'petitionId', type: 'uint256' },
        { name: 'heatScore', type: 'uint256' },
        { name: 'salt', type: 'bytes32' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'SignBungalowPetition',
    message: {
      profileId: BigInt(profileId),
      wallet: selectedWallet as `0x${string}`,
      petitionId: BigInt(petitionId),
      heatScore: BigInt(heatScore),
      salt,
      deadline: BigInt(deadline),
    },
  })

  return c.json({
    contract_address: contractAddress,
    wallet: selectedWallet,
    profile_id: profileId,
    petition_id: petitionId,
    heat_score: heatScore,
    salt,
    deadline,
    sig,
  })
})

memeticsRoute.post('/memetics/bungalow/:chain/:ca/confirm', requirePrivyAuth, async (c) => {
  const chain = toSupportedChain(c.req.param('chain'))
  if (!chain) {
    throw new ApiError(400, 'invalid_chain', 'Invalid chain')
  }

  const tokenAddress = normalizeAddress(c.req.param('ca'), chain)
  if (!tokenAddress) {
    throw new ApiError(400, 'invalid_token', 'Invalid token address')
  }

  const privyUserId = c.get('privyUserId')
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const body = await c.req.json<{ tx_hash?: unknown }>()
  const txHash = typeof body.tx_hash === 'string' ? body.tx_hash.trim().toLowerCase() : ''
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new ApiError(400, 'invalid_tx_hash', 'tx_hash must be a valid transaction hash')
  }

  const primaryAsset = await resolvePrimaryAsset({
    chain,
    tokenAddress,
  })
  const authorizedWallets = await resolveAuthorizedWallets(c, privyUserId)
  const receipt = await publicClients.base.getTransactionReceipt({
    hash: txHash as `0x${string}`,
  })
  if (receipt.status !== 'success') {
    throw new ApiError(409, 'tx_failed', 'Transaction did not succeed onchain')
  }
  if (!authorizedWallets.some((wallet) => wallet.toLowerCase() === receipt.from.toLowerCase())) {
    throw new ApiError(401, 'wallet_not_owned', 'wallet_not_owned')
  }

  const decodedLogs = receipt.logs
    .map((log) =>
      decodeMemeticsLog({
        address: log.address,
        data: log.data,
        topics: log.topics as `0x${string}`[],
      }),
    )
    .filter((log): log is NonNullable<ReturnType<typeof decodeMemeticsLog>> => Boolean(log))

  const createdEvent = decodedLogs.find(
    (log) =>
      log.eventName === 'BungalowCreated' &&
      log.args.primaryAssetKey?.toLowerCase() === primaryAsset.primaryAssetKey.toLowerCase(),
  )

  let petitionId = 0
  const petitionCreatedEvent = decodedLogs.find(
    (log) =>
      log.eventName === 'PetitionCreated' &&
      log.args.primaryAssetKey?.toLowerCase() === primaryAsset.primaryAssetKey.toLowerCase(),
  )
  if (petitionCreatedEvent) {
    petitionId = Number((petitionCreatedEvent.args as any).petitionId ?? 0)
  }

  const petitionSignedEvent = decodedLogs.find((log) => log.eventName === 'PetitionSigned')
  if (!petitionId && petitionSignedEvent) {
    petitionId = Number((petitionSignedEvent.args as any).petitionId ?? 0)
    const petition = petitionId > 0 ? await readMemeticsPetition(petitionId) : null
    if (!petition || petition.primaryAssetKey.toLowerCase() !== primaryAsset.primaryAssetKey.toLowerCase()) {
      petitionId = 0
    }
  }

  if (!createdEvent && !petitionId) {
    throw new ApiError(409, 'unexpected_receipt', 'The transaction did not emit the expected Memetics bungalow events')
  }

  let bungalow = await getBungalow(
    primaryAsset.primaryDeployment.token_address,
    primaryAsset.primaryDeployment.chain,
  )

  if (createdEvent) {
    const adminProfileId = Number((createdEvent.args as any).adminProfileId ?? 0)
    const adminProfile = adminProfileId > 0 ? await readMemeticsProfile(adminProfileId) : null
    const adminWallet = adminProfile?.mainWallet ?? receipt.from

    await db`
      INSERT INTO ${db(CONFIG.SCHEMA)}.bungalows (
        token_address,
        chain,
        name,
        symbol,
        verified_admin,
        claimed_by_privy_user_id,
        is_claimed,
        updated_at
      )
      VALUES (
        ${primaryAsset.primaryDeployment.token_address},
        ${primaryAsset.primaryDeployment.chain},
        ${primaryAsset.tokenName},
        ${primaryAsset.tokenSymbol},
        ${adminWallet},
        ${privyUserId},
        TRUE,
        NOW()
      )
      ON CONFLICT (token_address)
      DO UPDATE SET
        chain = EXCLUDED.chain,
        name = COALESCE(EXCLUDED.name, ${db(CONFIG.SCHEMA)}.bungalows.name),
        symbol = COALESCE(EXCLUDED.symbol, ${db(CONFIG.SCHEMA)}.bungalows.symbol),
        verified_admin = EXCLUDED.verified_admin,
        claimed_by_privy_user_id = EXCLUDED.claimed_by_privy_user_id,
        is_claimed = TRUE,
        updated_at = NOW()
    `

    for (const deployment of primaryAsset.projectContext.deployments) {
      clearCache(`bungalow:${deployment.chain}:${deployment.token_address}`)
    }

    bungalow = await getBungalow(
      primaryAsset.primaryDeployment.token_address,
      primaryAsset.primaryDeployment.chain,
    )
  }

  const petition = petitionId > 0 ? await readMemeticsPetition(petitionId) : null
  const canonicalPath = getCanonicalPath({
    slug: primaryAsset.projectContext.project?.slug ?? null,
    tokenAddress: primaryAsset.primaryDeployment.token_address,
  })

  return c.json({
    ok: true,
    created: Boolean(createdEvent),
    petition_id: petitionId || null,
    supporter_count: petition?.signerCount ?? (createdEvent ? 5 : 0),
    bungalow: {
      chain: primaryAsset.primaryDeployment.chain,
      token_address: primaryAsset.primaryDeployment.token_address,
      canonical_path: canonicalPath,
      is_claimed: bungalow?.is_claimed ?? Boolean(createdEvent),
      verified_admin: bungalow?.verified_admin ?? null,
    },
  })
})

export default memeticsRoute
