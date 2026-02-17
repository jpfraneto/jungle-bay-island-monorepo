import type { Context, MiddlewareHandler } from 'hono'
import { ApiError } from '../services/errors'

interface RateLimitOptions {
  limit: number
  windowMs: number
  keyGenerator?: (c: Context) => string
}

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

function getIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return c.req.header('cf-connecting-ip') ?? 'unknown'
}

export function createRateLimit(options: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const key = options.keyGenerator ? options.keyGenerator(c) : getIp(c)
    const now = Date.now()
    const existing = buckets.get(key)

    if (!existing || now >= existing.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs })
      await next()
      return
    }

    if (existing.count >= options.limit) {
      const retryAfter = Math.ceil((existing.resetAt - now) / 1000)
      c.header('Retry-After', String(Math.max(1, retryAfter)))
      throw new ApiError(429, 'rate_limited', 'Rate limit exceeded', {
        retry_after_seconds: Math.max(1, retryAfter),
      })
    }

    existing.count += 1
    buckets.set(key, existing)
    await next()
  }
}
