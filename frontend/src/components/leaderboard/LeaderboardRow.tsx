import { Link } from 'react-router-dom';
import type { LeaderboardEntry } from '../../lib/types';
import { HeatBadge } from '../common/HeatBadge';
import { formatHeat } from '../../lib/format';

export function LeaderboardRow({ row }: { row: LeaderboardEntry }) {
  return (
    <Link
      to={`/persona/${row.profile.fid}`}
      className="grid gap-3 border-t border-jungle-700/60 px-3 py-3 text-sm transition hover:bg-jungle-800/60 md:grid-cols-[48px_1fr_170px_110px_250px]"
    >
      <span className="font-mono text-zinc-400">#{row.rank}</span>
      <span className="flex items-center gap-2">
        <img
          src={row.profile.pfp_url || 'https://placehold.co/40x40/0d2118/ffffff?text=FC'}
          alt={row.profile.username}
          className="h-8 w-8 rounded-full border border-jungle-700"
        />
        <span>@{row.profile.username}</span>
      </span>
      <span className="font-mono text-zinc-200">{formatHeat(row.island_heat)}</span>
      <span>
        <HeatBadge heat={row.island_heat} tier={row.tier} />
      </span>
      <span className="hidden items-center gap-1 md:flex">
        {row.top_tokens.slice(0, 3).map((token) => (
          <span key={token.ca} className="rounded border border-jungle-700 px-2 py-1 font-mono text-xs text-zinc-300">
            {token.token_symbol}
          </span>
        ))}
      </span>
    </Link>
  );
}
