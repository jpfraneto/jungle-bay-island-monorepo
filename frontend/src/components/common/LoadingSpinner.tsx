export function LoadingSpinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="card flex items-center gap-3 text-sm text-zinc-300">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-heat-observer border-r-transparent" />
      <span>{label}</span>
    </div>
  );
}
