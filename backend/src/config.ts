import postgres from 'postgres'
import { createPublicClient, http, isAddress } from 'viem'
import { base, mainnet } from 'viem/chains'

export type SupportedChain = 'base' | 'ethereum' | 'solana'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

function optionalInt(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function optionalBool(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false
  return fallback
}

export const CONFIG = {
  DATABASE_URL: required('DATABASE_URL'),
  PONDER_RPC_URL_8453: required('PONDER_RPC_URL_8453'),
  PONDER_RPC_URL_1: required('PONDER_RPC_URL_1'),
  PRIVY_APP_ID: required('PRIVY_APP_ID'),
  PRIVY_APP_SECRET: required('PRIVY_APP_SECRET'),
  PRIVY_VERIFICATION_KEY: required('PRIVY_VERIFICATION_KEY'),
  TWITTER_CLIENT_ID: process.env.X_CLIENT_SECRET_ID ?? '',
  TWITTER_CLIENT_SECRET: process.env.X_CLIENT_SECRET ?? '',
  SESSION_SECRET: process.env.SESSION_SECRET ?? 'IJbbpqd9f0UyjpzAwQysMBbzBbCH4HDo44eihpiqY/U=',
  NEYNAR_API_KEY: process.env.NEYNAR_API_KEY ?? '',
  HELIUS_API_KEY: process.env.HELIUS_API_KEY ?? '',
  TREASURY_ADDRESS: process.env.TREASURY_ADDRESS ?? '',
  CLAIM_SIGNER_PRIVATE_KEY: process.env.CLAIM_SIGNER_PRIVATE_KEY ?? '',
  CLAIM_CONTRACT_ADDRESS:
    process.env.CLAIM_CONTRACT_ADDRESS ?? '0x784c6438e72b2a2f3977af8d0ba30b30f78f7a10',
  JBM_TOKEN_ADDRESS: process.env.JBM_TOKEN_ADDRESS ?? '0x3313338fe4bb2a166b81483bfcb2d4a6a1ebba8d',
  PORT: optionalInt('PORT', 3001),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? '*',
  SCHEMA: 'prod-v11',
  GENERAL_RATE_LIMIT_PER_MIN: 100,
  RESIDENT_DAILY_SCANS: 3,
  BUNGALOW_CACHE_MS: 5 * 60 * 1000,
  LEADERBOARD_CACHE_MS: 10 * 60 * 1000,
  PERSONA_CACHE_MS: 5 * 60 * 1000,
  DAILY_HEAT_REFRESH_ENABLED: optionalBool('DAILY_HEAT_REFRESH_ENABLED', true),
  DAILY_HEAT_REFRESH_CONCURRENCY: optionalInt('DAILY_HEAT_REFRESH_CONCURRENCY', 2),
  DAILY_CLAIM_CAP_JBM: optionalInt('DAILY_CLAIM_CAP_JBM', 10_000_000),
} as const

export const db = postgres(CONFIG.DATABASE_URL, {
  max: 12,
  idle_timeout: 20,
  connect_timeout: 15,
  // Suppress noisy idempotent DDL notices from ensure-table guards.
  onnotice: (notice) => {
    if (notice.code === '42P07' || notice.code === '42701') return
    console.warn(
      `[PG NOTICE] code=${notice.code ?? 'unknown'} message=${notice.message ?? 'unknown notice'}`,
    )
  },
})

export const publicClients = {
  base: createPublicClient({ chain: base, transport: http(CONFIG.PONDER_RPC_URL_8453) }),
  ethereum: createPublicClient({ chain: mainnet, transport: http(CONFIG.PONDER_RPC_URL_1) }),
}

export function normalizeAddress(input: string, chain?: SupportedChain): string | null {
  const trimmed = input.trim()
  if (chain === 'solana') {
    // Solana addresses are base58, 32-44 chars
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) return trimmed
    return null
  }
  const candidate = trimmed.toLowerCase()
  if (!isAddress(candidate)) return null
  return candidate
}

export function toSupportedChain(input: string): SupportedChain | null {
  if (input === 'base' || input === 'ethereum' || input === 'solana') return input
  return null
}
