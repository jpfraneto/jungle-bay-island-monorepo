import { Link } from 'react-router-dom';
import type { PersonaToken } from '../../lib/types';
import { formatHeat } from '../../lib/format';

export function TokenBreakdown({ tokens }: { tokens: PersonaToken[] }) {
  const total = tokens.reduce((sum, row) => sum + row.heat_degrees, 0);

  return (
    <section className="card space-y-3">
      <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">Token Breakdown</p>
      <div className="space-y-2">
        {tokens.map((token) => {
          const width = total ? (token.heat_degrees / total) * 100 : 0;
          return (
            <Link
              key={`${token.chain}-${token.ca}`}
              to={`/${token.chain}/${token.ca}`}
              className="block rounded-lg border border-jungle-700 px-3 py-2 hover:bg-jungle-800"
            >
              <div className="mb-1 flex items-center justify-between text-sm">
                <span>
                  {token.token_name} <span className="font-mono text-zinc-400">${token.token_symbol}</span>
                </span>
                <span className="font-mono">{formatHeat(token.heat_degrees)}</span>
              </div>
              <div className="h-2 rounded bg-jungle-800">
                <div className="h-full rounded bg-gradient-to-r from-heat-observer to-heat-elder" style={{ width: `${width}%` }} />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
