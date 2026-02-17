import type { ViewerContext } from '../lib/types';

export function useViewerContext(viewerContext?: ViewerContext) {
  return {
    context: viewerContext,
    isResidentOrAbove: (viewerContext?.island_heat ?? 0) >= 80,
    hasWalletContext: Boolean(viewerContext?.wallet),
  };
}
