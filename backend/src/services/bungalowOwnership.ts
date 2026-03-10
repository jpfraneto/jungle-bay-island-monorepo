import { normalizeAddress } from "../config";
import {
  getBungalowOwnerRecord,
  getUserByWalletAddress,
} from "../db/queries";

interface ResolveBungalowIdentityInput {
  wallet?: string | null;
  privyUserId?: string | null;
}

export interface ResolvedBungalowIdentity {
  wallet: string | null;
  privyUserId: string | null;
}

export async function resolveBungalowIdentity(
  input: ResolveBungalowIdentityInput,
): Promise<ResolvedBungalowIdentity> {
  const wallet =
    (input.wallet ? normalizeAddress(input.wallet) : null) ??
    (input.wallet ? normalizeAddress(input.wallet, "solana") : null);
  const providedPrivyUserId = input.privyUserId?.trim() || null;

  if (providedPrivyUserId) {
    return {
      wallet,
      privyUserId: providedPrivyUserId,
    };
  }

  if (!wallet) {
    return {
      wallet: null,
      privyUserId: null,
    };
  }

  const owner = await getUserByWalletAddress(wallet);
  return {
    wallet,
    privyUserId: owner?.privy_user_id ?? null,
  };
}

async function walletMatchesIdentity(
  wallet: string | null,
  identity: ResolvedBungalowIdentity,
): Promise<boolean> {
  if (!wallet) {
    return false;
  }

  const normalizedWallet =
    normalizeAddress(wallet) ?? normalizeAddress(wallet, "solana");
  if (!normalizedWallet) {
    return false;
  }

  if (
    identity.wallet &&
    normalizedWallet.toLowerCase() === identity.wallet.toLowerCase()
  ) {
    return true;
  }

  if (!identity.privyUserId) {
    return false;
  }

  const owner = await getUserByWalletAddress(normalizedWallet);
  return owner?.privy_user_id === identity.privyUserId;
}

export async function getBungalowOwnershipState(input: {
  tokenAddress: string;
  chain: string;
  identity: ResolvedBungalowIdentity;
}): Promise<{
  ownerRecord: Awaited<
    ReturnType<typeof getBungalowOwnerRecord>
  >;
  hasOwner: boolean;
  matchesIdentity: boolean;
}> {
  const ownerRecord = await getBungalowOwnerRecord(
    input.tokenAddress,
    input.chain,
  );
  const hasOwner = Boolean(
    ownerRecord?.is_claimed ||
      ownerRecord?.current_owner ||
      ownerRecord?.verified_admin,
  );

  if (!hasOwner || !ownerRecord) {
    return {
      ownerRecord,
      hasOwner: false,
      matchesIdentity: false,
    };
  }

  if (
    ownerRecord.claimed_by_privy_user_id &&
    input.identity.privyUserId &&
    ownerRecord.claimed_by_privy_user_id === input.identity.privyUserId
  ) {
    return {
      ownerRecord,
      hasOwner: true,
      matchesIdentity: true,
    };
  }

  const [matchesOwner, matchesAdmin] = await Promise.all([
    walletMatchesIdentity(ownerRecord.current_owner, input.identity),
    walletMatchesIdentity(ownerRecord.verified_admin, input.identity),
  ]);

  return {
    ownerRecord,
    hasOwner: true,
    matchesIdentity: matchesOwner || matchesAdmin,
  };
}
