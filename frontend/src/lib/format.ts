export function formatHeat(value: number | undefined): string {
  if (value === undefined) return '--';
  return `${value.toFixed(1)}°`;
}

export function formatCompact(value: number | undefined): string {
  if (value === undefined) return '--';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatNumber(value: number | string | undefined): string {
  if (value === undefined) return '--';
  return new Intl.NumberFormat('en-US').format(Number(value));
}

export function formatUsd(value: number | undefined): string {
  if (value === undefined) return '--';
  if (value < 0.01) return `$${value.toPrecision(3)}`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

export function truncateAddress(address: string, start = 6, end = 4): string {
  if (!address) return '';
  if (address.length <= start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}
