import { Hono } from 'hono'
import { verifyMessage } from 'viem'
import { normalizeAddress } from '../config'
import {
  getUserWallets,
  removeUserWallet,
  upsertUser,
  upsertUserWalletLinks,
  userOwnsWallet,
} from '../db/queries'
import { requirePrivyAuth } from '../middleware/auth'
import { ApiError } from '../services/errors'
import { extractPrivyXUsername, getPrivyLinkedAccounts } from '../services/privyClaims'
import { fetchPrivyUserLinkedAccounts } from '../services/privyServer'
import type { AppEnv } from '../types'

const walletLinkRoute = new Hono<AppEnv>()

const SIWE_NONCE_TTL_MS = 5 * 60 * 1000
const siweNonceStore = new Map<string, { nonce: string; expiresAt: number }>()
type WalletLinkSource = 'privy_siwe' | 'privy_siws'

function normalizeXUsername(value: string): string {
  const clean = value.trim().replace(/^@+/, '').toLowerCase()
  return clean ? `@${clean}` : ''
}

function extractUserIdentityFromClaims(claims: Record<string, unknown>): {
  privyUserId: string
  xUsername: string | null
} {
  const privyUserId = typeof claims.sub === 'string' ? claims.sub.trim() : ''
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy user id missing from token')
  }

  const xUsername = extractPrivyXUsername(claims)

  return {
    privyUserId,
    xUsername: xUsername ? normalizeXUsername(xUsername) : null,
  }
}

function extractNonce(message: string): string {
  const match = message.match(/\bnonce:\s*([^\n\r]+)/i)
  return match?.[1]?.trim() ?? ''
}

function extractAddressFromSiweMessage(message: string): string | null {
  const match = message.match(/\b0x[a-fA-F0-9]{40}\b/)
  if (!match) return null
  return normalizeAddress(match[0])
}

function assertFreshSiweNonce(address: string, nonce: string): void {
  if (!nonce) {
    throw new ApiError(400, 'invalid_message', 'SIWE message must include a nonce')
  }

  const now = Date.now()
  const existing = siweNonceStore.get(address)

  if (existing && existing.expiresAt <= now) {
    siweNonceStore.delete(address)
  }

  const active = siweNonceStore.get(address)
  if (active && active.nonce === nonce && active.expiresAt > now) {
    throw new ApiError(400, 'invalid_nonce', 'SIWE nonce has already been used')
  }

  siweNonceStore.set(address, {
    nonce,
    expiresAt: now + SIWE_NONCE_TTL_MS,
  })
}

function normalizeLinkedClaimWallet(input: Record<string, unknown>): {
  address: string
  source: WalletLinkSource
} | null {
  const rawAddress = typeof input.address === 'string' ? input.address.trim() : ''
  if (!rawAddress) return null

  const walletClientType = typeof input.wallet_client_type === 'string'
    ? input.wallet_client_type.trim().toLowerCase()
    : typeof input.wallet_client === 'string'
      ? input.wallet_client.trim().toLowerCase()
      : ''
  const connectorType = typeof input.connector_type === 'string'
    ? input.connector_type.trim().toLowerCase()
    : ''

  if (walletClientType.startsWith('privy') || connectorType === 'embedded') {
    return null
  }

  const chainType = typeof input.chain_type === 'string' ? input.chain_type.trim().toLowerCase() : ''
  const looksEvm = rawAddress.startsWith('0x') || chainType.includes('eip155') || chainType.includes('evm') || chainType.includes('ethereum')
  const looksSolana = chainType.includes('solana')

  if (looksEvm) {
    const normalized = normalizeAddress(rawAddress)
    if (!normalized) return null
    return { address: normalized, source: 'privy_siwe' }
  }

  if (looksSolana) {
    const normalized = normalizeAddress(rawAddress, 'solana')
    if (!normalized) return null
    return { address: normalized, source: 'privy_siws' }
  }

  const fallbackEvm = normalizeAddress(rawAddress)
  if (fallbackEvm) {
    return { address: fallbackEvm, source: 'privy_siwe' }
  }

  const fallbackSolana = normalizeAddress(rawAddress, 'solana')
  if (fallbackSolana) {
    return { address: fallbackSolana, source: 'privy_siws' }
  }

  return null
}

function extractWalletsFromLinkedAccounts(linkedAccounts: Array<Record<string, unknown>>): Array<{
  address: string
  source: WalletLinkSource
}> {
  const dedup = new Map<string, WalletLinkSource>()

  for (const account of linkedAccounts) {
    const candidate = account as Record<string, unknown>
    const type = typeof candidate.type === 'string' ? candidate.type : ''
    if (type !== 'wallet') continue

    const normalized = normalizeLinkedClaimWallet(candidate)
    if (!normalized) continue

    const existing = dedup.get(normalized.address)
    if (existing === 'privy_siwe' && normalized.source === 'privy_siws') {
      dedup.set(normalized.address, normalized.source)
      continue
    }
    if (!existing) {
      dedup.set(normalized.address, normalized.source)
    }
  }

  return [...dedup.entries()].map(([address, source]) => ({ address, source }))
}

async function syncWalletsFromClaims(privyUserId: string, claims: Record<string, unknown>) {
  const linkedAccountsFromPrivy = await fetchPrivyUserLinkedAccounts(privyUserId)
  const linkedAccounts = linkedAccountsFromPrivy ?? getPrivyLinkedAccounts(claims)
  const linkedWallets = extractWalletsFromLinkedAccounts(linkedAccounts)

  for (const wallet of linkedWallets) {
    await upsertUserWalletLinks(privyUserId, wallet.address, wallet.source)
  }
  return getUserWallets(privyUserId)
}

walletLinkRoute.post('/user/link-wallet', requirePrivyAuth, async (c) => {
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  if (!claims) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const { privyUserId, xUsername } = extractUserIdentityFromClaims(claims)

  const body = await c.req.json<{
    address?: unknown
    signature?: unknown
    message?: unknown
  }>()

  const normalizedAddress = typeof body.address === 'string' ? normalizeAddress(body.address) : null
  if (!normalizedAddress) {
    throw new ApiError(400, 'invalid_address', 'address must be a valid EVM address')
  }

  const signature = typeof body.signature === 'string' ? body.signature.trim() : ''
  if (!signature) {
    throw new ApiError(400, 'invalid_signature', 'signature is required')
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) {
    throw new ApiError(400, 'invalid_message', 'message is required')
  }

  const nonce = extractNonce(message)
  assertFreshSiweNonce(normalizedAddress, nonce)

  const addressInMessage = extractAddressFromSiweMessage(message)
  if (addressInMessage && addressInMessage !== normalizedAddress) {
    throw new ApiError(400, 'invalid_message', 'SIWE message address does not match request address')
  }

  const valid = await verifyMessage({
    address: normalizedAddress as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  })

  if (!valid) {
    throw new ApiError(401, 'invalid_signature', 'SIWE signature verification failed')
  }

  await upsertUser(privyUserId, {
    x_username: xUsername ?? undefined,
  })

  await upsertUserWalletLinks(privyUserId, normalizedAddress, 'privy_siwe')

  const wallets = await getUserWallets(privyUserId)
  return c.json({
    success: true,
    wallets,
  })
})

walletLinkRoute.get('/user/wallets', requirePrivyAuth, async (c) => {
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  if (!claims) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const { privyUserId, xUsername } = extractUserIdentityFromClaims(claims)

  await upsertUser(privyUserId, {
    x_username: xUsername ?? undefined,
  })

  const wallets = await syncWalletsFromClaims(privyUserId, claims)
  return c.json({ wallets })
})

walletLinkRoute.post('/user/sync-wallets', requirePrivyAuth, async (c) => {
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  if (!claims) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const { privyUserId, xUsername } = extractUserIdentityFromClaims(claims)

  await upsertUser(privyUserId, {
    x_username: xUsername ?? undefined,
  })

  const wallets = await syncWalletsFromClaims(privyUserId, claims)
  return c.json({
    success: true,
    wallets,
  })
})

walletLinkRoute.delete('/user/link-wallet/:address', requirePrivyAuth, async (c) => {
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  if (!claims) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const { privyUserId } = extractUserIdentityFromClaims(claims)

  const address = normalizeAddress(c.req.param('address')) ?? normalizeAddress(c.req.param('address'), 'solana')
  if (!address) {
    throw new ApiError(400, 'invalid_address', 'Invalid wallet address')
  }

  const ownsWallet = await userOwnsWallet(privyUserId, address)
  if (!ownsWallet) {
    throw new ApiError(401, 'wallet_not_owned', 'Wallet is not linked to this profile')
  }

  await removeUserWallet(privyUserId, address)
  const wallets = await getUserWallets(privyUserId)

  return c.json({
    success: true,
    wallets,
  })
})

export default walletLinkRoute
