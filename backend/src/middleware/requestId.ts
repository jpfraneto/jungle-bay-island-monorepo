import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../types'

export const requestIdMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header('x-request-id')
  const requestId = incoming && incoming.trim().length > 0 ? incoming.trim() : crypto.randomUUID()

  c.set('requestId', requestId)
  c.header('X-Request-Id', requestId)

  await next()
}
