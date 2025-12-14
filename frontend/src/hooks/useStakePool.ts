"use client";

import { usePoolData } from "../contexts/PoolDataContext";
import { PoolConfig } from "../lib/program";

interface UseStakePoolReturn {
  poolConfig: PoolConfig | null;
  loading: boolean; // Maps to initialLoading for backward compatibility
  isRefreshing: boolean; // True when data is being refreshed in background
  error: string | null;
  exchangeRate: number;
  totalStakedSol: number;
  totalSlpSupply: number;
  reserveSol: number;
  apy: number;
  calculateSlpForSol: (solLamports: bigint) => bigint;
  calculateSolForSlp: (slpAmount: bigint) => bigint;
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch and track stake pool state
 * Now uses centralized PoolDataContext
 */
export function useStakePool(): UseStakePoolReturn {
  const {
    poolConfig,
    poolConfigInitialLoading,
    poolConfigIsRefreshing,
    poolConfigError,
    exchangeRate,
    totalStakedSol,
    totalSlpSupply,
    reserveSol,
    apy,
    calculateSlpForSol,
    calculateSolForSlp,
    refreshPoolConfig,
  } = usePoolData();

  return {
    poolConfig,
    loading: poolConfigInitialLoading, // Use initialLoading for backward compatibility
    isRefreshing: poolConfigIsRefreshing,
    error: poolConfigError?.message ?? null,
    exchangeRate,
    totalStakedSol,
    totalSlpSupply,
    reserveSol,
    apy,
    calculateSlpForSol,
    calculateSolForSlp,
    refresh: refreshPoolConfig,
  };
}

