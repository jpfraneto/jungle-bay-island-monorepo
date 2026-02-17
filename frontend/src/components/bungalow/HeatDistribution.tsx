import type { TierCount } from '../../lib/types';
import { sortTiers, tierEmoji, tierLabel } from '../../lib/heat';
import { formatNumber } from '../../lib/format';

export function HeatDistribution({ rows }: { rows: TierCount[] }) {
  const sorted = sortTiers(rows);
  const total = sorted.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">Heat Distribution</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {sorted.map((row) => {
          const pct = total ? (row.count / total) * 100 : 0;
          return (
            <div key={row.tier} className="rounded-lg border border-jungle-700 bg-jungle-900/60 p-3">
              <div className="flex items-center justify-between text-xs text-zinc-300">
                <span>
                  {tierEmoji(row.tier)} {tierLabel(row.tier)}
                </span>
                <span className="font-mono">{formatNumber(row.count)}</span>
              </div>
              <div className="mt-2 h-2 rounded bg-jungle-800">
                <div className="h-full rounded bg-zinc-300/70" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
