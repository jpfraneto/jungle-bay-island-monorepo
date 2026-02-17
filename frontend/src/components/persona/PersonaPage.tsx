import { Link, useParams } from "react-router-dom";
import { usePersona } from "../../hooks/usePersona";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { EmptyState } from "../common/EmptyState";
import { WalletAddress } from "../common/WalletAddress";
import { PersonaCard } from "./PersonaCard";
import { TokenBreakdown } from "./TokenBreakdown";

export function PersonaPage() {
  const { fid } = useParams();
  const { data, isLoading, isError } = usePersona(fid);

  if (isLoading) return <LoadingSpinner label="Loading persona..." />;
  if (isError || !data) {
    return (
      <EmptyState
        title="Persona unavailable"
        description="No island profile found for this FID."
      />
    );
  }

  return (
    <div className="space-y-5">
      <PersonaCard persona={data} />
      <div className="grid gap-5 lg:grid-cols-2">
        <TokenBreakdown tokens={data.token_breakdown} />
        <section className="card space-y-3">
          <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">
            Wallets
          </p>
          {data.wallets.map((wallet) => (
            <div
              key={wallet.wallet}
              className="flex items-center justify-between rounded-lg border border-jungle-700 px-3 py-2"
            >
              <WalletAddress address={wallet.wallet} />
              <span className="font-mono text-xs text-zinc-300">
                {wallet.heat_degrees !== undefined ? `${wallet.heat_degrees.toFixed(1)}°` : "--"}
              </span>
            </div>
          ))}
        </section>
      </div>
      <section className="card grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.16em] text-zinc-400">
            Scans
          </p>
          <div className="space-y-2 text-sm text-zinc-300">
            {data.scan_log.slice(0, 8).map((scan) => (
              <Link
                key={scan.id}
                to={`/${scan.chain}/${scan.ca}`}
                className="block rounded-md border border-jungle-700 px-3 py-2 font-mono text-xs hover:bg-jungle-800"
              >
                /{scan.chain}/{scan.ca}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.16em] text-zinc-400">
            Claimed Bungalows
          </p>
          <div className="space-y-2 text-sm text-zinc-300">
            {data.bungalows_claimed.length === 0 ? (
              <p className="text-zinc-500">None yet.</p>
            ) : (
              data.bungalows_claimed.map((bungalow) => (
                <Link
                  key={`${bungalow.chain}-${bungalow.ca}`}
                  to={`/${bungalow.chain}/${bungalow.ca}`}
                  className="block rounded-md border border-jungle-700 px-3 py-2 font-mono text-xs hover:bg-jungle-800"
                >
                  {bungalow.token_symbol} /{bungalow.chain}/{bungalow.ca}
                </Link>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
