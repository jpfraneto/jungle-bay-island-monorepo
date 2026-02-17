import { Link } from 'react-router-dom';
import type { Holder } from '../../lib/types';
import { HeatBadge } from '../common/HeatBadge';
import { WalletAddress } from '../common/WalletAddress';
import { FarcasterAvatar } from '../common/FarcasterAvatar';

export function HolderTable({ holders }: { holders: Holder[] }) {
  const topHolders = holders.slice(0, 10);

  return (
    <div className="overflow-hidden rounded-xl border border-jungle-700">
      <div className="max-h-[29rem] overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-jungle-800/95 text-xs uppercase tracking-wide text-zinc-400 backdrop-blur">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Holder</th>
              <th className="px-3 py-2 text-left">Heat</th>
              <th className="px-3 py-2 text-left">Signal</th>
            </tr>
          </thead>
          <tbody>
            {topHolders.map((holder) => {
              const intensity = Math.min(100, (holder.heat_degrees / 300) * 100);
              return (
                <tr key={`${holder.wallet}-${holder.rank}`} className="border-t border-jungle-700/60">
                  <td className="px-3 py-3 font-mono text-xs text-zinc-400">{holder.rank}</td>
                  <td className="px-3 py-3">
                    <Link to={`/user/${holder.wallet}`} className="inline-flex hover:opacity-85">
                      {holder.farcaster ? (
                        <FarcasterAvatar profile={holder.farcaster} />
                      ) : (
                        <WalletAddress address={holder.wallet} />
                      )}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <HeatBadge heat={holder.heat_degrees} tier={holder.tier} />
                  </td>
                  <td className="px-3 py-3">
                    <div className="h-2 w-24 rounded bg-jungle-800">
                      <div
                        className="h-full rounded bg-gradient-to-r from-heat-drifter via-heat-resident to-heat-elder"
                        style={{ width: `${intensity}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
