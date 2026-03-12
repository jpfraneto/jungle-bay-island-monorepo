import { parseUnits } from "viem";

export const MEMETICS_CONTRACT_ADDRESS =
  (import.meta.env.VITE_MEMETICS_CONTRACT_ADDRESS as `0x${string}` | undefined) ??
  ("0xaa027CFC273e58BD19a5df9a803598DF9Bebad1C" as const);

export const memeticsAbi = [
  {
    type: "function",
    name: "registerProfile",
    stateMutability: "nonpayable",
    inputs: [
      { name: "handle", type: "string" },
      { name: "heatScore", type: "uint256" },
      { name: "salt", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [{ name: "profileId", type: "uint256" }],
  },
  {
    type: "function",
    name: "linkWallet",
    stateMutability: "nonpayable",
    inputs: [
      { name: "profileId", type: "uint256" },
      { name: "heatScore", type: "uint256" },
      { name: "salt", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "syncHeat",
    stateMutability: "nonpayable",
    inputs: [
      { name: "profileId", type: "uint256" },
      { name: "heatScore", type: "uint256" },
      { name: "salt", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimDailyMemes",
    stateMutability: "nonpayable",
    inputs: [
      { name: "periodId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "heatScore", type: "uint256" },
      { name: "salt", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "createBungalowPetition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bungalowName", type: "string" },
      { name: "metadataURI", type: "string" },
      { name: "primaryAssetChain", type: "uint8" },
      { name: "primaryAssetKind", type: "uint8" },
      { name: "primaryAssetRef", type: "string" },
      { name: "heatScore", type: "uint256" },
      { name: "attestedApesBalance", type: "uint256" },
      { name: "salt", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [{ name: "petitionId", type: "uint256" }],
  },
  {
    type: "function",
    name: "signBungalowPetition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "petitionId", type: "uint256" },
      { name: "heatScore", type: "uint256" },
      { name: "salt", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "createCommission",
    stateMutability: "nonpayable",
    inputs: [
      { name: "briefURI", type: "string" },
      { name: "budget", type: "uint256" },
      { name: "claimDeadline", type: "uint64" },
      { name: "deliveryDeadline", type: "uint64" },
    ],
    outputs: [{ name: "commissionId", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimCommission",
    stateMutability: "nonpayable",
    inputs: [{ name: "commissionId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "submitCommission",
    stateMutability: "nonpayable",
    inputs: [
      { name: "commissionId", type: "uint256" },
      { name: "deliverableURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approveCommission",
    stateMutability: "nonpayable",
    inputs: [{ name: "commissionId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelCommission",
    stateMutability: "nonpayable",
    inputs: [{ name: "commissionId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimTimedOutCommissionPayout",
    stateMutability: "nonpayable",
    inputs: [{ name: "commissionId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setMainWallet",
    stateMutability: "nonpayable",
    inputs: [{ name: "newMainWallet", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "unlinkWallet",
    stateMutability: "nonpayable",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "replacementMainWallet", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "listArtifact",
    stateMutability: "nonpayable",
    inputs: [
      { name: "uri", type: "string" },
      { name: "price", type: "uint256" },
    ],
    outputs: [{ name: "artifactId", type: "uint256" }],
  },
  {
    type: "function",
    name: "installArtifact",
    stateMutability: "nonpayable",
    inputs: [
      { name: "artifactId", type: "uint256" },
      { name: "bungalowId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "walletProfileId",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getProfile",
    stateMutability: "view",
    inputs: [{ name: "profileId", type: "uint256" }],
    outputs: [
      { name: "handleHash", type: "bytes32" },
      { name: "handle", type: "string" },
      { name: "mainWallet", type: "address" },
      { name: "heatScore", type: "uint256" },
      { name: "flags", type: "uint256" },
      { name: "createdAt", type: "uint64" },
      { name: "updatedAt", type: "uint64" },
      { name: "wallets", type: "address[]" },
    ],
  },
] as const;

export const erc20ApprovalAbi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface MemeticsProfileData {
  id: number;
  handle: string;
  handle_hash: string;
  main_wallet: string;
  heat_score: string;
  flags: string;
  created_at: number;
  updated_at: number;
  wallets: string[];
}

export interface MemeticsMeResponse {
  contract_address: string | null;
  preferred_handle: string | null;
  backend_heat_score: number;
  authenticated_wallets: string[];
  profile: MemeticsProfileData | null;
}

export function parseJbmToWei(amountJbm: string): bigint {
  return parseUnits(amountJbm.trim(), 18);
}

export function getMemeticsErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const reasonMatch = error.message.match(
    /reverted with(?: the following reason:)?\s*([\s\S]*?)(?:\n\s*Contract Call:|$)/i,
  );
  if (reasonMatch?.[1]) {
    return reasonMatch[1].trim();
  }

  const customErrorMatch = error.message.match(/custom error\s+'([^']+)'/i);
  if (customErrorMatch?.[1]) {
    return customErrorMatch[1].trim();
  }

  const compact = error.message.split("\nContract Call:")[0]?.trim();
  return compact || fallback;
}
