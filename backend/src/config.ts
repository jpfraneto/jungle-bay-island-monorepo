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
  PORT: optionalInt('PORT', 3001),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? '*',
  SCHEMA: 'prod-v11',
  GENERAL_RATE_LIMIT_PER_MIN: 100,
  RESIDENT_DAILY_SCANS: 3,
  BUNGALOW_CACHE_MS: 5 * 60 * 1000,
  LEADERBOARD_CACHE_MS: 10 * 60 * 1000,
  PERSONA_CACHE_MS: 5 * 60 * 1000,
} as const

export const db = postgres(CONFIG.DATABASE_URL, {
  max: 12,
  idle_timeout: 20,
  connect_timeout: 15,
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
