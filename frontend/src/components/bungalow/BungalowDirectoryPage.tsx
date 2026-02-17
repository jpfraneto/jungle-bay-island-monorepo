import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBungalows } from '../../hooks/useBungalows';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { EmptyState } from '../common/EmptyState';
import { formatNumber } from '../../lib/format';

function isContractAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function BungalowDirectoryPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useBungalows();
  const [contractInput, setContractInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const submitContract = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = contractInput.trim().toLowerCase();
    if (!isContractAddress(value)) {
      setInputError('Enter a valid 0x contract address.');
      return;
    }

    setInputError(null);
    navigate(`/base/${value}`);
  };

  if (isLoading) return <LoadingSpinner label="Loading bungalow directory..." />;
  if (isError || !data) {
    return <EmptyState title="Directory unavailable" description="Unable to load bungalows right now." />;
  }

  return (
    <div className="space-y-5">
      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl">Bungalow Directory</h1>
            <p className="text-sm text-zinc-400">
              Paste a contract to jump into its bungalow. If it is not scanned yet, the token page will guide scan access based on your heat.
            </p>
          </div>
          <span className="rounded-full border border-jungle-700 px-3 py-1 font-mono text-xs text-zinc-300">
            {formatNumber(data.total)} listed
          </span>
        </div>
        <form onSubmit={submitContract} className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={contractInput}
              onChange={(event) => setContractInput(event.target.value)}
              placeholder="0x... paste token contract"
              className="w-full rounded-lg border border-jungle-700 bg-jungle-900/80 px-3 py-2 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-heat-observer/60"
            />
            <button
              type="submit"
              className="rounded-lg bg-heat-observer px-4 py-2 text-sm font-medium text-jungle-950 transition hover:brightness-110"
            >
              Open Bungalow
            </button>
          </div>
          {inputError && <p className="text-xs text-heat-elder">{inputError}</p>}
        </form>
      </section>

      {data.items.length === 0 ? (
        <EmptyState title="No bungalows yet" description="There are no scanned bungalows available yet." />
      ) : (
        <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {data.items.map((item) => (
            <Link
              key={`${item.chain}-${item.ca}`}
              to={`/${item.chain}/${item.ca}`}
              className="card space-y-2 p-4 transition hover:border-heat-observer/40 hover:bg-jungle-800/40"
            >
              <p className="font-display text-lg text-zinc-100">{item.token_name}</p>
              <p className="font-mono text-sm text-zinc-300">${item.token_symbol}</p>
              <p className="font-mono text-xs text-zinc-500">/{item.chain}/{item.ca}</p>
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Holders: {formatNumber(item.holder_count)}</span>
                <span>{item.claimed ? 'Claimed' : 'Unclaimed'}</span>
              </div>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
