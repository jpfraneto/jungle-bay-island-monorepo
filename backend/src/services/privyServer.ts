import { CONFIG } from '../config'
import { logWarn } from './logger'

type LinkedAccount = Record<string, unknown>

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

function parseLinkedAccounts(raw: unknown): LinkedAccount[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is LinkedAccount => !!item && typeof item === 'object')
  }

  if (typeof raw !== 'string') return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is LinkedAccount => !!item && typeof item === 'object')
  } catch {
    return []
  }
}

function extractLinkedAccounts(payload: unknown): LinkedAccount[] {
  const root = asRecord(payload)
  if (!root) return []

  const direct = parseLinkedAccounts(root.linked_accounts)
  if (direct.length > 0) return direct

  const nestedUser = asRecord(root.user)
  if (!nestedUser) return []
  return parseLinkedAccounts(nestedUser.linked_accounts)
}

function buildPrivyAuthHeader(): string {
  const credentials = `${CONFIG.PRIVY_APP_ID}:${CONFIG.PRIVY_APP_SECRET}`
  const encoded = Buffer.from(credentials).toString('base64')
  return `Basic ${encoded}`
}

async function fetchUserPayload(url: string): Promise<{ payload: unknown | null; status: number }> {
  const response = await fetch(url, {
    headers: {
      Authorization: buildPrivyAuthHeader(),
      'privy-app-id': CONFIG.PRIVY_APP_ID,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    return {
      payload: null,
      status: response.status,
    }
  }

  return {
    payload: await response.json().catch(() => null),
    status: response.status,
  }
}

export async function fetchPrivyUserLinkedAccounts(privyUserId: string): Promise<LinkedAccount[] | null> {
  const normalizedUserId = privyUserId.trim()
  if (!normalizedUserId) return null

  const path = encodeURIComponent(normalizedUserId)
  const urls = [
    `https://api.privy.io/v1/users/${path}`,
    `https://auth.privy.io/api/v1/users/${path}`,
  ]
  let lastStatus: number | null = null

  for (const url of urls) {
    try {
      const { payload, status } = await fetchUserPayload(url)
      if (!payload) {
        lastStatus = status
        continue
      }

      return extractLinkedAccounts(payload)
    } catch (error) {
      logWarn(
        'PRIVY API',
        `user lookup failed user=${normalizedUserId} url=${url} message=${error instanceof Error ? error.message : 'unknown error'}`,
      )
    }
  }

  if (lastStatus !== null) {
    logWarn(
      'PRIVY API',
      `user lookup unavailable user=${normalizedUserId} status=${lastStatus}; falling back to JWT linked_accounts`,
    )
  }

  return null
}
