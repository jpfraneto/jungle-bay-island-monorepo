import { createPublicKey, verify } from 'node:crypto'
import { Hono } from 'hono'
import { verifyMessage } from 'viem'
import { CONFIG, db, normalizeAddress } from '../config'
import {
  getIdentityClusterByWallet,
  getLinkedWallets,
  linkWallet,
  unlinkWallet,
} from '../db/queries'
import { requireWalletAuth } from '../middleware/auth'
import { ApiError } from '../services/errors'
import type { AppEnv } from '../types'

const walletLinkRoute = new Hono<AppEnv>()

interface LinkedWalletCandidate {
  address: string
  kind: 'evm' | 'solana'
}

/**
 * Decodes base58 strings so Solana public keys can be verified without extra dependencies.
 */
function base58Decode(value: string): Uint8Array {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const bytes: number[] = [0]

  for (const character of value) {
    const index = alphabet.indexOf(character)
    if (index < 0) {
      throw new ApiError(400, 'invalid_signature', 'Solana signatures require a valid base58 wallet address')
    }

    let carry = index
    for (let pointer = 0; pointer < bytes.length; pointer += 1) {
      carry += bytes[pointer] * 58
      bytes[pointer] = carry & 0xff
      carry >>= 8
    }

    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  for (const character of value) {
    if (character !== '1') break
    bytes.push(0)
  }

  return new Uint8Array(bytes.reverse())
}

/**
 * Verifies Solana detached signatures so linked wallets can be proven without transactions.
 */
function verifySolanaSignature(
  message: string,
  signature: string,
  publicKey: string,
): boolean {
  try {
    const publicKeyBytes = base58Decode(publicKey)
    const signatureBytes = Buffer.from(signature, 'base64')
    if (signatureBytes.length === 0) return false

    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(publicKeyBytes),
      ]),
      format: 'der',
      type: 'spki',
    })

    return verify(null, Buffer.from(message), key, signatureBytes)
  } catch {
    return false
  }
}

/**
 * Normalizes linked wallet input across EVM and Solana so the route can support both address families.
 */
function normalizeLinkedWallet(input: unknown): LinkedWalletCandidate | null {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return null

  const evm = normalizeAddress(raw)
  if (evm) {
    return { address: evm, kind: 'evm' }
  }

  const solana = normalizeAddress(raw, 'solana')
  if (solana) {
    return { address: solana, kind: 'solana' }
  }

  return null
}

/**
 * Checks that the signed message includes a concrete timestamp so link proofs are replay-resistant.
 */
function messageHasTimestamp(message: string): boolean {
  return (
    /\b\d{10,13}\b/.test(message) ||
    /\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i.test(message)
  )
}

/**
 * Validates that the proof message binds the link to the authenticated primary wallet.
 */
function assertValidLinkMessage(message: string, primaryWallet: string): void {
  if (!message.toLowerCase().includes(primaryWallet.toLowerCase())) {
    throw new ApiError(400, 'invalid_message', 'verification message must contain the primary_wallet address')
  }

  if (!messageHasTimestamp(message)) {
    throw new ApiError(400, 'invalid_message', 'verification message must contain a timestamp')
  }
}

/**
 * Verifies ownership of the linked wallet from an off-chain signature so hardware wallets stay read-only.
 */
async function verifyLinkedWalletOwnership(
  linkedWallet: LinkedWalletCandidate,
  signature: string,
  message: string,
): Promise<void> {
  if (linkedWallet.kind === 'evm') {
    const valid = await verifyMessage({
      address: linkedWallet.address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    })

    if (!valid) {
      throw new ApiError(403, 'invalid_signature', 'Signature does not recover to linked_wallet')
    }
    return
  }

  const valid = verifySolanaSignature(message, signature, linkedWallet.address)
  if (!valid) {
    throw new ApiError(403, 'invalid_signature', 'Signature does not verify for linked_wallet')
  }
}

// ── Link ────────────────────────────────────────────────────

walletLinkRoute.post('/link', requireWalletAuth, async (c) => {
  const primaryWallet = c.get('walletAddress')
  if (!primaryWallet) {
    throw new ApiError(401, 'auth_required', 'Wallet authentication required')
  }

  const body = await c.req.json<{
    linked_wallet?: unknown
    signature?: unknown
    message?: unknown
  }>()

  const linkedWallet = normalizeLinkedWallet(body.linked_wallet)
  if (!linkedWallet) {
    throw new ApiError(400, 'invalid_linked_wallet', 'linked_wallet must be a valid EVM or Solana address')
  }

  if (linkedWallet.address.toLowerCase() === primaryWallet.toLowerCase()) {
    throw new ApiError(400, 'invalid_linked_wallet', 'linked_wallet must differ from primary_wallet')
  }

  const signature = typeof body.signature === 'string' ? body.signature.trim() : ''
  if (!signature) {
    throw new ApiError(400, 'invalid_signature', 'signature is required')
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) {
    throw new ApiError(400, 'invalid_message', 'message is required')
  }

  assertValidLinkMessage(message, primaryWallet)
  await verifyLinkedWalletOwnership(linkedWallet, signature, message)

  const link = await linkWallet(
    primaryWallet,
    linkedWallet.address,
    signature,
    message,
  )

  return c.json({ link }, 201)
})

// ── Read ────────────────────────────────────────────────────

walletLinkRoute.get('/links/:wallet', async (c) => {
  const wallet = normalizeLinkedWallet(c.req.param('wallet'))
  if (!wallet) {
    throw new ApiError(400, 'invalid_wallet', 'Invalid wallet address')
  }

  const [linkedWallets, linkedUnder, cluster] = await Promise.all([
    getLinkedWallets(wallet.address),
    db<Array<{
      id: number
      primary_wallet: string
      linked_wallet: string
      verification_signature: string
      verification_message: string
      created_at: string
    }>>`
      SELECT
        id,
        primary_wallet,
        linked_wallet,
        verification_signature,
        verification_message,
        created_at::text AS created_at
      FROM ${db(CONFIG.SCHEMA)}.user_wallet_links
      WHERE linked_wallet = ${wallet.address}
      ORDER BY created_at ASC, id ASC
    `,
    getIdentityClusterByWallet(wallet.address),
  ])

  return c.json({
    wallet: wallet.address,
    linked_wallets: linkedWallets,
    linked_under: linkedUnder,
    cluster,
  })
})

// ── Unlink ──────────────────────────────────────────────────

walletLinkRoute.delete('/link', requireWalletAuth, async (c) => {
  const primaryWallet = c.get('walletAddress')
  if (!primaryWallet) {
    throw new ApiError(401, 'auth_required', 'Wallet authentication required')
  }

  const body = await c.req.json<{ linked_wallet?: unknown }>()
  const linkedWallet = normalizeLinkedWallet(body.linked_wallet)
  if (!linkedWallet) {
    throw new ApiError(400, 'invalid_linked_wallet', 'linked_wallet must be a valid EVM or Solana address')
  }

  await unlinkWallet(primaryWallet, linkedWallet.address)
  return c.json({ ok: true })
})

export default walletLinkRoute
