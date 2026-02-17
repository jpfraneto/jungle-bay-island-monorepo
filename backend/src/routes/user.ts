import { Hono } from 'hono'
import { normalizeAddress } from '../config'
import { getUserByWallet } from '../db/queries'
import { ApiError } from '../services/errors'
import { logInfo } from '../services/logger'

const userRoute = new Hono()

userRoute.get('/user/:wallet', async (c) => {
  const wallet = normalizeAddress(c.req.param('wallet'))
  if (!wallet) {
    throw new ApiError(400, 'invalid_wallet', 'Invalid wallet address')
  }

  const user = await getUserByWallet(wallet)
  if (!user) {
    throw new ApiError(404, 'user_not_found', 'User not found')
  }

  logInfo(
    'USER',
    `wallet=${wallet} island_heat=${user.island_heat} tokens=${user.token_breakdown.length} scans=${user.scans.length}`,
  )

  return c.json(user)
})

export default userRoute
