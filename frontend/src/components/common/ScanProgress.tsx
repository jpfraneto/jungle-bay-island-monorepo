import type { ScanStatusResponse } from '../../lib/types';

export function ScanProgress({ status }: { status?: ScanStatusResponse }) {
  const pct = Math.max(0, Math.min(100, status?.progress_pct ?? 0));

  return (
    <section className="card space-y-4">
      <p className="font-display text-xl">Scanning Token...</p>
      <div className="h-2 overflow-hidden rounded-full bg-jungle-800">
        <div className="h-full bg-heat-observer transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-zinc-300">{status?.progress_phase || 'Initializing scan...'}</p>
      <div className="grid gap-3 text-xs text-zinc-400 md:grid-cols-2">
        <div className="rounded-lg border border-jungle-700 bg-jungle-900/70 p-3">
          Events fetched: <span className="font-mono text-zinc-200">{status?.events_fetched ?? '--'}</span>
        </div>
        <div className="rounded-lg border border-jungle-700 bg-jungle-900/70 p-3">
          Holders found: <span className="font-mono text-zinc-200">{status?.holders_found ?? '--'}</span>
        </div>
      </div>
    </section>
  );
}
