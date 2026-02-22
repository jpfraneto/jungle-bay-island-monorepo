import { useParams } from 'react-router-dom';
import { useClaimPrice } from '../hooks/useClaimPrice';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { formatApiError } from '../lib/apiError';
import { formatCompact, formatUsd } from '../lib/format';

const DM_URL = 'https://x.com/messages/compose?recipient_id=jpfraneto&text=';

export function ClaimPage() {
  const { chain = 'base', ca = '' } = useParams();

  const priceQuery = useClaimPrice(chain, ca);
  const tokenData = priceQuery.data;

  const dmText = encodeURIComponent(
    `I want to claim the bungalow for ${tokenData?.token_name ?? ca} on ${chain}.\n\nToken: ${ca}`,
  );

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-zinc-100">Claim This Bungalow</h1>
        <p className="text-sm text-zinc-400">
          The new home of your coin.
        </p>
      </div>

      {priceQuery.isLoading && (
        <LoadingSpinner label="Fetching token data..." />
      )}

      {priceQuery.isError && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/30 p-4">
          <p className="text-sm text-red-400">
            {formatApiError(priceQuery.error, 'Could not fetch token data. Check the address and try again.')}
          </p>
        </div>
      )}

      {tokenData && (
        <div className="space-y-6">
          {/* Token preview card */}
          <div className="rounded-lg border border-jungle-700 bg-jungle-900/40 p-5">
            <div className="flex items-start gap-4">
              {tokenData.image_url && (
                <img
                  src={tokenData.image_url}
                  alt={tokenData.token_name ?? ''}
                  className="h-16 w-16 rounded-full border border-jungle-700"
                />
              )}
              <div className="flex-1 space-y-1">
                <h3 className="text-lg font-semibold text-zinc-100">
                  {tokenData.token_name ?? 'Unknown Token'}
                </h3>
                <p className="font-mono text-sm text-zinc-400">
                  {tokenData.token_symbol ?? ''}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-jungle-700 p-3">
                <p className="text-xs text-zinc-500">Market Cap</p>
                <p className="mt-1 font-mono text-sm text-zinc-100">
                  {tokenData.market_cap ? formatCompact(tokenData.market_cap) : '--'}
                </p>
              </div>
              <div className="rounded-lg border border-jungle-700 p-3">
                <p className="text-xs text-zinc-500">Price</p>
                <p className="mt-1 font-mono text-sm text-zinc-100">
                  {tokenData.price_usd ? formatUsd(tokenData.price_usd) : '--'}
                </p>
              </div>
              <div className="rounded-lg border border-jungle-700 p-3">
                <p className="text-xs text-zinc-500">Liquidity</p>
                <p className="mt-1 font-mono text-sm text-zinc-100">
                  {tokenData.liquidity_usd ? formatCompact(tokenData.liquidity_usd) : '--'}
                </p>
              </div>
              <div className="rounded-lg border border-jungle-700 p-3">
                <p className="text-xs text-zinc-500">24h Volume</p>
                <p className="mt-1 font-mono text-sm text-zinc-100">
                  {tokenData.volume_24h ? formatCompact(tokenData.volume_24h) : '--'}
                </p>
              </div>
            </div>
          </div>

          {/* Claim CTA */}
          <div className="rounded-lg border border-jungle-600/50 bg-jungle-900/60 p-6 text-center space-y-4">
            <h2 className="text-xl font-bold text-zinc-100">
              Claim this bungalow
            </h2>
            <p className="text-sm text-zinc-400 max-w-md mx-auto">
              Be the first to create a homepage for this token's community. DM us on X to get started.
            </p>
            <a
              href={`${DM_URL}${dmText}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-lg bg-jungle-600 px-6 py-3 text-sm font-medium text-white hover:bg-jungle-500"
            >
              DM @jpfraneto on X to claim
            </a>
          </div>
        </div>
      )}

      {/* Fallback if no token data loaded yet and no error */}
      {!tokenData && !priceQuery.isLoading && !priceQuery.isError && (
        <div className="rounded-lg border border-jungle-600/50 bg-jungle-900/60 p-6 text-center space-y-4">
          <h2 className="text-xl font-bold text-zinc-100">
            Claim this bungalow
          </h2>
          <p className="text-sm text-zinc-400">
            The new home of your coin. DM us on X to get started.
          </p>
          <a
            href={`${DM_URL}${encodeURIComponent(`I want to claim the bungalow for ${ca} on ${chain}.`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg bg-jungle-600 px-6 py-3 text-sm font-medium text-white hover:bg-jungle-500"
          >
            DM @jpfraneto on X to claim
          </a>
        </div>
      )}
    </div>
  );
}
