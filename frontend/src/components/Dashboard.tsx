"use client";

import { FC } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useBalances, formatBalance } from "../hooks/useBalances";
import { useCommitment, formatCommitment, canReveal, getTimeUntilReveal } from "../hooks/useCommitment";
import { useStakePool } from "../hooks/useStakePool";
import { useCommitReveal } from "../hooks/useCommitReveal";
import { MIN_DELAY_SECONDS } from "../lib/constants";
import ErrorDisplay from "./ErrorDisplay";

export const Dashboard: FC = () => {
  const { connected } = useWallet();
  const { 
    solBalance, 
    slpSolBalance, 
    isLoading: balancesLoading, 
    isRefreshing: balancesRefreshing,
    error: balancesError,
    refetch: refreshBalances
  } = useBalances();
  const { 
    commitment, 
    exists: hasCommitment, 
    isLoading: commitmentLoading,
    error: commitmentError,
    refetch: refreshCommitment
  } = useCommitment();
  const { 
    poolConfig, 
    exchangeRate, 
    totalStakedSol, 
    reserveSol, 
    apy, 
    loading: poolLoading,
    isRefreshing: poolRefreshing,
    error: poolError,
    refresh: refreshPoolConfig
  } = useStakePool();
  const { cancelCommitment, phase } = useCommitReveal();

  // Calculate expected rewards based on stake
  const calculateRewards = (balance: number, apyPercent: number) => ({
    dailyReward: balance * (apyPercent / 100) / 365,
    monthlyReward: balance * (apyPercent / 100) / 12,
    yearlyReward: balance * (apyPercent / 100),
  });

  const rewards = calculateRewards(slpSolBalance * exchangeRate, apy);

  if (!connected) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
          <svg className="w-8 h-8 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-zinc-300 mb-2">Connect Your Wallet</h3>
        <p className="text-zinc-500">Connect your wallet to view your balances and staking positions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Error Displays */}
      {poolError && (
        <ErrorDisplay
          error={poolError}
          onRetry={refreshPoolConfig}
          title="Failed to load pool data"
        />
      )}
      {balancesError && (
        <ErrorDisplay
          error={balancesError}
          onRetry={refreshBalances}
          title="Failed to load balances"
        />
      )}
      {commitmentError && (
        <ErrorDisplay
          error={commitmentError}
          onRetry={refreshCommitment}
          title="Failed to load commitment"
        />
      )}

      {/* Pool Status Banner */}
      {!poolConfig && !poolLoading && !poolError && (
        <div className="bg-amber-500/10 rounded-2xl p-4 border border-amber-500/30">
          <p className="text-amber-400 text-sm">
            ⚠️ Stake pool not initialized. Deploy the programs first.
          </p>
        </div>
      )}

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* SOL Balance */}
        <div className="bg-zinc-800/50 rounded-2xl p-6 border border-zinc-700/50">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <span className="text-lg font-bold">◎</span>
            </div>
            <div className="relative">
              {balancesRefreshing && !balancesLoading && (
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
              )}
              <h3 className="text-zinc-400 text-sm">Available SOL</h3>
              {balancesLoading ? (
                <div className="h-7 w-24 bg-zinc-700 rounded animate-pulse" />
              ) : (
                <p className="text-2xl font-bold text-white">{formatBalance(solBalance)}</p>
              )}
            </div>
          </div>
          <p className="text-zinc-500 text-sm">Available for staking</p>
        </div>

        {/* secuSOL Balance */}
        <div className="bg-zinc-800/50 rounded-2xl p-6 border border-zinc-700/50">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <span className="text-lg font-bold">S</span>
            </div>
            <div className="relative">
              {balancesRefreshing && !balancesLoading && (
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
              )}
              <h3 className="text-zinc-400 text-sm">Staked secuSOL</h3>
              {balancesLoading ? (
                <div className="h-7 w-24 bg-zinc-700 rounded animate-pulse" />
              ) : (
                <p className="text-2xl font-bold text-white">{formatBalance(slpSolBalance)}</p>
              )}
            </div>
          </div>
          <p className="text-zinc-500 text-sm">
            ≈ {formatBalance(slpSolBalance * exchangeRate)} SOL value
          </p>
        </div>
      </div>

      {/* Pool Stats */}
      <div className="bg-zinc-800/50 rounded-2xl p-6 border border-zinc-700/50 relative">
        {poolRefreshing && !poolLoading && (
          <div className="absolute top-4 right-4">
            <div className="w-2 h-2 bg-violet-400 rounded-full animate-pulse"></div>
          </div>
        )}
        <h3 className="text-lg font-semibold text-white mb-4">Pool Statistics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Total Staked</p>
            {poolLoading ? (
              <div className="h-6 w-20 bg-zinc-700 rounded animate-pulse" />
            ) : (
              <p className="text-white font-semibold">{formatBalance(totalStakedSol)} SOL</p>
            )}
          </div>
          <div>
            <p className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Reserve</p>
            {poolLoading ? (
              <div className="h-6 w-20 bg-zinc-700 rounded animate-pulse" />
            ) : (
              <p className="text-white font-semibold">{formatBalance(reserveSol)} SOL</p>
            )}
          </div>
          <div>
            <p className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Exchange Rate</p>
            {poolLoading ? (
              <div className="h-6 w-20 bg-zinc-700 rounded animate-pulse" />
            ) : (
              <p className="text-white font-semibold">1 secuSOL = {exchangeRate.toFixed(4)} SOL</p>
            )}
          </div>
          <div>
            <p className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Est. APY</p>
            <p className="text-emerald-400 font-semibold">{apy.toFixed(1)}%</p>
          </div>
        </div>
      </div>

      {/* APY Card */}
      <div className="bg-gradient-to-r from-violet-500/10 to-indigo-500/10 rounded-2xl p-6 border border-violet-500/20">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Estimated APY</h3>
          <span className="text-3xl font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
            {apy.toFixed(1)}%
          </span>
        </div>
        
        {slpSolBalance > 0 && (
          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-zinc-700/50">
            <div>
              <p className="text-zinc-500 text-xs uppercase tracking-wider">Daily</p>
              <p className="text-emerald-400 font-semibold">
                +{formatBalance(rewards.dailyReward, 6)} SOL
              </p>
            </div>
            <div>
              <p className="text-zinc-500 text-xs uppercase tracking-wider">Monthly</p>
              <p className="text-emerald-400 font-semibold">
                +{formatBalance(rewards.monthlyReward, 4)} SOL
              </p>
            </div>
            <div>
              <p className="text-zinc-500 text-xs uppercase tracking-wider">Yearly</p>
              <p className="text-emerald-400 font-semibold">
                +{formatBalance(rewards.yearlyReward, 2)} SOL
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Pending Commitment */}
      {hasCommitment && commitment && (
        <div className="bg-amber-500/10 rounded-2xl p-6 border border-amber-500/30">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-amber-400 mb-1">Pending Commitment</h3>
              <p className="text-zinc-400 text-sm mb-4">
                You have a pending {commitment.isStake ? "stake" : "unstake"} commitment.
              </p>
              
              <div className="space-y-2 text-sm">
                <div className="flex gap-2">
                  <span className="text-zinc-500">Amount:</span>
                  <span className="text-white font-medium">
                    {(Number(commitment.amountLamports) / 1e9).toFixed(4)} {commitment.isStake ? "SOL" : "secuSOL"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-zinc-500">Type:</span>
                  <span className={commitment.isStake ? "text-emerald-400" : "text-orange-400"}>
                    {commitment.isStake ? "Stake (SOL → secuSOL)" : "Unstake (secuSOL → SOL)"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-zinc-500">Status:</span>
                  <span className={canReveal(commitment, MIN_DELAY_SECONDS) ? "text-emerald-400" : "text-amber-400"}>
                    {canReveal(commitment, MIN_DELAY_SECONDS) 
                      ? "Ready to reveal" 
                      : `Wait ${getTimeUntilReveal(commitment, MIN_DELAY_SECONDS)}s`}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={cancelCommitment}
              disabled={phase !== "idle"}
              className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Info Card */}
      <div className="bg-zinc-800/30 rounded-2xl p-6 border border-zinc-700/30">
        <h3 className="text-lg font-semibold text-white mb-3">How It Works</h3>
        <div className="space-y-3 text-sm text-zinc-400">
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
            <p><strong className="text-white">Commit:</strong> Your swap intent is hidden from MEV bots using a hash commitment.</p>
          </div>
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
            <p><strong className="text-white">Reveal:</strong> After a short delay, execute the stake/unstake with MEV protection.</p>
          </div>
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
            <p><strong className="text-white">Earn:</strong> secuSOL earns ~{apy.toFixed(1)}% APY from Solana validator staking rewards.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
