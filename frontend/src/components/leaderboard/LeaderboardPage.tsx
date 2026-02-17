import { useState } from 'react';
import { useLeaderboard } from '../../hooks/useLeaderboard';
import type { Tier } from '../../lib/types';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { EmptyState } from '../common/EmptyState';
import { TierFilter } from './TierFilter';
import { LeaderboardRow } from './LeaderboardRow';
import { sortTiers, tierEmoji, tierLabel } from '../../lib/heat';
import { formatNumber } from '../../lib/format';

export function LeaderboardPage() {
  const [tier, setTier] = useState<Tier | 'all'>('all');
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useLeaderboard({ page, tier });

  if (isLoading) return <LoadingSpinner label="Loading census..." />;
  if (isError || !data) {
    return <EmptyState title="Census unavailable" description="Unable to load leaderboard right now." />;
  }

  const rows = Array.isArray(data.rows) ? data.rows : [];
  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size));

  return (
    <div className="space-y-5">
      <section className="card space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl">Jungle Bay Island</h1>
            <p className="text-sm text-zinc-400">
              {formatNumber(data.total)} personas, {formatNumber(data.total_wallets)} wallets, {formatNumber(data.tokens_scanned)} tokens scanned
            </p>
          </div>
          <TierFilter
            value={tier}
            onChange={(next) => {
              setTier(next);
              setPage(1);
            }}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {sortTiers(data.tier_distribution).map((item) => (
            <div key={item.tier} className="rounded-lg border border-jungle-700 px-3 py-2 text-sm">
              <p className="text-zinc-300">
                {tierEmoji(item.tier)} {tierLabel(item.tier)}
              </p>
              <p className="font-mono text-zinc-100">{formatNumber(item.count)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card overflow-hidden p-0">
        <div className="grid bg-jungle-800/80 px-3 py-2 text-xs uppercase tracking-wide text-zinc-400 md:grid-cols-[48px_1fr_170px_110px_250px]">
          <span>Rank</span>
          <span>Persona</span>
          <span>Heat</span>
          <span>Tier</span>
          <span className="hidden md:block">Top Tokens</span>
        </div>
        <div>
          {rows.map((row) => (
            <LeaderboardRow key={row.profile.fid} row={row} />
          ))}
        </div>
      </section>

      <section className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="rounded-lg border border-jungle-700 px-3 py-1.5 text-sm text-zinc-300 disabled:opacity-40"
        >
          Previous
        </button>
        <span className="font-mono text-sm text-zinc-300">
          Page {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
          className="rounded-lg border border-jungle-700 px-3 py-1.5 text-sm text-zinc-300 disabled:opacity-40"
        >
          Next
        </button>
      </section>
    </div>
  );
}
