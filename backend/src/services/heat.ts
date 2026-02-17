const K = 60

export const TIER_THRESHOLDS = {
  elder: 250,
  builder: 150,
  resident: 80,
  observer: 30,
} as const

export type TierName = 'Elder' | 'Builder' | 'Resident' | 'Observer' | 'Drifter'

export interface BalanceSnapshot {
  timestamp: number
  balance: bigint
}

export function calculateTWAB(
  snapshots: BalanceSnapshot[],
  deployTimestamp: number,
  nowTimestamp: number,
): number {
  if (snapshots.length === 0) return 0

  const totalDuration = nowTimestamp - deployTimestamp
  if (totalDuration <= 0) return 0

  let weightedSum = 0
  for (let i = 0; i < snapshots.length; i += 1) {
    const start = snapshots[i].timestamp
    const end = i < snapshots.length - 1 ? snapshots[i + 1].timestamp : nowTimestamp
    const duration = end - start
    const balance = Number(snapshots[i].balance)

    if (duration > 0 && balance > 0) {
      weightedSum += balance * duration
    }
  }

  return weightedSum / totalDuration
}

export function calculateHeatDegrees(twab: number, totalSupply: number): number {
  if (!Number.isFinite(twab) || !Number.isFinite(totalSupply) || totalSupply <= 0) return 0
  const rawHeat = twab / totalSupply
  return 100 * (1 - Math.exp(-K * rawHeat))
}

export function getTierFromHeat(islandHeat: number): TierName {
  if (islandHeat >= TIER_THRESHOLDS.elder) return 'Elder'
  if (islandHeat >= TIER_THRESHOLDS.builder) return 'Builder'
  if (islandHeat >= TIER_THRESHOLDS.resident) return 'Resident'
  if (islandHeat >= TIER_THRESHOLDS.observer) return 'Observer'
  return 'Drifter'
}

export interface TierDistribution {
  elders: number
  builders: number
  residents: number
  observers: number
  drifters: number
}

export function emptyTierDistribution(): TierDistribution {
  return { elders: 0, builders: 0, residents: 0, observers: 0, drifters: 0 }
}

export function addHeatToDistribution(distribution: TierDistribution, islandHeat: number): void {
  const tier = getTierFromHeat(islandHeat)
  if (tier === 'Elder') distribution.elders += 1
  if (tier === 'Builder') distribution.builders += 1
  if (tier === 'Resident') distribution.residents += 1
  if (tier === 'Observer') distribution.observers += 1
  if (tier === 'Drifter') distribution.drifters += 1
}
