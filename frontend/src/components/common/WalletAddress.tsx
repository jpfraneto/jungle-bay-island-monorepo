import { Copy } from 'lucide-react';
import { truncateAddress } from '../../lib/format';

export function WalletAddress({ address }: { address: string }) {
  const copy = async () => {
    await navigator.clipboard.writeText(address);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 rounded-md border border-jungle-700 px-2 py-1 font-mono text-xs text-zinc-300 hover:bg-jungle-800"
      title={address}
    >
      <span>{truncateAddress(address)}</span>
      <Copy className="h-3 w-3" />
    </button>
  );
}
