import { useEffect, useMemo, useState } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom, isAddress } from 'viem';
import { base } from 'viem/chains';
import { useApi } from '../../hooks/useApi';
import { CLAIM_CONTRACT_ADDRESS } from '../../three/helpers/constants';
import { useIslandStore } from '../../store/island';

const CLAIM_ABI = [
  {
    name: 'claimBungalow',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenAddress', type: 'address' }],
    outputs: [],
  },
] as const;

function prettyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unknown claim error';
}

export function LagoonClaimPanel() {
  const [tokenAddress, setTokenAddress] = useState('');
  const [chain, setChain] = useState<'base' | 'ethereum'>('base');
  const [manualTxHash, setManualTxHash] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const showLagoonClaim = useIslandStore((state) => state.showLagoonClaim);
  const viewMode = useIslandStore((state) => state.viewMode);
  const setLagoonClaimOpen = useIslandStore((state) => state.setLagoonClaimOpen);

  const { walletAddress, post } = useApi();
  const { wallets } = useWallets();

  const primaryWallet = useMemo(
    () => wallets.find((wallet: { address?: string }) => Boolean(wallet.address)),
    [wallets],
  );

  useEffect(() => {
    if (viewMode !== 'island-overview' && showLagoonClaim) {
      setLagoonClaimOpen(false);
    }
  }, [setLagoonClaimOpen, showLagoonClaim, viewMode]);

  if (!showLagoonClaim || viewMode !== 'island-overview') return null;

  const syncClaimToBackend = async (txHash: `0x${string}`) => {
    const payload = await post<{
      bungalow: { chain: string; ca: string; claimed_by: string };
      scan: { status: string; scan_id?: number };
    }>('/api/bungalow/claim', {
      chain,
      ca: tokenAddress,
      txHash,
    });

    setStatus(
      payload.scan.status === 'scanning'
        ? `Claim synced. Heat scan started (id ${payload.scan.scan_id ?? '-'})`
        : `Claim synced. Scan status: ${payload.scan.status}`,
    );
  };

  return (
    <aside className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-emerald-300/20 bg-[#0a1f15] p-5 shadow-2xl">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-zinc-100">DMT Lagoon</h2>
            <p className="text-sm text-zinc-300">Claim a bungalow by token address.</p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-zinc-100"
            onClick={() => setLagoonClaimOpen(false)}
          >
            Close
          </button>
        </header>

        <div className="space-y-3">
          <label className="block text-sm text-zinc-200">
            Chain
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-zinc-100"
              value={chain}
              onChange={(event) => setChain(event.target.value as 'base' | 'ethereum')}
            >
              <option value="base">Base</option>
              <option value="ethereum">Ethereum</option>
            </select>
          </label>

          <label className="block text-sm text-zinc-200">
            Token Address
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-zinc-100"
              value={tokenAddress}
              onChange={(event) => setTokenAddress(event.target.value.trim())}
              placeholder="0x..."
            />
          </label>

          <div className="rounded-lg border border-cyan-200/20 bg-cyan-500/10 p-3 text-xs text-cyan-100 break-all">
            Contract: {CLAIM_CONTRACT_ADDRESS}
          </div>

          <button
            type="button"
            disabled={isSubmitting || !walletAddress || !isAddress(tokenAddress)}
            className="w-full rounded-lg bg-emerald-500/25 px-3 py-2 text-sm font-semibold text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={async () => {
              if (!walletAddress) {
                setStatus('Connect wallet first.');
                return;
              }

              if (!isAddress(tokenAddress)) {
                setStatus('Enter a valid token address.');
                return;
              }

              try {
                setIsSubmitting(true);
                setStatus('Waiting for claim transaction...');

                const provider =
                  (primaryWallet as { getEthereumProvider?: () => unknown } | undefined)?.getEthereumProvider?.() ??
                  (window as Window & { ethereum?: unknown }).ethereum;

                if (!provider) {
                  throw new Error('No EVM provider found for connected wallet');
                }

                const walletClient = createWalletClient({
                  chain: base,
                  transport: custom(provider as any),
                });

                const addresses = await walletClient.getAddresses();
                const account = addresses[0];

                if (!account) {
                  throw new Error('No active account available for claim');
                }

                const txHash = await walletClient.writeContract({
                  account,
                  chain: base,
                  address: CLAIM_CONTRACT_ADDRESS as `0x${string}`,
                  abi: CLAIM_ABI,
                  functionName: 'claimBungalow',
                  args: [tokenAddress as `0x${string}`],
                });

                setStatus('Claim tx submitted. Syncing backend...');
                await syncClaimToBackend(txHash);
              } catch (error) {
                setStatus(prettyError(error));
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            Claim Bungalow
          </button>

          <details className="rounded-xl border border-white/10 bg-black/20 p-3">
            <summary className="cursor-pointer text-xs text-zinc-300">Advanced: sync existing claim tx</summary>
            <input
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-zinc-100"
              value={manualTxHash}
              onChange={(event) => setManualTxHash(event.target.value.trim())}
              placeholder="0x..."
            />
            <button
              type="button"
              disabled={isSubmitting || !/^0x[0-9a-fA-F]{64}$/.test(manualTxHash) || !isAddress(tokenAddress)}
              className="mt-2 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={async () => {
                try {
                  setIsSubmitting(true);
                  setStatus('Syncing backend with existing tx...');
                  await syncClaimToBackend(manualTxHash as `0x${string}`);
                } catch (error) {
                  setStatus(prettyError(error));
                } finally {
                  setIsSubmitting(false);
                }
              }}
            >
              Sync Existing Claim Tx
            </button>
          </details>

          {status ? <p className="text-xs text-emerald-200">{status}</p> : null}
        </div>
      </div>
    </aside>
  );
}
