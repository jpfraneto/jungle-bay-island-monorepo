import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useReadContract } from 'wagmi';
import { parseUnits, type Address } from 'viem';
import { useClaimPrice } from '../hooks/useClaimPrice';
import { useClaimEligibility } from '../hooks/useClaimEligibility';
import { useApi } from '../hooks/useApi';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { formatApiError } from '../lib/apiError';
import { formatCompact, formatUsd, formatHeat } from '../lib/format';
import { V7_CONTRACT_ADDRESS, V7_ABI, ERC20_ABI } from '../contract';

const USDC_BASE: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TREASURY: Address = '0xe91B8920Ef5DBf6e1289991F1CE4eeF3671A610E';

type ClaimStep = 'idle' | 'paying' | 'verifying' | 'registering' | 'done';

export function ClaimPage() {
  const { chain = 'base', ca = '' } = useParams();
  const navigate = useNavigate();
  const { authenticated, login } = usePrivy();
  const { wallets: privyWallets } = useWallets();
  const { address: walletAddress } = useAccount();
  const api = useApi();

  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimStep, setClaimStep] = useState<ClaimStep>('idle');

  const priceQuery = useClaimPrice(chain, ca);
  const tokenData = priceQuery.data;

  // Check eligibility (heat score) when authenticated
  const eligibility = useClaimEligibility(chain, ca);
  const isEligible = eligibility.data?.eligible ?? false;
  const userHeat = eligibility.data?.heat ?? 0;
  const minimumHeat = eligibility.data?.minimum_heat ?? 10;
  const farcaster = eligibility.data?.farcaster;
  const walletsChecked = eligibility.data?.wallets_checked ?? 0;
  const scanPending = eligibility.data?.scan_pending ?? false;

  // Read user's USDC balance
  const { data: usdcBalance } = useReadContract({
    address: USDC_BASE,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!walletAddress && chain === 'base' },
  });

  // USDC transfer to treasury
  const {
    writeContract: writeTransfer,
    data: transferTxHash,
    error: transferError,
  } = useWriteContract();

  const { isSuccess: transferConfirmed } = useWaitForTransactionReceipt({
    hash: transferTxHash,
  });

  // V7 on-chain registration
  const {
    writeContract: writeV7,
    data: v7TxHash,
  } = useWriteContract();

  useWaitForTransactionReceipt({
    hash: v7TxHash,
  });

  // After USDC transfer confirms, verify on backend and claim
  useEffect(() => {
    if (!transferConfirmed || !transferTxHash || claimStep !== 'paying') return;
    void verifyClaim(transferTxHash);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transferConfirmed, transferTxHash, claimStep]);

  // Show transfer errors
  useEffect(() => {
    if (transferError) {
      setClaimError(transferError.message.slice(0, 150));
      setClaimStep('idle');
    }
  }, [transferError]);

  const verifyClaim = useCallback(async (txHash: string) => {
    setClaimStep('verifying');
    try {
      const result = await api.post<{
        bungalow: { chain: string; ca: string };
        bayla?: { signature: string; deadline: string; mode: string };
      }>('/api/bungalow/claim', {
        chain,
        ca,
        tx_hash: txHash,
      });

      // If Bayla signature returned and Base chain, register on V7 contract
      if (result.bayla?.mode === 'live' && result.bayla.signature && chain === 'base') {
        setClaimStep('registering');
        writeV7({
          address: V7_CONTRACT_ADDRESS,
          abi: V7_ABI,
          functionName: 'claimBungalow',
          args: [
            ca as `0x${string}`,
            '',
            (tokenData?.token_name ?? 'Bungalow').slice(0, 64),
            0n,
            0n,
            txHash,
            result.bayla.signature as `0x${string}`,
            BigInt(result.bayla.deadline),
          ],
        });
      }

      setClaimStep('done');
      setTimeout(() => navigate(`/${chain}/${ca}`), 1500);
    } catch (err) {
      setClaimError(formatApiError(err, 'Verification failed. Your payment was sent — contact support.'));
      setClaimStep('idle');
    }
  }, [api, chain, ca, tokenData, navigate, writeV7]);

  const usdcBalanceValue = usdcBalance != null ? Number(usdcBalance) / 1e6 : null;
  const formattedUsdcBalance = usdcBalanceValue != null ? usdcBalanceValue.toFixed(2) : null;
  const connectedWalletSet = new Set(
    privyWallets
      .map((entry) => entry.address?.toLowerCase())
      .filter((address): address is string => Boolean(address)),
  );
  const isPrivyWalletConnected = walletAddress ? connectedWalletSet.has(walletAddress.toLowerCase()) : false;
  const hasEnoughUsdc = tokenData ? (usdcBalanceValue ?? 0) >= tokenData.price_usdc : false;
  const busy = claimStep !== 'idle' && claimStep !== 'done';
  const canSubmitPayment = Boolean(
    isEligible &&
    !scanPending &&
    walletAddress &&
    isPrivyWalletConnected &&
    hasEnoughUsdc &&
    !busy &&
    claimStep !== 'done',
  );

  const handlePayDirect = useCallback(() => {
    if (!tokenData || !walletAddress) return;
    if (!isPrivyWalletConnected) {
      setClaimError('Use a Privy-connected Base wallet to complete this claim payment.');
      return;
    }
    if ((usdcBalanceValue ?? 0) < tokenData.price_usdc) {
      setClaimError('Insufficient USDC balance on your connected Base wallet.');
      return;
    }
    setClaimError(null);
    setClaimStep('paying');

    const amount = parseUnits(tokenData.price_usdc.toFixed(2), 6);
    writeTransfer({
      address: USDC_BASE,
      abi: [{
        inputs: [
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        name: 'transfer',
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'nonpayable',
        type: 'function',
      }],
      functionName: 'transfer',
      args: [TREASURY, amount],
    });
  }, [tokenData, walletAddress, isPrivyWalletConnected, usdcBalanceValue, writeTransfer]);

  const stepLabel: Record<ClaimStep, string> = {
    idle: '',
    paying: 'Confirm the USDC transfer in your wallet...',
    verifying: 'Verifying payment...',
    registering: 'Registering on-chain...',
    done: 'Bungalow claimed!',
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-zinc-100">Claim a Bungalow</h1>
        <p className="text-sm text-zinc-400">
          You need to hold this token to claim its homepage.
        </p>
        {ca.length > 5 && (
          <p className="text-xs text-zinc-500">
            Chain: <span className="text-zinc-300 capitalize">{chain}</span> &middot; Token: <span className="font-mono text-zinc-300">{ca.slice(0, 10)}...{ca.slice(-6)}</span>
          </p>
        )}
      </div>

      {/* Loading state */}
      {priceQuery.isLoading && (
        <LoadingSpinner label="Fetching token data..." />
      )}

      {/* Error from price endpoint */}
      {priceQuery.isError && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/30 p-4">
          <p className="text-sm text-red-400">
            {formatApiError(priceQuery.error, 'Could not fetch token data. Check the address and try again.')}
          </p>
        </div>
      )}

      {/* Token preview + payment */}
      {tokenData && (
        <div className="space-y-6">
          {/* Token preview card */}
          <div className="rounded-lg border border-jungle-700 bg-jungle-900/40 p-5">
            <div className="flex items-start gap-4">
              {tokenData.image_url && (
                <img
                  src={tokenData.image_url}
                  alt={tokenData.token_name ?? ''}
                  className="h-16 w-16 rounded-full border border-jungle-700"
                />
              )}
              <div className="flex-1 space-y-1">
                <h3 className="text-lg font-semibold text-zinc-100">
                  {tokenData.token_name ?? 'Unknown Token'}
                </h3>
                <p className="font-mono text-sm text-zinc-400">
                  {tokenData.token_symbol ?? ''}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-jungle-700 p-3">
                <p className="text-xs text-zinc-500">Market Cap</p>
                <p className="mt-1 font-mono text-sm text-zinc-100">
                  {tokenData.market_cap ? formatCompact(tokenData.market_cap) : '--'}
                </p>
              </div>
              <div className="rounded-lg border border-jungle-700 p-3">
                <p className="text-xs text-zinc-500">Price</p>
                <p className="mt-1 font-mono text-sm text-zinc-100">
                  {tokenData.price_usd ? formatUsd(tokenData.price_usd) : '--'}
                </p>
              </div>
              <div className="rounded-lg border border-jungle-700 p-3">
                <p className="text-xs text-zinc-500">Liquidity</p>
                <p className="mt-1 font-mono text-sm text-zinc-100">
                  {tokenData.liquidity_usd ? formatCompact(tokenData.liquidity_usd) : '--'}
                </p>
              </div>
              <div className="rounded-lg border border-jungle-700 p-3">
                <p className="text-xs text-zinc-500">24h Volume</p>
                <p className="mt-1 font-mono text-sm text-zinc-100">
                  {tokenData.volume_24h ? formatCompact(tokenData.volume_24h) : '--'}
                </p>
              </div>
            </div>
          </div>

          {/* Auth gate */}
          {!authenticated ? (
            <div className="rounded-lg border border-jungle-600/50 bg-jungle-900/60 p-5 text-center space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-400">Step 1</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">
                  Sign in to check your eligibility
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  We'll check your token holdings across all your verified wallets
                </p>
              </div>
              <button
                type="button"
                onClick={login}
                className="mx-auto rounded-lg bg-jungle-600 px-6 py-3 text-sm font-medium text-white hover:bg-jungle-500"
              >
                Sign in with X
              </button>
            </div>
          ) : (
            <>
              {/* Eligibility check */}
              <div className="rounded-lg border border-jungle-700 bg-jungle-900/40 p-5 space-y-4">
                <div className="text-xs uppercase tracking-wider text-zinc-400">Your Eligibility</div>

                {eligibility.isLoading && (
                  <LoadingSpinner label="Checking your token holdings..." />
                )}

                {eligibility.isError && (
                  <p className="text-sm text-red-400">
                    {formatApiError(eligibility.error, 'Could not check eligibility.')}
                  </p>
                )}

                {eligibility.data && (
                  <div className="space-y-3">
                    {scanPending ? (
                      <div className="rounded-lg border border-jungle-700/80 bg-jungle-950/40 p-4 space-y-2">
                        <p className="text-sm text-jungle-300">
                          Running token heat scan for this bungalow...
                        </p>
                        <p className="text-xs text-zinc-500">
                          We scan once, cache it, and reuse results to keep RPC credit usage low.
                        </p>
                        {eligibility.data.scan_id && (
                          <p className="text-xs font-mono text-zinc-500">
                            Scan ID: {eligibility.data.scan_id}
                          </p>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* Farcaster status */}
                        {farcaster ? (
                          <div className="flex items-center gap-3">
                            <img
                              src={farcaster.pfp_url}
                              alt={farcaster.username}
                              className="h-10 w-10 rounded-full border border-jungle-600"
                            />
                            <div>
                              <p className="text-sm font-medium text-zinc-100">
                                @{farcaster.username}
                              </p>
                              <p className="text-xs text-zinc-500">
                                {farcaster.wallets_found} verified wallets found via Farcaster
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-3">
                            <p className="text-xs text-amber-400">
                              No Farcaster account linked to your X. We can only check your embedded wallet.
                              Link your X on Farcaster to include all connected wallets.
                            </p>
                          </div>
                        )}

                        {/* Heat score */}
                        <div className="grid grid-cols-3 gap-3">
                          <div className="rounded-lg border border-jungle-700 p-3 text-center">
                            <p className="text-xs text-zinc-500">Your Heat</p>
                            <p className={`mt-1 font-mono text-lg font-bold ${
                              isEligible ? 'text-green-400' : 'text-red-400'
                            }`}>
                              {formatHeat(userHeat)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-jungle-700 p-3 text-center">
                            <p className="text-xs text-zinc-500">Required</p>
                            <p className="mt-1 font-mono text-lg font-bold text-zinc-300">
                              {formatHeat(minimumHeat)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-jungle-700 p-3 text-center">
                            <p className="text-xs text-zinc-500">Wallets Checked</p>
                            <p className="mt-1 font-mono text-lg font-bold text-zinc-300">
                              {walletsChecked}
                            </p>
                          </div>
                        </div>

                        {isEligible ? (
                          <p className="text-sm text-green-400 text-center">
                            You're eligible to claim this bungalow
                          </p>
                        ) : (
                          <div className="text-center space-y-2">
                            <p className="text-sm text-red-400">
                              You need at least {formatHeat(minimumHeat)} heat to claim. Hold more of this token to increase your heat score.
                            </p>
                            {!farcaster && (
                              <p className="text-xs text-zinc-500">
                                Tip: Link your X to Farcaster to include all your verified wallets in the heat calculation.
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Payment section — only if eligible */}
              {isEligible && tokenData && !scanPending && (
                <div className="rounded-lg border border-jungle-600/50 bg-jungle-900/60 p-5 text-center space-y-4">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-zinc-400">Claim Price</p>
                    <p className="mt-1 text-3xl font-bold text-jungle-300">
                      ${tokenData.price_usdc.toFixed(2)} <span className="text-base text-zinc-400">USDC</span>
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      0.1% of market cap (min $1, max $1,000)
                    </p>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs text-zinc-500">
                      Payment must be sent from your connected Privy Base wallet.
                    </p>
                    {walletAddress && formattedUsdcBalance !== null && (
                      <p className="text-xs text-zinc-500">
                        Your USDC balance: <span className="font-mono text-zinc-300">${formattedUsdcBalance}</span>
                      </p>
                    )}
                    {walletAddress && !isPrivyWalletConnected && (
                      <p className="text-xs text-amber-400">
                        Current wallet is not linked in Privy. Switch to a connected wallet to continue.
                      </p>
                    )}
                    {walletAddress && formattedUsdcBalance !== null && !hasEnoughUsdc && (
                      <p className="text-xs text-amber-400">
                        Insufficient USDC. Send USDC on Base to your wallet: <span className="font-mono">{walletAddress}</span>
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handlePayDirect}
                      disabled={!canSubmitPayment}
                      className="mx-auto rounded-lg bg-jungle-600 px-6 py-3 text-sm font-medium text-white hover:bg-jungle-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {claimStep === 'done' ? 'Claimed!' : `Pay $${tokenData.price_usdc.toFixed(2)} USDC`}
                    </button>
                  </div>

                  {busy && (
                    <LoadingSpinner label={stepLabel[claimStep]} />
                  )}

                  {claimStep === 'done' && (
                    <p className="text-sm text-green-400">Redirecting to your bungalow...</p>
                  )}

                  {claimError && (
                    <p className="text-sm text-red-400">{claimError}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
