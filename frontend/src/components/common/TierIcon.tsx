import type { Tier } from '../../lib/types';
import { tierEmoji, tierLabel } from '../../lib/heat';

export function TierIcon({ tier }: { tier: Tier }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs text-zinc-200">
      <span>{tierEmoji(tier)}</span>
      <span>{tierLabel(tier)}</span>
    </span>
  );
}
