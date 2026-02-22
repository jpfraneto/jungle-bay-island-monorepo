import { Hono } from 'hono'
import { verifyMessage } from 'viem'
import { createPublicKey, verify } from 'node:crypto'
import { CONFIG, db, normalizeAddress } from '../config'
import { getSessionFromRequest } from '../services/session'
import { logInfo } from '../services/logger'
import { ApiError } from '../services/errors'

const walletLinkRoute = new Hono()

// ── Base58 decoder for Solana addresses ──
const BASE58_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [0]
  for (const char of str) {
    const idx = BASE58_CHARS.indexOf(char)
    if (idx === -1) throw new Error('Invalid base58')
    let carry = idx
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58
      bytes[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  for (const char of str) {
    if (char !== '1') break
    bytes.push(0)
  }
  return new Uint8Array(bytes.reverse())
}

function verifySolanaSignature(message: string, signatureBytes: Uint8Array, publicKeyBytes: Uint8Array): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(publicKeyBytes),
      ]),
      format: 'der',
      type: 'spki',
    })
    return verify(null, Buffer.from(message), key, Buffer.from(signatureBytes))
  } catch {
    return false
  }
}

function buildLinkMessage(wallet: string, xUsername: string, nonce: string): string {
  return `Link wallet ${wallet} to @${xUsername} on Memetics.\nNonce: ${nonce}`
}

// ── DB migration ──
let migrationPromise: Promise<void> | null = null
async function ensureXIdColumn(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      await db`
        ALTER TABLE ${db(CONFIG.SCHEMA)}.user_wallet_links
        ADD COLUMN IF NOT EXISTS x_id TEXT
      `
      await db`
        CREATE INDEX IF NOT EXISTS idx_user_wallet_links_x_id
        ON ${db(CONFIG.SCHEMA)}.user_wallet_links (x_id)
      `
    })()
  }
  await migrationPromise
}

async function upsertWalletLink(
  wallet: string,
  walletKind: 'evm' | 'solana',
  xId: string,
  xUsername: string,
): Promise<void> {
  await ensureXIdColumn()
  await db`
    INSERT INTO ${db(CONFIG.SCHEMA)}.user_wallet_links
      (wallet, wallet_kind, x_id, x_username, seen_via_privy, seen_via_farcaster, farcaster_verified, last_seen_requester_wallet)
    VALUES
      (${wallet}, ${walletKind}, ${xId}, ${xUsername}, FALSE, FALSE, FALSE, FALSE)
    ON CONFLICT (wallet, wallet_kind) DO UPDATE SET
      x_id = EXCLUDED.x_id,
      x_username = EXCLUDED.x_username,
      last_seen_at = NOW()
  `
}

async function getWalletsByXId(xId: string): Promise<Array<{ wallet: string; wallet_kind: string; linked_at: string }>> {
  await ensureXIdColumn()
  return db<Array<{ wallet: string; wallet_kind: string; linked_at: string }>>`
    SELECT wallet, wallet_kind, first_seen_at::text AS linked_at
    FROM ${db(CONFIG.SCHEMA)}.user_wallet_links
    WHERE x_id = ${xId}
    ORDER BY first_seen_at ASC
  `
}

async function removeWalletLink(wallet: string, xId: string): Promise<void> {
  await ensureXIdColumn()
  await db`
    DELETE FROM ${db(CONFIG.SCHEMA)}.user_wallet_links
    WHERE wallet = ${wallet} AND x_id = ${xId}
  `
}

// ── Routes ──

// GET /api/wallets/nonce — get a fresh nonce for signing
walletLinkRoute.get('/wallets/nonce', async (c) => {
  const session = await getSessionFromRequest(c.req.header('cookie'))
  if (!session) {
    throw new ApiError(401, 'not_authenticated', 'Login with X first')
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return c.json({ nonce, message_template: buildLinkMessage('{wallet}', session.x_username, nonce) })
})

// POST /api/wallets/link — link a wallet to X identity
walletLinkRoute.post('/wallets/link', async (c) => {
  const session = await getSessionFromRequest(c.req.header('cookie'))
  if (!session) {
    throw new ApiError(401, 'not_authenticated', 'Login with X first')
  }

  const body = await c.req.json<{
    wallet: string
    wallet_kind: 'evm' | 'solana'
    signature: string
    nonce: string
  }>()

  if (!body.wallet || !body.wallet_kind || !body.signature || !body.nonce) {
    throw new ApiError(400, 'missing_fields', 'wallet, wallet_kind, signature, nonce required')
  }

  if (body.wallet_kind !== 'evm' && body.wallet_kind !== 'solana') {
    throw new ApiError(400, 'invalid_wallet_kind', 'wallet_kind must be evm or solana')
  }

  const message = buildLinkMessage(body.wallet, session.x_username, body.nonce)

  if (body.wallet_kind === 'evm') {
    const normalized = normalizeAddress(body.wallet)
    if (!normalized) throw new ApiError(400, 'invalid_address', 'Invalid EVM address')

    const valid = await verifyMessage({
      address: normalized as `0x${string}`,
      message,
      signature: body.signature as `0x${string}`,
    })
    if (!valid) throw new ApiError(403, 'invalid_signature', 'EVM signature verification failed')

    await upsertWalletLink(normalized, 'evm', session.x_id, session.x_username)
    logInfo('WALLET LINK', `evm wallet=${normalized} x=@${session.x_username}`)
    return c.json({ ok: true, wallet: normalized, wallet_kind: 'evm' })
  }

  // Solana
  const solAddr = normalizeAddress(body.wallet, 'solana')
  if (!solAddr) throw new ApiError(400, 'invalid_address', 'Invalid Solana address')

  try {
    const publicKeyBytes = base58Decode(solAddr)
    const signatureBytes = Uint8Array.from(atob(body.signature), (ch) => ch.charCodeAt(0))
    const valid = verifySolanaSignature(message, signatureBytes, publicKeyBytes)
    if (!valid) throw new ApiError(403, 'invalid_signature', 'Solana signature verification failed')
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(403, 'invalid_signature', 'Signature verification failed')
  }

  await upsertWalletLink(solAddr, 'solana', session.x_id, session.x_username)
  logInfo('WALLET LINK', `solana wallet=${solAddr} x=@${session.x_username}`)
  return c.json({ ok: true, wallet: solAddr, wallet_kind: 'solana' })
})

// GET /api/wallets — list linked wallets for current user
walletLinkRoute.get('/wallets', async (c) => {
  const session = await getSessionFromRequest(c.req.header('cookie'))
  if (!session) {
    throw new ApiError(401, 'not_authenticated', 'Login with X first')
  }

  const wallets = await getWalletsByXId(session.x_id)
  return c.json({ wallets })
})

// DELETE /api/wallets/:wallet — unlink a wallet
walletLinkRoute.delete('/wallets/:wallet', async (c) => {
  const session = await getSessionFromRequest(c.req.header('cookie'))
  if (!session) {
    throw new ApiError(401, 'not_authenticated', 'Login with X first')
  }

  const wallet = c.req.param('wallet')
  await removeWalletLink(wallet, session.x_id)
  logInfo('WALLET UNLINK', `wallet=${wallet} x=@${session.x_username}`)
  return c.json({ ok: true })
})

export default walletLinkRoute
