import { useMemo } from 'react';
import { isAddress } from 'viem';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { useBungalow } from '../../hooks/useBungalow';
import { useIslandStore } from '../../store/island';
import { BUNGALOW_BY_ID, isSupportedScanChain } from '../../three/helpers/constants';

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function BungalowInfoPanel() {
  const viewMode = useIslandStore((state) => state.viewMode);
  const selectedBungalow = useIslandStore((state) => state.selectedBungalow);
  const selectedChain = useIslandStore((state) => state.selectedChain);
  const selectedCa = useIslandStore((state) => state.selectedCa);

  const backendChain = selectedChain && isSupportedScanChain(selectedChain) ? selectedChain : undefined;
  const backendCa = backendChain && selectedCa && isAddress(selectedCa) ? selectedCa : undefined;

  const { data, isLoading, isError, error } = useBungalow(backendChain, backendCa);
  const fallback = selectedBungalow ? BUNGALOW_BY_ID.get(selectedBungalow) : undefined;

  const title = useMemo(() => {
    if (!data?.bungalow) return fallback ? `${fallback.name} (${fallback.ticker})` : 'Bungalow';
    return `${data.bungalow.token_name} (${data.bungalow.token_symbol})`;
  }, [data?.bungalow, fallback]);

  const holderCount = data?.bungalow.vitals?.holder_count ?? 0;
  const holders = data?.bungalow.holders ?? [];
  const showHolders = holders.length > 0;

  if (viewMode !== 'building-approach') {
    return null;
  }

  return (
    <aside className="pointer-events-auto fixed bottom-6 right-6 z-20 w-full max-w-sm rounded-2xl border border-white/10 bg-black/35 p-4 text-sm backdrop-blur-md">
      <p className="font-display text-lg text-zinc-100">{title}</p>
      {isLoading && backendChain ? <p className="mt-2 text-zinc-300">Loading bungalow details...</p> : null}
      {!backendChain ? <p className="mt-2 text-zinc-300">Manual bungalow profile. On-chain data sync is Base/Ethereum only.</p> : null}
      {isError ? (
        <p className="mt-2 rounded-lg border border-rose-300/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-200">
          Failed to load DB data: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      ) : null}

      {data?.bungalow.description ? <p className="mt-2 text-zinc-300">{data.bungalow.description}</p> : null}
      {!data?.bungalow.description && fallback?.description ? <p className="mt-2 text-zinc-300">{fallback.description}</p> : null}

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-white/10 bg-black/30 p-2">
          <p className="text-zinc-400">Holders</p>
          <p className="font-mono text-zinc-100">{backendChain ? holderCount : '--'}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/30 p-2">
          <p className="text-zinc-400">Contract</p>
          <p className="font-mono text-zinc-100">{selectedCa ? shortenAddress(selectedCa) : 'Unknown'}</p>
        </div>
      </div>

      {backendChain ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/25 p-2">
          <p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-zinc-400">Top Holders</p>
          {showHolders ? (
            <div className="space-y-1 text-xs">
              {holders.slice(0, 4).map((holder) => (
                <div key={holder.wallet} className="flex items-center justify-between text-zinc-200">
                  <span className="font-mono">{shortenAddress(holder.wallet)}</span>
                  <span className="text-emerald-200">{holder.heat_degrees} heat</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-400">No holder rows yet (scan may still be pending).</p>
          )}
        </div>
      ) : null}

      {backendChain && backendCa ? (
        <Link
          to={`/b/${backendChain}/${backendCa}`}
          className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-heat-observer/40 bg-heat-observer/10 px-3 py-2 text-sm text-heat-observer hover:bg-heat-observer/20"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          View full bungalow
        </Link>
      ) : null}
    </aside>
  );
}
