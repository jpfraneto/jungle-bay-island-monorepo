import type { JWK, JWTPayload, KeyLike } from 'jose'
import { createRemoteJWKSet, decodeProtectedHeader, importJWK, importSPKI, jwtVerify } from 'jose'
import type { MiddlewareHandler } from 'hono'
import { CONFIG, normalizeAddress } from '../config'
import { getAgentByKeyHash } from '../db/queries'
import type { AppEnv } from '../types'
import { ApiError } from '../services/errors'
import { logInfo, logWarn } from '../services/logger'
import { getPrivyLinkedAccounts } from '../services/privyClaims'

type VerificationKey = KeyLike | Uint8Array

const DEFAULT_PRIVY_ALGORITHMS = ['ES256', 'RS256', 'EdDSA'] as const
const verificationKeyPromises = new Map<string, Promise<VerificationKey>>()
let remotePrivyJwks: ReturnType<typeof createRemoteJWKSet> | null = null

function parseVerificationKey(rawKey: string, algorithm: string): Promise<VerificationKey> {
  const normalized = rawKey.trim().replace(/\\n/g, '\n')

  if (normalized.startsWith('-----BEGIN PUBLIC KEY-----')) {
    return importSPKI(normalized, algorithm)
  }

  if (normalized.startsWith('{')) {
    const jwk = JSON.parse(normalized) as JWK
    const alg = typeof jwk.alg === 'string' ? jwk.alg : algorithm
    return importJWK(jwk, alg)
  }

  throw new Error('Unsupported PRIVY_VERIFICATION_KEY format')
}

async function getVerificationKey(algorithm: string): Promise<VerificationKey> {
  let promise = verificationKeyPromises.get(algorithm)
  if (!promise) {
    promise = parseVerificationKey(CONFIG.PRIVY_VERIFICATION_KEY, algorithm)
    verificationKeyPromises.set(algorithm, promise)
  }

  try {
    return await promise
  } catch (error) {
    verificationKeyPromises.delete(algorithm)
    throw error
  }
}

function getPrivyJwks() {
  if (!remotePrivyJwks) {
    remotePrivyJwks = createRemoteJWKSet(
      new URL(`https://auth.privy.io/api/v1/apps/${CONFIG.PRIVY_APP_ID}/jwks.json`),
    )
  }

  return remotePrivyJwks
}

function getPrivyAlgorithmCandidates(token: string): string[] {
  const headerAlg = (() => {
    try {
      const header = decodeProtectedHeader(token)
      return typeof header.alg === 'string' ? header.alg : null
    } catch {
      return null
    }
  })()

  const combined = [
    headerAlg,
    ...DEFAULT_PRIVY_ALGORITHMS,
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)

  return Array.from(new Set(combined))
}

function payloadTargetsPrivyApp(payload: JWTPayload): boolean {
  if (typeof payload.aud === 'string') {
    return payload.aud === CONFIG.PRIVY_APP_ID
  }

  if (Array.isArray(payload.aud)) {
    return payload.aud.some((audience) => audience === CONFIG.PRIVY_APP_ID)
  }

  const appId = (payload as Record<string, unknown>).app_id
  if (typeof appId === 'string') {
    return appId === CONFIG.PRIVY_APP_ID
  }

  return false
}

function extractBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader) return null
  const [scheme, token] = authorizationHeader.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null
  return token
}

function summarizeTokenHeader(token: string): string {
  try {
    const header = decodeProtectedHeader(token)
    const alg = typeof header.alg === 'string' ? header.alg : 'unknown'
    const kid = typeof header.kid === 'string' ? header.kid : 'unknown'
    const typ = typeof header.typ === 'string' ? header.typ : 'unknown'
    return `alg=${alg},kid=${kid},typ=${typ},len=${token.length}`
  } catch {
    return `header=unparseable,len=${token.length}`
  }
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
  const algorithmCandidates = getPrivyAlgorithmCandidates(token)
  const issuerCandidates = [
    'privy.io',
    `privy.io/${CONFIG.PRIVY_APP_ID}`,
    'https://auth.privy.io',
    `https://auth.privy.io/${CONFIG.PRIVY_APP_ID}`,
    `https://auth.privy.io/api/v1/apps/${CONFIG.PRIVY_APP_ID}`,
  ]

  let payload: JWTPayload | null = null
  let lastError: unknown = null

  const attemptWithVerifier = async (
    runVerify: (options: { issuer?: string; audience?: string }) => Promise<JWTPayload>,
  ): Promise<JWTPayload | null> => {
    for (const issuer of issuerCandidates) {
      try {
        return await runVerify({
          audience: CONFIG.PRIVY_APP_ID,
          issuer,
        })
      } catch (error) {
        lastError = error
      }
    }

    try {
      return await runVerify({
        audience: CONFIG.PRIVY_APP_ID,
      })
    } catch (error) {
      lastError = error
    }

    // Compatibility fallback for token variants where app scoping is not in aud.
    for (const issuer of issuerCandidates) {
      try {
        const verifiedPayload = await runVerify({ issuer })
        if (!payloadTargetsPrivyApp(verifiedPayload)) {
          throw new Error('Privy token audience mismatch')
        }
        return verifiedPayload
      } catch (error) {
        lastError = error
      }
    }

    try {
      const verifiedPayload = await runVerify({})
      if (!payloadTargetsPrivyApp(verifiedPayload)) {
        throw new Error('Privy token audience mismatch')
      }
      return verifiedPayload
    } catch (error) {
      lastError = error
    }

    return null
  }

  for (const algorithm of algorithmCandidates) {
    try {
      const localKey = await getVerificationKey(algorithm)
      payload = await attemptWithVerifier(async (options) => {
        const verified = await jwtVerify(token, localKey, {
          algorithms: [algorithm],
          ...options,
        })
        return verified.payload
      })
    } catch (error) {
      lastError = error
    }

    if (payload) {
      break
    }

    const remoteJwks = getPrivyJwks()
    payload = await attemptWithVerifier(async (options) => {
      const verified = await jwtVerify(token, remoteJwks, {
        algorithms: [algorithm],
        ...options,
      })
      return verified.payload
    })

    if (payload) {
      break
    }
  }

  if (!payload) {
    if (lastError instanceof Error) {
      throw lastError
    }
    throw new Error('Unable to verify Privy token')
  }

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
    if (c.req.path.startsWith('/api/wallet/')) {
      const message = error instanceof Error ? error.message : 'unknown_error'
      logWarn(
        'AUTH',
        `Privy verify failed for wallet route ${c.req.method} ${c.req.path} (${summarizeTokenHeader(token)}): ${message}`,
      )
    }

    if (error instanceof ApiError) {
      throw error
    }
    throw new ApiError(401, 'invalid_token', 'Privy token verification failed')
  }

  if (c.req.path.startsWith('/api/wallet/')) {
    logInfo(
      'AUTH',
      `Privy verify ok for wallet route ${c.req.method} ${c.req.path} wallet=${verified.walletAddress}`,
    )
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
