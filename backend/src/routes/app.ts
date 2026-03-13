import { Hono } from 'hono'
import { requirePrivyAuth } from '../middleware/auth'
import { extractPrivyXUsername, getPrivyLinkedAccounts } from '../services/privyClaims'
import {
  clearSessionCookieHeader,
  createSessionToken,
  getSessionFromRequest,
  sessionCookieHeader,
} from '../services/session'
import type { AppEnv } from '../types'

const appRoute = new Hono<AppEnv>()

function detectClientVariant(userAgent: string | null | undefined): 'mobile' | 'desktop' {
  const ua = (userAgent ?? '').toLowerCase()
  return /android|iphone|ipad|ipod|mobile|opera mini|iemobile/.test(ua)
    ? 'mobile'
    : 'desktop'
}

function buildDisplayName(claims: Record<string, unknown> | undefined): string {
  const linkedAccounts = claims ? getPrivyLinkedAccounts(claims) : []
  for (const account of linkedAccounts) {
    const candidate = account as Record<string, unknown>
    const type = typeof candidate.type === 'string' ? candidate.type : ''
    if (type !== 'twitter' && type !== 'twitter_oauth') continue

    if (typeof candidate.name === 'string' && candidate.name.trim()) {
      return candidate.name.trim()
    }
    if (typeof candidate.display_name === 'string' && candidate.display_name.trim()) {
      return candidate.display_name.trim()
    }
  }

  return ''
}

function buildAvatarUrl(claims: Record<string, unknown> | undefined): string {
  const linkedAccounts = claims ? getPrivyLinkedAccounts(claims) : []
  for (const account of linkedAccounts) {
    const candidate = account as Record<string, unknown>
    const type = typeof candidate.type === 'string' ? candidate.type : ''
    if (type !== 'twitter' && type !== 'twitter_oauth') continue

    const avatar =
      typeof candidate.profile_picture_url === 'string'
        ? candidate.profile_picture_url
        : typeof candidate.picture === 'string'
          ? candidate.picture
          : typeof candidate.avatar_url === 'string'
            ? candidate.avatar_url
            : ''
    if (avatar.trim()) return avatar.trim()
  }

  return ''
}

appRoute.get('/app/bootstrap', async (c) => {
  const session = await getSessionFromRequest(c.req.header('cookie'))

  return c.json({
    client_variant: detectClientVariant(c.req.header('user-agent')),
    authenticated: Boolean(session),
    session: session
      ? {
          x_username: session.x_username,
          x_name: session.x_name,
          x_pfp: session.x_pfp,
        }
      : null,
  })
})

appRoute.post('/app/session/sync', requirePrivyAuth, async (c) => {
  const claims = c.get('privyClaims') as Record<string, unknown> | undefined
  if (!claims) {
    c.header('Set-Cookie', clearSessionCookieHeader())
    return c.json({ ok: false, authenticated: false, session: null })
  }
  const xUsername = extractPrivyXUsername(claims)
  if (!xUsername) {
    c.header('Set-Cookie', clearSessionCookieHeader())
    return c.json({
      ok: false,
      authenticated: false,
      session: null,
    })
  }

  const sessionToken = await createSessionToken({
    x_id: xUsername,
    x_username: xUsername,
    x_name: buildDisplayName(claims) || xUsername,
    x_pfp: buildAvatarUrl(claims),
  })
  c.header('Set-Cookie', sessionCookieHeader(sessionToken))

  return c.json({
    ok: true,
    authenticated: true,
    session: {
      x_username: xUsername,
      x_name: buildDisplayName(claims) || xUsername,
      x_pfp: buildAvatarUrl(claims),
    },
  })
})

appRoute.delete('/app/session', async (c) => {
  c.header('Set-Cookie', clearSessionCookieHeader())
  return c.json({ ok: true })
})

export { detectClientVariant }
export default appRoute
