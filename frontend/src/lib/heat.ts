import type { Tier } from './types';

const TIER_ORDER: Tier[] = ['elder', 'builder', 'resident', 'observer', 'drifter'];

export function tierFromHeat(heat: number): Tier {
  if (heat >= 250) return 'elder';
  if (heat >= 150) return 'builder';
  if (heat >= 80) return 'resident';
  if (heat >= 30) return 'observer';
  return 'drifter';
}

export function normalizeTier(raw: unknown): Tier {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'elder' || value === 'elders') return 'elder';
  if (value === 'builder' || value === 'builders') return 'builder';
  if (value === 'resident' || value === 'residents') return 'resident';
  if (value === 'observer' || value === 'observers') return 'observer';
  return 'drifter';
}

export function tierColor(tier: Tier): string {
  switch (tier) {
    case 'elder':
      return 'text-heat-elder border-heat-elder/40 bg-heat-elder/15';
    case 'builder':
      return 'text-heat-builder border-heat-builder/40 bg-heat-builder/15';
    case 'resident':
      return 'text-heat-resident border-heat-resident/40 bg-heat-resident/15';
    case 'observer':
      return 'text-heat-observer border-heat-observer/40 bg-heat-observer/15';
    case 'drifter':
      return 'text-heat-drifter border-heat-drifter/40 bg-heat-drifter/15';
  }
}

export function tierLabel(tier: Tier): string {
  switch (tier) {
    case 'elder':
      return 'Elder';
    case 'builder':
      return 'Builder';
    case 'resident':
      return 'Resident';
    case 'observer':
      return 'Observer';
    case 'drifter':
      return 'Drifter';
  }
}

export function tierEmoji(tier: Tier): string {
  switch (tier) {
    case 'elder':
      return '👑';
    case 'builder':
      return '🔨';
    case 'resident':
      return '🏠';
    case 'observer':
      return '👁️';
    case 'drifter':
      return '🌊';
  }
}

export function sortTiers<T extends { tier: Tier }>(rows: readonly T[] | null | undefined): T[] {
  if (!Array.isArray(rows)) return [];
  return [...rows].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
}
