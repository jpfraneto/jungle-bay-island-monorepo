export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatCompactUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatUsdPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value >= 1) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(3)}`;
}

export function formatAddress(address: string | null | undefined): string {
  if (!address) return "—";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatTimeAgo(input: string | null | undefined): string {
  if (!input) return "Never";
  const time = new Date(input).getTime();
  if (Number.isNaN(time)) return "Unknown";

  const diffMs = Date.now() - time;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return new Date(input).toLocaleDateString();
}

export function formatJbmAmount(value: string | number): string {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return `${value} JBM`;

  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(0)}M JBM`;
  if (numeric >= 1_000) return `${(numeric / 1_000).toFixed(0)}k JBM`;
  return `${numeric} JBM`;
}

export function formatJbmCount(value: string | number): string {
  return formatJbmAmount(value).replace(/ JBM$/, "");
}
