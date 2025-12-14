"use client";

import { PublicKey } from "@solana/web3.js";
import { usePoolData } from "../contexts/PoolDataContext";
import { AmmPool } from "../lib/program";

interface UseAmmReturn {
  ammPool: AmmPool | null;
  loading: boolean; // Maps to initialLoading for backward compatibility
  isRefreshing: boolean; // True when data is being refreshed in background
  error: string | null;
  reserveA: number; // SOL in pool
  reserveB: number; // slpSOL in pool
  totalLpSupply: number;
  priceAinB: number; // Price of SOL in slpSOL terms
  priceBinA: number; // Price of slpSOL in SOL terms
  feeBps: number;
  lpMint: PublicKey | null; // LP token mint address
  calculateSwapOutput: (
    amountIn: bigint,
    aToB: boolean
  ) => { amountOut: bigint; fee: bigint };
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch and track AMM pool state
 * Now uses centralized PoolDataContext
 */
export function useAmm(): UseAmmReturn {
  const {
    ammPool,
    ammPoolInitialLoading,
    ammPoolIsRefreshing,
    ammPoolError,
    reserveA,
    reserveB,
    totalLpSupply,
    priceAinB,
    priceBinA,
    feeBps,
    lpMint,
    calculateSwapOutput,
    refreshAmmPool,
  } = usePoolData();

  return {
    ammPool,
    loading: ammPoolInitialLoading, // Use initialLoading for backward compatibility
    isRefreshing: ammPoolIsRefreshing,
    error: ammPoolError?.message ?? null,
    reserveA,
    reserveB,
    totalLpSupply,
    priceAinB,
    priceBinA,
    feeBps,
    lpMint,
    calculateSwapOutput,
    refresh: refreshAmmPool,
  };
}

