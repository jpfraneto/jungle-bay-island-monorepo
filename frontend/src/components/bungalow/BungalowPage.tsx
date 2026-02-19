import { useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useBungalow } from '../../hooks/useBungalow';
import { useBungalowCurate } from '../../hooks/useBungalowCurate';
import { useViewerContext } from '../../hooks/useViewerContext';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { EmptyState } from '../common/EmptyState';
import { HeatBadge } from '../common/HeatBadge';
import { Threshold } from './Threshold';
import { MarketData } from './MarketData';
import { Wall } from './Wall';
import { BulletinBoard } from './BulletinBoard';
import { Shelf } from './Shelf';
import { Hearth } from './Hearth';
import { Lagoon } from './Lagoon';
import { WidgetInstaller } from './WidgetInstaller';
import { WalletAddress } from '../common/WalletAddress';
import { formatApiError } from '../../lib/apiError';

export function BungalowPage() {
  const { chain = 'base', ca = '' } = useParams();
  const { data, isLoading, isError, error } = useBungalow(chain, ca);
  const curate = useBungalowCurate(chain, ca);
  const isOwner = Boolean(data?.viewer_context?.is_owner);
  const { context: viewerCtx } = useViewerContext(data?.viewer_context);

  const onSaveDescription = useCallback(
    async (value: string) => { await curate.mutateAsync({ description: value }); },
    [curate],
  );
  const onSaveOriginStory = useCallback(
    async (value: string) => { await curate.mutateAsync({ origin_story: value }); },
    [curate],
  );
  const onSaveLinks = useCallback(
    async (links: Record<string, string | null>) => { await curate.mutateAsync(links); },
    [curate],
  );

  if (isLoading) return <LoadingSpinner label="Loading bungalow..." />;
  if (isError || !data?.bungalow) {
    return (
      <EmptyState
        title="Bungalow unavailable"
        description={formatApiError(error, 'Try again in a moment.')}
      />
    );
  }

  const { bungalow, viewer_context } = data;

  // If not claimed, show CTA
  if (!bungalow.claimed) {
    return (
      <div className="space-y-6 text-center py-12">
        {bungalow.image_url && (
          <img
            src={bungalow.image_url}
            alt={bungalow.token_name}
            className="mx-auto h-24 w-24 rounded-full border border-jungle-700"
          />
        )}
        <h2 className="text-xl font-bold text-zinc-100">
          {bungalow.token_name || 'This token'} hasn't been claimed yet
        </h2>
        <p className="text-sm text-zinc-400 max-w-md mx-auto">
          Be the first to claim this bungalow and create a homepage for this token's community.
        </p>
        <Link
          to={`/claim/${chain}/${ca}`}
          className="inline-block rounded-lg bg-jungle-600 px-6 py-3 text-sm font-medium text-white hover:bg-jungle-500"
        >
          Claim this Bungalow
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Owner + viewer context bar */}
      {viewer_context && (
        <section className="card flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-sm text-zinc-200">
            {isOwner && (
              <span className="inline-flex items-center gap-1 rounded-full border border-heat-resident/40 bg-heat-resident/15 px-2 py-0.5 text-xs text-heat-resident">
                You own this bungalow
              </span>
            )}
            {viewerCtx && viewerCtx.tier && (
              <HeatBadge heat={viewerCtx.token_heat_degrees ?? 0} tier={viewerCtx.tier!} />
            )}
          </div>
        </section>
      )}

      {/* Claimed by display */}
      {bungalow.owner_wallet && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>Claimed by</span>
          <WalletAddress address={bungalow.owner_wallet} />
        </div>
      )}

      <Threshold bungalow={bungalow} canEdit={isOwner} onSaveDescription={onSaveDescription} chain={chain} ca={ca} />
      <MarketData data={bungalow.market_data} />
      <BulletinBoard chain={chain} ca={ca} viewerContext={viewer_context} />
      <Hearth bungalow={bungalow} />
      <Wall bungalow={bungalow} canEdit={isOwner} onSaveOriginStory={onSaveOriginStory} />
      <Shelf links={bungalow.links} canEdit={isOwner} onSaveLinks={onSaveLinks} />
      <WidgetInstaller chain={chain} ca={ca} canInstall={isOwner} />

      {/* DMT Lagoon — only for Base tokens */}
      {chain === 'base' && bungalow.claimed && (
        <Lagoon chain={chain} ca={ca} isOwner={isOwner} />
      )}
    </div>
  );
}
