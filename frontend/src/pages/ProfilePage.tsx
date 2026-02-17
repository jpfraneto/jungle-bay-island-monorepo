import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { LogOut, RefreshCw, Copy, Check } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { HeatBadge } from '../components/common/HeatBadge';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useProfile } from '../contexts/ProfileContext';
import { tierLabel } from '../lib/heat';
import { formatHeat, truncateAddress } from '../lib/format';
import type { Tier } from '../lib/types';

export function ProfilePage() {
  const { authenticated, logout } = usePrivy();
  const { profile, isLoading, isReady, isSettingUp, refetch } = useProfile();
  const [isRefreshing, setIsRefreshing] = useState(false);

  if (!authenticated) {
    return <Navigate to="/" replace />;
  }

  if (isSettingUp) {
    return <LoadingSpinner label="Setting up your profile..." />;
  }

  if (!isReady || (isLoading && !profile)) {
    return <LoadingSpinner label="Loading profile..." />;
  }

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  const farcaster = profile?.farcaster;
  const hasFarcaster = Boolean(farcaster?.fid);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header Card */}
      <div className="card">
        {/* Refresh button row — always top-right on mobile */}
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-jungle-600 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-jungle-800 active:bg-jungle-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Profile info */}
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-4">
          <img
            src={farcaster?.pfp_url || 'https://placehold.co/80x80/0d2118/ffffff?text=?'}
            alt={farcaster?.username || 'Profile'}
            className="h-16 w-16 rounded-full border-2 border-jungle-600 object-cover sm:h-20 sm:w-20"
          />
          <div className="flex-1 text-center sm:text-left">
            <h1 className="font-display text-lg font-semibold text-zinc-100 sm:text-xl">
              {farcaster?.display_name || farcaster?.username || 'Anonymous'}
            </h1>
            {farcaster?.username && (
              <p className="text-sm text-zinc-400">@{farcaster.username}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <HeatBadge heat={profile?.island_heat ?? 0} tier={(profile?.tier ?? 'drifter') as Tier} />
              <span className="text-xs text-zinc-400">{tierLabel((profile?.tier ?? 'drifter') as Tier)}</span>
            </div>
          </div>
        </div>

        {/* No Farcaster notice */}
        {!hasFarcaster && (
          <div className="mt-4 rounded-lg border border-yellow-800/40 bg-yellow-900/15 px-3 py-2.5 text-sm leading-relaxed text-yellow-300/90 sm:px-4 sm:py-3">
            We didn't find a Farcaster account linked to your X. Your profile will update automatically if you connect one later.
          </div>
        )}
      </div>

      {/* Connected Wallets */}
      <section className="card">
        <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Your Wallets
        </h2>
        <p className="mb-3 text-xs text-zinc-500">
          Deposit tokens to any of these addresses to build heat.
        </p>
        <div className="space-y-2">
          {(profile?.connected_wallets ?? [profile?.wallet].filter(Boolean)).map((addr) => (
            <CopyableWallet key={addr} address={addr!} />
          ))}
        </div>
      </section>

      {/* Token Exposure */}
      {(profile?.token_breakdown?.length ?? 0) > 0 && (
        <section className="card">
          <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wider text-zinc-400 sm:mb-3">
            Token Exposure
          </h2>
          <div className="divide-y divide-jungle-700/50">
            {profile!.token_breakdown.map((t) => (
              <div key={t.token} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate text-sm text-zinc-200">
                  {t.token_name}
                </span>
                <span className="shrink-0 font-mono text-sm text-zinc-300">
                  {formatHeat(t.heat_degrees)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent Scans */}
      {(profile?.scans?.length ?? 0) > 0 && (
        <section className="card">
          <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wider text-zinc-400 sm:mb-3">
            Recent Scans
          </h2>
          <div className="divide-y divide-jungle-700/50">
            {profile!.scans.slice(0, 20).map((s, i) => (
              <div key={`${s.token_address}-${i}`} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate font-mono text-xs text-zinc-300">
                  {truncateAddress(s.token_address, 8, 6)}
                </span>
                <div className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-400">
                  <span className="uppercase">{s.chain}</span>
                  <span>{new Date(s.scanned_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Logout */}
      <div className="flex justify-center pb-8 pt-2 sm:pt-4">
        <button
          type="button"
          onClick={logout}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-800/60 bg-red-900/20 px-4 py-3 text-sm text-red-400 transition-colors hover:bg-red-900/40 active:bg-red-900/50 sm:w-auto sm:py-2"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </div>
    </div>
  );
}

function CopyableWallet({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex w-full items-center justify-between gap-2 rounded-lg border border-jungle-700 bg-jungle-900/50 px-3 py-3 text-left transition-colors active:bg-jungle-800 sm:py-2.5"
    >
      <span className="min-w-0 truncate font-mono text-xs text-zinc-200 sm:text-sm">
        {address}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-400">
        {copied ? (
          <>
            <Check className="h-4 w-4 text-green-400 sm:h-3.5 sm:w-3.5" />
            <span className="hidden text-green-400 sm:inline">Copied</span>
          </>
        ) : (
          <>
            <Copy className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            <span className="hidden sm:inline">Copy</span>
          </>
        )}
      </span>
    </button>
  );
}
