import { useState, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits, type Address } from 'viem';
import { V7_CONTRACT_ADDRESS, V7_ABI, ERC20_ABI } from '../../contract';

interface LagoonProps {
  chain: string;
  ca: string;
  isOwner: boolean;
}

type LagoonStep = 'idle' | 'approving' | 'depositing' | 'withdrawing' | 'done';

export function Lagoon({ chain, ca, isOwner }: LagoonProps) {
  const { address: userAddress } = useAccount();
  const tokenAddress = ca as Address;

  const [step, setStep] = useState<LagoonStep>('idle');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Read bungalow ID from V7 contract
  const { data: bungalowId } = useReadContract({
    address: V7_CONTRACT_ADDRESS,
    abi: V7_ABI,
    functionName: 'getBungalowIdByToken',
    args: [tokenAddress],
  });

  // Read lagoon balance for this bungalow's native token
  const { data: lagoonBalance, refetch: refetchBalance } = useReadContract({
    address: V7_CONTRACT_ADDRESS,
    abi: V7_ABI,
    functionName: 'getLagoonBalance',
    args: bungalowId ? [bungalowId, tokenAddress] : undefined,
    query: { enabled: !!bungalowId },
  });

  // Read token decimals
  const { data: tokenDecimals } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'decimals',
  });

  // Read token symbol
  const { data: tokenSymbol } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'symbol',
  });

  // Read user's token balance
  const { data: userBalance } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress },
  });

  // Read user's on-chain heat
  const { data: onChainHeat } = useReadContract({
    address: V7_CONTRACT_ADDRESS,
    abi: V7_ABI,
    functionName: 'getHeat',
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress },
  });

  // Write contract hooks
  const { writeContract: writeApprove, data: approveTxHash } = useWriteContract();
  const { writeContract: writeDeposit, data: depositTxHash } = useWriteContract();
  const { writeContract: writeWithdraw, data: withdrawTxHash } = useWriteContract();

  const { isLoading: isApproving } = useWaitForTransactionReceipt({
    hash: approveTxHash,
    query: {
      enabled: !!approveTxHash,
    },
  });

  const { isLoading: isDepositing } = useWaitForTransactionReceipt({
    hash: depositTxHash,
    query: {
      enabled: !!depositTxHash,
    },
  });

  const { isLoading: isWithdrawing } = useWaitForTransactionReceipt({
    hash: withdrawTxHash,
    query: {
      enabled: !!withdrawTxHash,
    },
  });

  const decimals = tokenDecimals ?? 18;
  const symbol = tokenSymbol ?? 'tokens';
  const formattedLagoonBalance = lagoonBalance != null ? formatUnits(lagoonBalance as bigint, decimals) : '0';
  const formattedUserBalance = userBalance != null ? formatUnits(userBalance as bigint, decimals) : '0';
  const formattedHeat = onChainHeat != null ? (onChainHeat as bigint).toString() : '0';

  const isNotOnChain = !bungalowId || bungalowId === 0n;

  const handleDeposit = useCallback(async () => {
    if (!amount || !bungalowId || !userAddress) return;
    setError(null);
    try {
      const parsedAmount = parseUnits(amount, decimals);

      // Step 1: Approve
      setStep('approving');
      writeApprove({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [V7_CONTRACT_ADDRESS, parsedAmount],
      }, {
        onSuccess: () => {
          // Step 2: Deposit
          setStep('depositing');
          writeDeposit({
            address: V7_CONTRACT_ADDRESS,
            abi: V7_ABI,
            functionName: 'depositToLagoon',
            args: [bungalowId, tokenAddress, parsedAmount],
          }, {
            onSuccess: () => {
              setStep('done');
              setAmount('');
              void refetchBalance();
              setTimeout(() => setStep('idle'), 2000);
            },
            onError: (err) => {
              setError(err.message.slice(0, 120));
              setStep('idle');
            },
          });
        },
        onError: (err) => {
          setError(err.message.slice(0, 120));
          setStep('idle');
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 120) : 'Deposit failed');
      setStep('idle');
    }
  }, [amount, bungalowId, userAddress, decimals, tokenAddress, writeApprove, writeDeposit, refetchBalance]);

  const handleWithdraw = useCallback(async () => {
    if (!amount || !bungalowId || !userAddress) return;
    setError(null);
    try {
      const parsedAmount = parseUnits(amount, decimals);
      setStep('withdrawing');
      writeWithdraw({
        address: V7_CONTRACT_ADDRESS,
        abi: V7_ABI,
        functionName: 'withdrawFromLagoon',
        args: [bungalowId, tokenAddress, parsedAmount, userAddress],
      }, {
        onSuccess: () => {
          setStep('done');
          setAmount('');
          void refetchBalance();
          setTimeout(() => setStep('idle'), 2000);
        },
        onError: (err) => {
          setError(err.message.slice(0, 120));
          setStep('idle');
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 120) : 'Withdraw failed');
      setStep('idle');
    }
  }, [amount, bungalowId, userAddress, decimals, tokenAddress, writeWithdraw, refetchBalance]);

  const busy = step !== 'idle' && step !== 'done';

  if (chain !== 'base') return null;

  return (
    <section className="card space-y-4">
      <div className="text-xs uppercase tracking-[0.18em] text-zinc-400">DMT Lagoon</div>

      {isNotOnChain ? (
        <p className="text-sm text-zinc-500">
          This bungalow is not yet registered on-chain. The lagoon becomes available after on-chain registration.
        </p>
      ) : (
        <>
          {/* Lagoon balance */}
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-lg border border-jungle-700 p-3">
              <p className="text-xs text-zinc-400">Lagoon Pool</p>
              <p className="mt-1 font-mono text-zinc-100">
                {Number(formattedLagoonBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}
              </p>
            </div>
            {userAddress && (
              <div className="rounded-lg border border-jungle-700 p-3">
                <p className="text-xs text-zinc-400">Your On-Chain Heat</p>
                <p className="mt-1 font-mono text-zinc-100">{formattedHeat}</p>
              </div>
            )}
          </div>

          {/* Deposit / Withdraw */}
          {userAddress && (
            <div className="space-y-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-zinc-400">
                    Amount ({symbol})
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.0"
                    disabled={busy}
                    className="w-full rounded-lg border border-jungle-700 bg-jungle-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-jungle-500 focus:outline-none disabled:opacity-50"
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Balance: {Number(formattedUserBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleDeposit}
                    disabled={busy || !amount}
                    className="rounded-lg bg-jungle-600 px-4 py-2 text-sm font-medium text-white hover:bg-jungle-500 disabled:opacity-40"
                  >
                    {step === 'approving' || isApproving ? 'Approving...' : step === 'depositing' || isDepositing ? 'Depositing...' : 'Deposit'}
                  </button>
                  {isOwner && (
                    <button
                      onClick={handleWithdraw}
                      disabled={busy || !amount}
                      className="rounded-lg border border-jungle-600 px-4 py-2 text-sm font-medium text-jungle-400 hover:bg-jungle-800 disabled:opacity-40"
                    >
                      {step === 'withdrawing' || isWithdrawing ? 'Withdrawing...' : 'Withdraw'}
                    </button>
                  )}
                </div>
              </div>

              {step === 'done' && (
                <p className="text-xs text-green-400">Transaction confirmed.</p>
              )}
              {error && (
                <p className="text-xs text-red-400">{error}</p>
              )}
            </div>
          )}

          {!userAddress && (
            <p className="text-sm text-zinc-500">
              Connect your wallet to deposit tokens into the lagoon.
            </p>
          )}
        </>
      )}
    </section>
  );
}
