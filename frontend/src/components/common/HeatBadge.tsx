import type { Tier } from '../../lib/types';
import { tierColor, tierEmoji } from '../../lib/heat';
import { formatHeat } from '../../lib/format';

export function HeatBadge({ heat, tier }: { heat: number; tier: Tier }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 font-mono text-xs ${tierColor(tier)}`}>
      <span>{tierEmoji(tier)}</span>
      <span>{formatHeat(heat)}</span>
    </span>
  );
}
