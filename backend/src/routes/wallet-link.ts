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
import { getPrivyLinkedAccounts } from '../services/privyClaims'
import type { AppEnv } from '../types'

const walletLinkRoute = new Hono<AppEnv>()

const SIWE_NONCE_TTL_MS = 5 * 60 * 1000
const siweNonceStore = new Map<string, { nonce: string; expiresAt: number }>()

function normalizeXUsername(value: string): string {
  const clean = value.trim().replace(/^@+/, '').toLowerCase()
  return clean ? `@${clean}` : ''
}

function extractUserIdentityFromClaims(claims: Record<string, unknown>): {
  privyUserId: string
  email: string | null
  xUsername: string | null
} {
  const privyUserId = typeof claims.sub === 'string' ? claims.sub.trim() : ''
  if (!privyUserId) {
    throw new ApiError(401, 'auth_required', 'Privy user id missing from token')
  }

  let email: string | null = null
  let xUsername: string | null = null

  const linkedAccounts = getPrivyLinkedAccounts(claims)
  for (const account of linkedAccounts) {
    const candidate = account as Record<string, unknown>
    const type = typeof candidate.type === 'string' ? candidate.type : ''

    if (!email && type === 'email') {
      const address = typeof candidate.address === 'string' ? candidate.address.trim().toLowerCase() : ''
      if (address) {
        email = address
      }
    }

    if (!xUsername && (type === 'twitter_oauth' || type === 'twitter')) {
      const username =
        typeof candidate.username === 'string'
          ? candidate.username
          : typeof candidate.screen_name === 'string'
            ? candidate.screen_name
            : ''
      const normalized = normalizeXUsername(username)
      if (normalized) {
        xUsername = normalized
      }
    }
  }

  return {
    privyUserId,
    email,
    xUsername,
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

walletLinkRoute.post('/user/link-wallet', requirePrivyAuth, async (c) => {
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  if (!claims) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const { privyUserId, email, xUsername } = extractUserIdentityFromClaims(claims)

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
    email: email ?? undefined,
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

  const { privyUserId, email, xUsername } = extractUserIdentityFromClaims(claims)

  await upsertUser(privyUserId, {
    email: email ?? undefined,
    x_username: xUsername ?? undefined,
  })

  const wallets = await getUserWallets(privyUserId)
  return c.json({ wallets })
})

walletLinkRoute.delete('/user/link-wallet/:address', requirePrivyAuth, async (c) => {
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  if (!claims) {
    throw new ApiError(401, 'auth_required', 'Privy authentication required')
  }

  const { privyUserId } = extractUserIdentityFromClaims(claims)

  const address = normalizeAddress(c.req.param('address'))
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
