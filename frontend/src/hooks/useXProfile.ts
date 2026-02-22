import { usePrivy } from '@privy-io/react-auth';

export interface XProfile {
  username: string;
  name: string;
  profilePictureUrl: string;
}

/**
 * Extracts the X (Twitter) profile from Privy's linked accounts.
 * Returns null if user is not authenticated or has no X account linked.
 */
export function useXProfile(): XProfile | null {
  const { user } = usePrivy();
  if (!user?.twitter) return null;

  return {
    username: user.twitter.username ?? '',
    name: user.twitter.name ?? '',
    profilePictureUrl: user.twitter.profilePictureUrl ?? '',
  };
}
