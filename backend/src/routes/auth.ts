import { Hono } from 'hono'
import { CONFIG } from '../config'
import {
  createSessionToken,
  sessionCookieHeader,
  clearSessionCookieHeader,
  getSessionFromRequest,
} from '../services/session'
import { logInfo, logError } from '../services/logger'

const authRoute = new Hono()

// In-memory PKCE state store (short-lived, < 5 min)
const pkceStore = new Map<string, { codeVerifier: string; returnUrl: string; expiresAt: number }>()

// Clean up expired PKCE entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of pkceStore) {
    if (val.expiresAt < now) pkceStore.delete(key)
  }
}, 60_000)

function generateRandom(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function getBaseUrl(c: any): string {
  const proto = c.req.header('x-forwarded-proto') ?? 'http'
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? 'localhost:3001'
  return `${proto}://${host}`
}

// GET /auth/twitter — redirect to Twitter OAuth
authRoute.get('/auth/twitter', async (c) => {
  if (!CONFIG.TWITTER_CLIENT_ID) {
    return c.text('X OAuth not configured (missing X_CLIENT_SECRET_ID env var)', 500)
  }

  const returnUrl = c.req.query('return') ?? '/'
  const state = generateRandom(16)
  const codeVerifier = generateRandom(32)
  const codeChallenge = await generateCodeChallenge(codeVerifier)

  pkceStore.set(state, {
    codeVerifier,
    returnUrl,
    expiresAt: Date.now() + 5 * 60 * 1000,
  })

  const callbackUrl = `${getBaseUrl(c)}/auth/callback`
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CONFIG.TWITTER_CLIENT_ID,
    redirect_uri: callbackUrl,
    scope: 'tweet.read users.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  const redirectUrl = `https://twitter.com/i/oauth2/authorize?${params}`
  logInfo('AUTH', `twitter oauth redirect state=${state} return=${returnUrl} callback=${callbackUrl} client_id=${CONFIG.TWITTER_CLIENT_ID}`)
  logInfo('AUTH', `redirect url: ${redirectUrl}`)
  return c.redirect(redirectUrl)
})

// GET /auth/callback — Twitter OAuth callback
authRoute.get('/auth/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  if (error) {
    logError('AUTH', `twitter oauth error: ${error}`)
    return c.redirect('/?auth_error=denied')
  }

  if (!code || !state) {
    return c.redirect('/?auth_error=missing_params')
  }

  const pkce = pkceStore.get(state)
  if (!pkce || pkce.expiresAt < Date.now()) {
    pkceStore.delete(state)
    return c.redirect('/?auth_error=expired')
  }
  pkceStore.delete(state)

  const callbackUrl = `${getBaseUrl(c)}/auth/callback`

  try {
    // Exchange code for access token
    const basicAuth = btoa(`${CONFIG.TWITTER_CLIENT_ID}:${CONFIG.TWITTER_CLIENT_SECRET}`)
    const tokenResp = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl,
        code_verifier: pkce.codeVerifier,
      }),
    })

    if (!tokenResp.ok) {
      const errText = await tokenResp.text()
      logError('AUTH', `token exchange failed: ${tokenResp.status} ${errText}`)
      return c.redirect('/?auth_error=token_failed')
    }

    const tokenData = (await tokenResp.json()) as { access_token: string }
    const accessToken = tokenData.access_token

    // Fetch user info
    const userResp = await fetch(
      'https://api.twitter.com/2/users/me?user.fields=profile_image_url,username,name,id',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )

    if (!userResp.ok) {
      logError('AUTH', `user fetch failed: ${userResp.status}`)
      return c.redirect('/?auth_error=user_failed')
    }

    const userData = (await userResp.json()) as {
      data: { id: string; username: string; name: string; profile_image_url?: string }
    }
    const user = userData.data

    logInfo('AUTH', `twitter login: @${user.username} (${user.id})`)

    // Create session JWT
    const sessionToken = await createSessionToken({
      x_id: user.id,
      x_username: user.username,
      x_name: user.name ?? user.username,
      x_pfp: user.profile_image_url ?? '',
    })

    // Set cookie and redirect
    c.header('Set-Cookie', sessionCookieHeader(sessionToken))
    return c.redirect(pkce.returnUrl)
  } catch (err) {
    logError('AUTH', `callback error: ${err instanceof Error ? err.message : 'unknown'}`)
    return c.redirect('/?auth_error=internal')
  }
})

// GET /auth/logout
authRoute.get('/auth/logout', (c) => {
  const returnUrl = c.req.query('return') ?? '/'
  c.header('Set-Cookie', clearSessionCookieHeader())
  return c.redirect(returnUrl)
})

// GET /auth/me — return current session as JSON (for client-side checks)
authRoute.get('/auth/me', async (c) => {
  const session = await getSessionFromRequest(c.req.header('cookie'))
  if (!session) {
    return c.json({ authenticated: false })
  }
  return c.json({
    authenticated: true,
    user: {
      x_id: session.x_id,
      x_username: session.x_username,
      x_name: session.x_name,
      x_pfp: session.x_pfp,
    },
  })
})

export default authRoute
