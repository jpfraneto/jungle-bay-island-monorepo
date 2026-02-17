import { memo } from 'react';
import { WalletConnectButton } from './Header';
import { useIslandStore } from '../../store/island';
import { BUNGALOW_BY_ID } from '../../three/helpers/constants';
import { useApi } from '../../hooks/useApi';
import { useUser } from '../../hooks/useUser';
import { formatHeat } from '../../lib/format';

function viewHint(viewMode: ReturnType<typeof useIslandStore.getState>['viewMode']): string {
  if (viewMode === 'building-approach') {
    return 'Tap Enter to step inside';
  }
  if (viewMode === 'building-interior') {
    return 'Tap any frame slot to place an image';
  }
  return 'Tap a bungalow to explore';
}

export const HUD = memo(function HUD() {
  const viewMode = useIslandStore((state) => state.viewMode);
  const selectedBungalow = useIslandStore((state) => state.selectedBungalow);

  const { walletAddress } = useApi();
  const userQuery = useUser(walletAddress);

  const selectedTicker = selectedBungalow ? BUNGALOW_BY_ID.get(selectedBungalow)?.ticker : undefined;

  return (
    <div className="pointer-events-none fixed inset-0 z-20">
      <div className="absolute left-4 top-4 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 backdrop-blur-md">
        <p className="font-display text-lg font-semibold text-zinc-100">Jungle Bay Island</p>
        {selectedTicker ? <p className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-200">{selectedTicker}</p> : null}
      </div>

      <div className="pointer-events-auto absolute right-4 top-4">
        <WalletConnectButton />
      </div>

      <div className="absolute bottom-4 left-4 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 backdrop-blur-md">
        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-400">Your Heat</p>
        <p className="font-display text-xl text-emerald-200">
          {walletAddress ? formatHeat(userQuery.data?.island_heat) : 'Connect wallet'}
        </p>
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-black/30 px-4 py-2 text-sm text-zinc-100 backdrop-blur-md">
        {viewHint(viewMode)}
      </div>
    </div>
  );
});
