import { type Address, erc20Abi } from 'viem'
import { publicClients, type SupportedChain } from '../config'
import { logError, logInfo } from './logger'

export interface TokenHoldings {
  wallets: Array<{
    address: string
    chain: 'eth' | 'sol'
    balance: bigint
  }>
  totalBalance: bigint
  holdsToken: boolean
}

/**
 * Check ERC20 token balance across multiple ETH wallets.
 * Returns individual balances and total.
 */
export async function checkEthTokenBalances(
  tokenAddress: string,
  wallets: string[],
): Promise<Array<{ address: string; balance: bigint }>> {
  if (wallets.length === 0) return []

  const results = await Promise.allSettled(
    wallets.map(async (wallet) => {
      try {
        const balance = await publicClients.base.readContract({
          address: tokenAddress as Address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [wallet as Address],
        })
        return { address: wallet, balance }
      } catch {
        return { address: wallet, balance: 0n }
      }
    })
  )

  return results.map((r) =>
    r.status === 'fulfilled' ? r.value : { address: '', balance: 0n }
  ).filter((r) => r.address)
}

/**
 * Calculate heat score for a user's token holdings.
 *
 * Heat score tiers (based on token balance as % of total supply):
 * - 0 balance → 0 heat (drifter)
 * - any holder → base 10 heat (observer)
 * - top 10% holder → 50+ heat (observer/resident)
 * - top 1% holder → 100+ heat (resident/builder)
 * - top 0.1% holder → 200+ heat (builder/elder)
 *
 * For now, simplified: heat = log2(balance_in_tokens + 1) * 10
 * This gives reasonable scores:
 * - 1 token → 10 heat
 * - 100 tokens → 67 heat
 * - 10,000 tokens → 133 heat
 * - 1,000,000 tokens → 200 heat
 */
export function calculateHeatFromBalance(totalBalance: bigint, decimals: number = 18): number {
  if (totalBalance === 0n) return 0

  // Convert to human-readable token amount
  const divisor = 10n ** BigInt(decimals)
  const wholeTokens = Number(totalBalance / divisor)
  const fractional = Number(totalBalance % divisor) / Number(divisor)
  const tokenAmount = wholeTokens + fractional

  if (tokenAmount <= 0) return 0

  // log2(amount + 1) * 10, capped at 300
  const heat = Math.log2(tokenAmount + 1) * 10
  return Math.min(Math.round(heat * 10) / 10, 300)
}

/**
 * Get token decimals from the contract.
 */
export async function getTokenDecimals(tokenAddress: string): Promise<number> {
  try {
    const decimals = await publicClients.base.readContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: 'decimals',
    })
    return decimals
  } catch {
    return 18 // default
  }
}

/**
 * Full pipeline: check all wallets for a token and calculate heat.
 */
export async function calculateUserHeat(
  tokenAddress: string,
  chain: SupportedChain,
  ethWallets: string[],
  _solWallets: string[], // TODO: implement SPL token balance check
): Promise<{ heat: number; totalBalance: bigint; holdings: Array<{ address: string; balance: bigint }> }> {
  if (chain !== 'base') {
    // For now, only Base tokens supported for on-chain balance check
    // Solana SPL balance checking can be added later
    logInfo('HOLDINGS', `Skipping on-chain balance check for chain=${chain}`)
    return { heat: 0, totalBalance: 0n, holdings: [] }
  }

  const holdings = await checkEthTokenBalances(tokenAddress, ethWallets)
  const totalBalance = holdings.reduce((sum, h) => sum + h.balance, 0n)

  const decimals = await getTokenDecimals(tokenAddress)
  const heat = calculateHeatFromBalance(totalBalance, decimals)

  logInfo('HOLDINGS', `token=${tokenAddress} wallets=${ethWallets.length} total_balance=${totalBalance} decimals=${decimals} heat=${heat}`)

  return { heat, totalBalance, holdings }
}
