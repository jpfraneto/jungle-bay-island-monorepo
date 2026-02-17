import type { Tier } from '../../lib/types';

const tiers: Array<{ value: Tier | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'elder', label: 'Elders' },
  { value: 'builder', label: 'Builders' },
  { value: 'resident', label: 'Residents' },
  { value: 'observer', label: 'Observers' },
  { value: 'drifter', label: 'Drifters' },
];

export function TierFilter({
  value,
  onChange,
}: {
  value: Tier | 'all';
  onChange: (tier: Tier | 'all') => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {tiers.map((tier) => (
        <button
          key={tier.value}
          type="button"
          onClick={() => onChange(tier.value)}
          className={`rounded-lg border px-3 py-1.5 text-xs ${
            value === tier.value
              ? 'border-heat-observer bg-heat-observer/20 text-heat-observer'
              : 'border-jungle-700 text-zinc-300 hover:bg-jungle-800'
          }`}
        >
          {tier.label}
        </button>
      ))}
    </div>
  );
}
