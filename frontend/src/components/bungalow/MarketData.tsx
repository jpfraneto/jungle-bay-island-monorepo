import { BarChart3, DollarSign, Droplets, TrendingUp } from 'lucide-react';
import type { MarketData as MarketDataType } from '../../lib/types';

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--';
  if (value === 0) return '$0';
  if (value < 0.00001) return `$${value.toExponential(2)}`;
  if (value < 1) return `$${value.toPrecision(4)}`;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

interface Props {
  data?: MarketDataType | null;
}

export function MarketData({ data }: Props) {
  if (!data) return null;

  const stats = [
    { label: 'Price', value: formatUsd(data.price_usd), icon: DollarSign },
    { label: 'Market Cap', value: formatUsd(data.market_cap), icon: TrendingUp },
    { label: '24h Volume', value: formatUsd(data.volume_24h), icon: BarChart3 },
    { label: 'Liquidity', value: formatUsd(data.liquidity_usd), icon: Droplets },
  ];

  return (
    <section className="card space-y-4">
      <div className="text-xs uppercase tracking-[0.18em] text-zinc-400">Market Data</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-lg border border-jungle-700 bg-jungle-900/60 p-3">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </div>
            <p className="mt-1 font-mono text-sm text-zinc-100">{value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
