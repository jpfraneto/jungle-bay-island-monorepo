import type { JWTPayload } from 'jose'

export interface AppVariables {
  walletAddress?: string
  walletAddresses?: string[]
  privyClaims?: JWTPayload
  privyUserId?: string
  requestId?: string
  agentName?: string
  agentId?: number
}

export type AppEnv = {
  Variables: AppVariables
}
