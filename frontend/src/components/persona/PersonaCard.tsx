import type { PersonaResponse } from '../../lib/types';
import { HeatBadge } from '../common/HeatBadge';

export function PersonaCard({ persona }: { persona: PersonaResponse }) {
  return (
    <section className="card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <img
          src={persona.profile.pfp_url || 'https://placehold.co/72x72/0d2118/ffffff?text=FC'}
          alt={persona.profile.username}
          className="h-14 w-14 rounded-full border border-jungle-700"
        />
        <div>
          <p className="font-display text-2xl">{persona.profile.display_name || persona.profile.username}</p>
          <p className="text-sm text-zinc-400">@{persona.profile.username}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <HeatBadge heat={persona.island_heat} tier={persona.tier} />
        <span className="rounded-full border border-jungle-700 px-3 py-1 font-mono text-xs text-zinc-300">
          Wallets: {persona.wallet_count}
        </span>
      </div>
    </section>
  );
}
