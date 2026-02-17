import { Link, useParams } from 'react-router-dom';
import { useUser } from '../../hooks/useUser';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { EmptyState } from '../common/EmptyState';
import { WalletAddress } from '../common/WalletAddress';
import { HeatBadge } from '../common/HeatBadge';
import { tierFromHeat } from '../../lib/heat';
import { formatHeat } from '../../lib/format';

export function UserPage() {
  const { wallet = '' } = useParams();
  const { data, isLoading, isError } = useUser(wallet);

  if (isLoading) return <LoadingSpinner label="Loading user profile..." />;
  if (isError || !data) {
    return <EmptyState title="User unavailable" description="No profile data found for this wallet." />;
  }

  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">Wallet Profile</p>
        <div className="flex flex-wrap items-center gap-3">
          <WalletAddress address={data.wallet} />
          {data.island_heat !== undefined && (
            <HeatBadge heat={data.island_heat} tier={data.tier || tierFromHeat(data.island_heat)} />
          )}
          {data.farcaster?.username && (
            <span className="rounded-full border border-jungle-700 px-3 py-1 text-xs text-zinc-300">
              @{data.farcaster.username}
            </span>
          )}
        </div>
      </section>

      <section className="card space-y-3">
        <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">Token Exposure</p>
        {data.tokens.length === 0 ? (
          <p className="text-sm text-zinc-500">No token breakdown available.</p>
        ) : (
          <div className="space-y-2">
            {data.tokens.map((token) => (
              <Link
                key={`${token.chain}-${token.ca}`}
                to={`/${token.chain}/${token.ca}`}
                className="flex items-center justify-between rounded-lg border border-jungle-700 px-3 py-2 text-sm hover:bg-jungle-800"
              >
                <span>
                  {token.token_name} <span className="font-mono text-zinc-400">${token.token_symbol}</span>
                </span>
                <span className="font-mono text-xs text-zinc-200">{formatHeat(token.heat_degrees)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">Recent Scans</p>
        {data.scans.length === 0 ? (
          <p className="text-sm text-zinc-500">No scan history available.</p>
        ) : (
          <div className="space-y-2">
            {data.scans.map((scan) => (
              <Link
                key={`${scan.chain}-${scan.ca}-${scan.scanned_at || 'scan'}`}
                to={`/${scan.chain}/${scan.ca}`}
                className="block rounded-md border border-jungle-700 px-3 py-2 font-mono text-xs hover:bg-jungle-800"
              >
                /{scan.chain}/{scan.ca}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
