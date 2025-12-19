"use client";

import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { usePoolData } from "../contexts/PoolDataContext";

export interface Balances {
  solBalance: number;
  solBalanceLamports: bigint;
  slpSolBalance: number;
  slpSolBalanceLamports: bigint;
  slpSolMint: PublicKey | null;
  isLoading: boolean;
  isRefreshing: boolean; // True when data is being refreshed in background
  error: string | null;
}

/**
 * Hook to fetch and track user's SOL and slpSOL balances
 * Now uses centralized PoolDataContext
 * @param pollInterval - Deprecated, polling is now handled by PoolDataContext
 */
export function useBalances(
  pollInterval?: number
): Balances & { refetch: (bypassThrottle?: boolean) => Promise<void> } {
  const {
    balances,
    balancesInitialLoading,
    balancesIsRefreshing,
    balancesError,
    refreshBalances,
  } = usePoolData();

  return {
    solBalance: balances.solBalance,
    solBalanceLamports: balances.solBalanceLamports,
    slpSolBalance: balances.slpSolBalance,
    slpSolBalanceLamports: balances.slpSolBalanceLamports,
    slpSolMint: balances.slpSolMint,
    isLoading: balancesInitialLoading, // Use initialLoading for backward compatibility
    isRefreshing: balancesIsRefreshing,
    error: balancesError?.message ?? null,
    refetch: refreshBalances,
  };
}

/**
 * Format balance for display
 */
export function formatBalance(balance: number, decimals: number = 4): string {
  if (balance === 0) return "0";
  if (balance < 0.0001) return "< 0.0001";
  return balance.toFixed(decimals);
}

/**
 * Format lamports to SOL string
 */
export function lamportsToSol(lamports: bigint | number): string {
  const value = Number(lamports) / LAMPORTS_PER_SOL;
  return formatBalance(value);
}
