import { useState } from "react";
import { useNavigate } from "react-router-dom";

function detectChain(address: string): "base" | "solana" {
  const trimmed = address.trim();
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) return "base";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) return "solana";
  return "base";
}

export function LandingPage() {
  const navigate = useNavigate();
  const [addressInput, setAddressInput] = useState("");

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
          A home for every coin. A story for every user.
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

    </div>
  );
}
