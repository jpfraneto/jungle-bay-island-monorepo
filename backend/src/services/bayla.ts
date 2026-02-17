import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { encodePacked, keccak256, type Hex } from 'viem'
import { base } from 'viem/chains'
import { V7_CONTRACT_ADDRESS } from '../contract'
import { logInfo, logWarn } from './logger'

const BAYLA_PRIVATE_KEY = process.env.BAYLA_PRIVATE_KEY ?? ''

let baylaSigner: PrivateKeyAccount | null = null

function getSigner(): PrivateKeyAccount | null {
  if (baylaSigner) return baylaSigner
  if (!BAYLA_PRIVATE_KEY) {
    logWarn('BAYLA', 'No BAYLA_PRIVATE_KEY set. On-chain claims will be skipped.')
    return null
  }
  baylaSigner = privateKeyToAccount(BAYLA_PRIVATE_KEY as Hex)
  logInfo('BAYLA', `Signer initialized: ${baylaSigner.address}`)
  return baylaSigner
}

export function isBaylaConfigured(): boolean {
  return Boolean(BAYLA_PRIVATE_KEY)
}

export function getBaylaAddress(): string | null {
  const signer = getSigner()
  return signer?.address ?? null
}

/**
 * Sign a claimBungalow message for the V7 contract.
 * Returns the signature and deadline, or null if Bayla is not configured.
 */
export async function signClaimBungalow(params: {
  claimer: string
  tokenAddress: string
  ipfsHash: string
  name: string
  jbmAmount: bigint
  nativeTokenAmount: bigint
  daimoPaymentId: string
}): Promise<{ signature: Hex; deadline: bigint } | null> {
  const signer = getSigner()
  if (!signer) return null

  // 1 hour deadline
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

  const messageHash = keccak256(
    encodePacked(
      ['string', 'address', 'address', 'string', 'string', 'uint256', 'uint256', 'string', 'uint256', 'uint256', 'address'],
      [
        'claimBungalow',
        params.claimer as `0x${string}`,
        params.tokenAddress as `0x${string}`,
        params.ipfsHash,
        params.name,
        params.jbmAmount,
        params.nativeTokenAmount,
        params.daimoPaymentId,
        deadline,
        BigInt(base.id),
        V7_CONTRACT_ADDRESS,
      ],
    ),
  )

  const signature = await signer.signMessage({ message: { raw: messageHash } })

  logInfo('BAYLA SIGN', `Signed claimBungalow for ${params.tokenAddress} claimer=${params.claimer}`)

  return { signature, deadline }
}
