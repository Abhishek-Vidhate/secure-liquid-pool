"use client";

import { FC } from "react";
import { useStakePool } from "../hooks/useStakePool";

interface PoolStatsProps {
  compact?: boolean;
}

export const PoolStats: FC<PoolStatsProps> = ({ compact = false }) => {
  const { 
    totalStakedSol, 
    reserveSol, 
    exchangeRate, 
    apy, 
    totalSlpSupply,
    loading 
  } = useStakePool();

  if (loading) {
    return (
      <div className="bg-zinc-800/30 border border-zinc-700/30 rounded-xl p-4 animate-pulse">
        <div className="h-4 bg-zinc-700 rounded w-1/3 mb-2"></div>
        <div className="h-6 bg-zinc-700 rounded w-1/2"></div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="bg-zinc-800/30 border border-zinc-700/30 rounded-xl p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">Staking Pool TVL</span>
          <span className="text-white font-semibold">{totalStakedSol.toFixed(2)} SOL</span>
        </div>
        <div className="flex items-center justify-between text-sm mt-1">
          <span className="text-zinc-500">Reserve</span>
          <span className="text-zinc-300">{reserveSol.toFixed(2)} SOL</span>
        </div>
        <div className="flex items-center justify-between text-sm mt-1">
          <span className="text-zinc-500">Rate</span>
          <span className="text-emerald-400">1 secuSOL = {exchangeRate.toFixed(4)} SOL</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-zinc-800/50 to-zinc-900/50 border border-zinc-700/30 rounded-xl p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-3 flex items-center gap-2">
        <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
        Staking Pool Stats
      </h3>
      
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-zinc-800/50 rounded-lg p-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Total Staked</p>
          <p className="text-lg font-semibold text-white">{totalStakedSol.toFixed(4)} SOL</p>
        </div>
        
        <div className="bg-zinc-800/50 rounded-lg p-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Reserve</p>
          <p className="text-lg font-semibold text-white">{reserveSol.toFixed(4)} SOL</p>
        </div>
        
        <div className="bg-zinc-800/50 rounded-lg p-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Exchange Rate</p>
          <p className="text-lg font-semibold text-emerald-400">1:{exchangeRate.toFixed(4)}</p>
          <p className="text-xs text-zinc-500">secuSOL:SOL</p>
        </div>
        
        <div className="bg-zinc-800/50 rounded-lg p-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Est. APY</p>
          <p className="text-lg font-semibold text-emerald-400">{apy.toFixed(1)}%</p>
        </div>
      </div>
      
      <div className="mt-3 pt-3 border-t border-zinc-700/30 flex justify-between text-xs text-zinc-500">
        <span>Total secuSOL Supply: {totalSlpSupply.toFixed(4)}</span>
      </div>
    </div>
  );
};

export default PoolStats;

