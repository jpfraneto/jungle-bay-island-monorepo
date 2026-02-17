import { Loader2 } from 'lucide-react';

interface ScanGateProps {
  ca: string;
  connected: boolean;
  isResidentOrAbove: boolean;
  scansRemaining?: number;
  onScan: () => void;
  isScanning: boolean;
  errorMessage?: string;
}

export function ScanGate({
  ca,
  connected,
  isResidentOrAbove,
  scansRemaining,
  onScan,
  isScanning,
  errorMessage,
}: ScanGateProps) {
  return (
    <section className="card space-y-5">
      <p className="font-display text-2xl">This token hasn't been explored yet.</p>
      <p className="font-mono text-xs text-zinc-400">{ca}</p>
      <p className="text-sm text-zinc-300">
        Scanning analyzes all Transfer events to build a heat map of this token's holder community.
      </p>
      {!connected ? (
        <button className="rounded-lg bg-jungle-700 px-4 py-2 text-sm text-zinc-200" disabled>
          Connect wallet to scan this token
        </button>
      ) : (
        <button
          type="button"
          onClick={onScan}
          disabled={isScanning}
          className="inline-flex items-center gap-2 rounded-lg bg-heat-observer px-4 py-2 font-medium text-jungle-950 disabled:opacity-60"
        >
          {isScanning && <Loader2 className="h-4 w-4 animate-spin" />}
          {isResidentOrAbove
            ? `Scan this token${scansRemaining !== undefined ? ` (${scansRemaining} scans left)` : ''}`
            : 'Scan this token - 1 USDC (coming soon)'}
        </button>
      )}
      {errorMessage && <p className="text-sm text-red-300">{errorMessage}</p>}
    </section>
  );
}
