import { useEffect } from 'react';
import { useIslandStore } from '../../store/island';

export function BackButton() {
  const viewMode = useIslandStore((state) => state.viewMode);
  const returnToOverview = useIslandStore((state) => state.returnToOverview);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && viewMode !== 'island-overview') {
        returnToOverview();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [returnToOverview, viewMode]);

  if (viewMode === 'island-overview') {
    return null;
  }

  const label = viewMode === 'building-interior' ? '← Back to Island' : '← Overview';

  return (
    <button
      type="button"
      className="pointer-events-auto fixed bottom-4 left-4 z-30 rounded-full border border-white/15 bg-black/35 px-4 py-2 text-sm text-zinc-100 backdrop-blur-md"
      onClick={returnToOverview}
    >
      {label}
    </button>
  );
}
