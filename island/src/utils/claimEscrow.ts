export const claimEscrowAbi = [
  {
    name: "claimPeriodTotal",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "escrow", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "periodId", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "breakdownHash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export interface ClaimSignaturePayload {
  signature?: string;
  claim_contract?: string;
  escrow?: string;
  amount_jbm?: string;
  amount_wei?: string;
  periodId?: string;
  nonce?: number;
  deadline?: string;
  breakdown_hash?: string;
  signerAddress?: string;
  payout_wallet?: string;
  error?: string;
}

export function isHexAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function isHexSignature(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]+$/.test(value);
}

export function isHexBytes32(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}
