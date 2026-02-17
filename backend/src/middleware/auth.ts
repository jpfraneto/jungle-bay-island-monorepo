import type { JWK, JWTPayload, KeyLike } from 'jose'
import { importJWK, importSPKI, jwtVerify } from 'jose'
import type { MiddlewareHandler } from 'hono'
import { CONFIG, normalizeAddress } from '../config'
import { getAgentByKeyHash } from '../db/queries'
import type { AppEnv } from '../types'
import { ApiError } from '../services/errors'
import { getPrivyLinkedAccounts } from '../services/privyClaims'

type VerificationKey = KeyLike | Uint8Array

let verificationKeyPromise: Promise<VerificationKey> | null = null

function parseVerificationKey(rawKey: string): Promise<VerificationKey> {
  const normalized = rawKey.trim().replace(/\\n/g, '\n')

  if (normalized.startsWith('-----BEGIN PUBLIC KEY-----')) {
    return importSPKI(normalized, 'ES256')
  }

  if (normalized.startsWith('{')) {
    const jwk = JSON.parse(normalized) as JWK
    const alg = typeof jwk.alg === 'string' ? jwk.alg : 'ES256'
    return importJWK(jwk, alg)
  }

  throw new Error('Unsupported PRIVY_VERIFICATION_KEY format')
}

async function getVerificationKey(): Promise<VerificationKey> {
  if (!verificationKeyPromise) {
    verificationKeyPromise = parseVerificationKey(CONFIG.PRIVY_VERIFICATION_KEY)
  }
  return verificationKeyPromise
}

function extractBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader) return null
  const [scheme, token] = authorizationHeader.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null
  return token
}

export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function tryAgentAuth(c: any): Promise<boolean> {
  const apiKey = c.req.header('X-API-Key')
  if (!apiKey) return false

  const keyHash = await hashApiKey(apiKey)
  const agent = await getAgentByKeyHash(keyHash)
  if (!agent) return false

  c.set('agentName', agent.agent_name)
  c.set('agentId', agent.id)
  if (agent.wallet) {
    c.set('walletAddress', agent.wallet)
  }
  return true
}

function walletFromClaims(payload: JWTPayload): string | null {
  const directAddress = typeof payload.wallet_address === 'string'
    ? payload.wallet_address
    : typeof payload.address === 'string'
      ? payload.address
      : null

  if (directAddress) {
    return normalizeAddress(directAddress)
  }

  const linkedAccounts = getPrivyLinkedAccounts(payload)
  for (const account of linkedAccounts) {
    const candidate = account as Record<string, unknown>
    if (
      typeof candidate.type === 'string' &&
      candidate.type !== 'wallet' &&
      candidate.type !== 'smart_wallet'
    ) {
      continue
    }
    if (typeof candidate.address !== 'string') continue
    const wallet = normalizeAddress(candidate.address)
    if (wallet) return wallet
  }

  return null
}

async function verifyPrivyToken(token: string): Promise<{ walletAddress: string; payload: JWTPayload }> {
  const verificationKey = await getVerificationKey()
  const { payload } = await jwtVerify(token, verificationKey, {
    algorithms: ['ES256'],
    audience: CONFIG.PRIVY_APP_ID,
    issuer: 'privy.io',
  })

  const walletAddress = walletFromClaims(payload)
  if (!walletAddress) {
    throw new ApiError(401, 'invalid_privy_claims', 'Privy token is missing a wallet account')
  }

  return { walletAddress, payload }
}

export const optionalWalletContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Try API key auth first (for agents)
  const agentOk = await tryAgentAuth(c)
  if (agentOk) return next()

  // Fall back to Privy JWT
  const token = extractBearerToken(c.req.header('Authorization'))

  if (token) {
    try {
      const { walletAddress, payload } = await verifyPrivyToken(token)
      c.set('walletAddress', walletAddress)
      c.set('privyClaims', payload)
    } catch {
      // Optional context should not fail public endpoints.
    }
  }

  await next()
}

export const requireWalletAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Try API key auth first (for agents)
  const agentOk = await tryAgentAuth(c)
  if (agentOk) return next()

  // Fall back to Privy JWT
  const token = extractBearerToken(c.req.header('Authorization'))

  if (!token) {
    throw new ApiError(401, 'auth_required', 'Missing Authorization bearer token or X-API-Key header')
  }

  let verified
  try {
    verified = await verifyPrivyToken(token)
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    throw new ApiError(401, 'invalid_token', 'Privy token verification failed')
  }

  c.set('walletAddress', verified.walletAddress)
  c.set('privyClaims', verified.payload)
  await next()
}

export const requireAgentAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const agentOk = await tryAgentAuth(c)
  if (!agentOk) {
    throw new ApiError(401, 'agent_auth_required', 'Valid X-API-Key header is required')
  }
  await next()
}
