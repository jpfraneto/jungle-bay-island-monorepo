import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useBungalows } from "../hooks/useBungalows";
import { useFeed } from "../hooks/useFeed";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import { ActivityFeed } from "../components/common/ActivityFeed";
import { truncateAddress } from "../lib/format";

function detectChain(address: string): "base" | "solana" {
  const trimmed = address.trim();
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) return "base";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) return "solana";
  return "base";
}

export function LandingPage() {
  const navigate = useNavigate();
  const [addressInput, setAddressInput] = useState("");
  const { data: bungalowData } = useBungalows(50, 0);
  const { data: feedData, isLoading: feedLoading } = useFeed(15);

  const bungalows = bungalowData?.items ?? [];
  const claimedBungalows = bungalows.filter((b) => b.claimed);
  const feedPosts = feedData?.posts ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ca = addressInput.trim();
    if (ca.length < 6) return;
    const chain = detectChain(ca);
    navigate(`/claim/${chain}/${ca}`);
  };

  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="space-y-6 py-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-100 sm:text-5xl">
          Memetics
        </h1>
        <p className="mx-auto max-w-lg text-lg text-zinc-400">
          Like Linktree, but for tokens. Claim a homepage for any token — curate
          it, let the community gather around it.
        </p>

        {/* CA Input */}
        <form onSubmit={handleSubmit} className="mx-auto max-w-xl">
          <div className="flex gap-2">
            <input
              type="text"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="Paste a token contract address..."
              className="flex-1 rounded-lg border border-jungle-700 bg-jungle-950/80 px-4 py-3 font-mono text-sm text-zinc-100 placeholder-zinc-500 focus:border-jungle-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={addressInput.trim().length < 6}
              className="rounded-lg bg-jungle-600 px-6 py-3 text-sm font-semibold text-white shadow-lg hover:bg-jungle-500 transition disabled:opacity-40"
            >
              Claim
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Works with Base (0x...) and Solana addresses
          </p>
        </form>
      </section>

      {/* Activity Feed */}
      <section className="space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">
            Recent Bungalow Activity
          </h2>
          {feedData && (
            <span className="text-xs text-zinc-500">
              {feedData.total} post{feedData.total !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {feedLoading && <LoadingSpinner label="Loading activity..." />}

        {!feedLoading && feedPosts.length === 0 && (
          <div className="rounded-lg border border-jungle-700 bg-jungle-900/40 p-8 text-center">
            <p className="text-sm text-zinc-400">
              No activity yet. Claim a bungalow and start posting!
            </p>
          </div>
        )}

        {feedPosts.length > 0 && (
          <ActivityFeed posts={feedPosts} showBungalowLink />
        )}
      </section>

      {/* Claimed Bungalows directory */}
      {claimedBungalows.length > 0 && (
        <section className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-100">
              Claimed Bungalows
            </h2>
            <span className="text-xs text-zinc-500">
              {claimedBungalows.length} claimed
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {claimedBungalows.map((item) => (
              <Link
                key={`${item.chain}:${item.ca}`}
                to={`/${item.chain}/${item.ca}`}
                className="group rounded-lg border border-jungle-700 bg-jungle-900/40 p-4 transition hover:border-jungle-500 hover:bg-jungle-900/60"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-jungle-600 bg-jungle-800 text-sm font-bold text-jungle-300">
                    {(item.token_symbol || "?").slice(0, 3)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100 group-hover:text-jungle-300">
                      {item.token_name}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {item.token_symbol} on {item.chain}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                  <span className="font-mono">{truncateAddress(item.ca)}</span>
                  {item.holder_count !== undefined && (
                    <span>{item.holder_count} holders</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
