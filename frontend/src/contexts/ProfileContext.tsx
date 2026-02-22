import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useCreateWallet, useIdentityToken, usePrivy, useWallets } from '@privy-io/react-auth';
import { apiFetch } from '../lib/api';
import type { Tier } from '../lib/types';

export interface UserProfile {
  wallet: string;
  island_heat: number;
  tier: Tier;
  farcaster: {
    fid: number | null;
    username: string | null;
    display_name: string | null;
    pfp_url: string | null;
  } | null;
  token_breakdown: Array<{ token: string; token_name: string; heat_degrees: number }>;
  scans: Array<{ chain: string; token_address: string; scanned_at: string }>;
  connected_wallets: string[];
  wallet_map?: Array<{
    address: string;
    wallet_kind: 'evm' | 'solana';
    linked_via_privy: boolean;
    linked_via_farcaster: boolean;
    farcaster_verified: boolean;
    is_requester_wallet: boolean;
  }>;
  wallet_map_summary?: {
    total_wallets: number;
    evm_wallets: number;
    solana_wallets: number;
    farcaster_verified_wallets: number;
  };
  // Only present on setup response
  farcaster_found?: boolean;
  x_username?: string | null;
}

interface ProfileContextValue {
  profile: UserProfile | null;
  isLoading: boolean;
  isSettingUp: boolean;
  isReady: boolean;
  refetch: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue>({
  profile: null,
  isLoading: false,
  isSettingUp: false,
  isReady: false,
  refetch: async () => {},
});

export function useProfile() {
  return useContext(ProfileContext);
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { authenticated, user: privyUser } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { wallets } = useWallets();
  const walletAddress = wallets.find((w: { address?: string }) => !!w.address)?.address;
  const { createWallet: createEthWallet } = useCreateWallet();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);

  // Log Privy state changes
  useEffect(() => {
    console.log('[PRIVY] authenticated:', authenticated);
    console.log('[PRIVY] user:', privyUser);
    console.log('[PRIVY] identityToken:', identityToken ? `${identityToken.slice(0, 30)}...` : null);
    console.log('[PRIVY] wallets:', wallets.map((w: any) => ({ address: w.address, type: w.walletClientType, chain: w.chainId })));
    console.log('[PRIVY] walletAddress (selected):', walletAddress);
  }, [authenticated, privyUser, identityToken, wallets, walletAddress]);

  // Auto-create embedded wallet for users who logged in before createOnLogin was enabled
  useEffect(() => {
    if (!authenticated || walletAddress) return;
    console.log('[PRIVY] No wallet found, attempting to create embedded wallet...');
    createEthWallet().catch(() => {
      // Wallet may already exist or creation unsupported — ignore
    });
  }, [authenticated, walletAddress, createEthWallet]);

  // Fresh fetch of profile data (no setup, just read)
  const refetch = useCallback(async () => {
    if (!authenticated) return;
    const token = identityToken;
    if (!token) return;

    console.log('[PROFILE] refetch starting...');
    setIsLoading(true);
    try {
      const user = await apiFetch<UserProfile>('/api/me', {
        accessToken: token,
        walletAddress,
      });
      console.log('[PROFILE] refetch result:', user);
      setProfile(user);
    } catch (err) {
      console.error('[PROFILE] refetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [authenticated, identityToken, walletAddress]);

  // Initial setup on first login — idempotent, always call setup
  const initialize = useCallback(async () => {
    if (!authenticated) return;
    const token = identityToken;
    if (!token) return;

    console.log('[PROFILE] initialize (setup) starting...', { walletAddress });
    setIsSettingUp(true);
    try {
      const result = await apiFetch<UserProfile>('/api/me/setup', {
        method: 'POST',
        accessToken: token,
        walletAddress,
      });
      console.log('[PROFILE] setup result:', result);
      setProfile(result);
    } catch (err) {
      console.error('[PROFILE] setup error:', err);
      // Setup failed — try a plain fetch as fallback
      try {
        const user = await apiFetch<UserProfile>('/api/me', {
          accessToken: token,
          walletAddress,
        });
        console.log('[PROFILE] fallback /api/me result:', user);
        setProfile(user);
      } catch (err2) {
        console.error('[PROFILE] fallback /api/me error:', err2);
      }
    } finally {
      setIsSettingUp(false);
      setHasInitialized(true);
    }
  }, [authenticated, identityToken, walletAddress]);

  useEffect(() => {
    console.log('[PROFILE] init effect:', { authenticated, walletAddress: !!walletAddress, hasInitialized, identityToken: !!identityToken });
    if (authenticated && walletAddress && !hasInitialized) {
      if (identityToken) {
        initialize();
      } else {
        console.log('[PROFILE] authenticated + wallet but no identityToken yet, marking initialized');
        setHasInitialized(true);
      }
    }
    if (!authenticated) {
      setProfile(null);
      setHasInitialized(false);
    }
  }, [authenticated, walletAddress, identityToken, hasInitialized, initialize]);

  useEffect(() => {
    if (authenticated && walletAddress && identityToken && hasInitialized && !profile) {
      console.log('[PROFILE] has token + initialized but no profile, triggering refetch');
      void refetch();
    }
  }, [authenticated, walletAddress, identityToken, hasInitialized, profile, refetch]);

  const value = useMemo<ProfileContextValue>(
    () => ({
      profile,
      isLoading,
      isSettingUp,
      isReady: hasInitialized && !isSettingUp,
      refetch,
    }),
    [profile, isLoading, isSettingUp, hasInitialized, refetch],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
