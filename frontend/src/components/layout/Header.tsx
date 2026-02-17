import { useMemo } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Palmtree, House } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Home', icon: House },
];

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-jungle-700/60 bg-jungle-950/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 md:px-6">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-semibold text-zinc-100">
          <Palmtree className="h-5 w-5 text-heat-observer" />
          Jungle Bay Island
        </Link>
        <nav className="hidden items-center gap-2 md:flex">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                `inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  isActive ? 'bg-jungle-700 text-zinc-100' : 'text-zinc-300 hover:bg-jungle-800'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <WalletConnectButton />
      </div>
    </header>
  );
}

export function WalletConnectButton() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();

  const primaryWallet = useMemo(
    () => wallets.find((wallet: { address?: string }) => !!wallet.address),
    [wallets],
  );

  if (authenticated) {
    return (
      <button
        type="button"
        onClick={logout}
        className="rounded-lg border border-jungle-600 px-3 py-2 text-sm text-zinc-100 hover:bg-jungle-800"
      >
        {primaryWallet?.address ? shortAddress(primaryWallet.address) : 'Disconnect'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={login}
      disabled={!ready}
      className="rounded-lg bg-heat-observer px-3 py-2 text-sm font-medium text-jungle-950 disabled:opacity-60"
    >
      Sign in with X
    </button>
  );
}
