import { SignJWT, jwtVerify } from 'jose'
import { CONFIG } from '../config'

export interface SessionUser {
  x_id: string
  x_username: string
  x_name: string
  x_pfp: string
}

const secret = new TextEncoder().encode(CONFIG.SESSION_SECRET)
const COOKIE_NAME = 'meme_session'
const SESSION_TTL = 30 * 24 * 60 * 60 // 30 days in seconds

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    x_id: user.x_id,
    x_username: user.x_username,
    x_name: user.x_name,
    x_pfp: user.x_pfp,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL}s`)
    .sign(secret)
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret)
    if (!payload.x_id || !payload.x_username) return null
    return {
      x_id: payload.x_id as string,
      x_username: payload.x_username as string,
      x_name: (payload.x_name as string) ?? '',
      x_pfp: (payload.x_pfp as string) ?? '',
    }
  } catch {
    return null
  }
}

export function sessionCookieHeader(token: string): string {
  const maxAge = SESSION_TTL
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`
}

export function clearSessionCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
}

export function parseCookieSession(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]+)`))
  return match ? match[1] : null
}

export async function getSessionFromRequest(cookieHeader: string | undefined): Promise<SessionUser | null> {
  const token = parseCookieSession(cookieHeader)
  if (!token) return null
  return verifySessionToken(token)
}
