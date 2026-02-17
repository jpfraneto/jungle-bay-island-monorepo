import { ExternalLink } from 'lucide-react';
import type { Bungalow } from '../../lib/types';
import { formatNumber } from '../../lib/format';
import { HolderTable } from './HolderTable';
import { HeatDistribution } from './HeatDistribution';

export function Hearth({ bungalow }: { bungalow: Bungalow }) {
  return (
    <section className="card space-y-5">
      <div className="text-xs uppercase tracking-[0.18em] text-zinc-400">03 - The Hearth</div>
      <HeatDistribution rows={bungalow.heat_distribution || []} />
      <div className="grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded-lg border border-jungle-700 p-3">
          <p className="text-xs text-zinc-400">Total Supply</p>
          <p className="mt-1 font-mono text-zinc-100">{formatNumber(bungalow.vitals?.total_supply)}</p>
        </div>
        <div className="rounded-lg border border-jungle-700 p-3">
          <p className="text-xs text-zinc-400">Holders</p>
          <p className="mt-1 font-mono text-zinc-100">{formatNumber(bungalow.vitals?.holder_count)}</p>
        </div>
        <a
          href={bungalow.vitals?.dex_url || `https://dexscreener.com/base/${bungalow.ca}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-jungle-700 p-3 hover:bg-jungle-800"
        >
          <p className="text-xs text-zinc-400">Chart</p>
          <p className="mt-1 inline-flex items-center gap-1 font-mono text-zinc-100">
            View on DexScreener
            <ExternalLink className="h-3 w-3" />
          </p>
        </a>
      </div>
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">Top 10 Holders</p>
        <HolderTable holders={bungalow.holders || []} />
      </div>
    </section>
  );
}
