import { Html, useProgress } from '@react-three/drei';

export function LoadingScreen() {
  const { progress } = useProgress();

  return (
    <Html fullscreen>
      <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-jungle-950/90">
        <div className="w-72 rounded-2xl border border-white/10 bg-black/40 p-4 text-center backdrop-blur-md">
          <p className="font-display text-sm text-zinc-200">Preparing Jungle Bay Island</p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${Math.max(4, progress)}%` }} />
          </div>
          <p className="mt-2 font-mono text-xs text-zinc-400">{progress.toFixed(0)}%</p>
        </div>
      </div>
    </Html>
  );
}
