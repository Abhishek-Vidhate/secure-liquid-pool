"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { 
  fetchAmmPool, 
  AmmPool, 
  calculateAmmSwapOutput,
  getAmmPoolPDA,
} from "../lib/program";
import { WSOL_MINT } from "../lib/constants";
import { useStakePool } from "./useStakePool";

interface UseAmmReturn {
  ammPool: AmmPool | null;
  loading: boolean;
  error: string | null;
  reserveA: number;  // SOL in pool
  reserveB: number;  // slpSOL in pool
  totalLpSupply: number;
  priceAinB: number; // Price of SOL in slpSOL terms
  priceBinA: number; // Price of slpSOL in SOL terms
  feeBps: number;
  lpMint: PublicKey | null; // LP token mint address
  calculateSwapOutput: (amountIn: bigint, aToB: boolean) => { amountOut: bigint; fee: bigint };
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch and track AMM pool state
 */
export function useAmm(): UseAmmReturn {
  const { connection } = useConnection();
  const { poolConfig } = useStakePool();
  const [ammPool, setAmmPool] = useState<AmmPool | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!poolConfig?.slpMint) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      // Fetch AMM pool for WSOL/slpSOL pair
      const pool = await fetchAmmPool(connection, WSOL_MINT, poolConfig.slpMint);
      setAmmPool(pool);
    } catch (err) {
      console.error("Error fetching AMM pool:", err);
      setError("Failed to load AMM pool data");
    } finally {
      setLoading(false);
    }
  }, [connection, poolConfig?.slpMint]);

  useEffect(() => {
    refresh();
    // Poll every 15 seconds
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Calculate derived values
  const reserveA = ammPool 
    ? Number(ammPool.reserveA) / LAMPORTS_PER_SOL 
    : 0;
  const reserveB = ammPool 
    ? Number(ammPool.reserveB) / LAMPORTS_PER_SOL 
    : 0;
  const totalLpSupply = ammPool 
    ? Number(ammPool.totalLpSupply) / LAMPORTS_PER_SOL 
    : 0;

  // Price calculations
  const priceAinB = reserveA > 0 ? reserveB / reserveA : 0;
  const priceBinA = reserveB > 0 ? reserveA / reserveB : 0;

  const feeBps = ammPool?.feeBps ?? 30;
  const lpMint = ammPool?.lpMint ?? null;

  const calculateSwapOutput = useCallback((amountIn: bigint, aToB: boolean): { amountOut: bigint; fee: bigint } => {
    if (!ammPool) {
      return { amountOut: BigInt(0), fee: BigInt(0) };
    }
    return calculateAmmSwapOutput(ammPool, amountIn, aToB);
  }, [ammPool]);

  return {
    ammPool,
    loading,
    error,
    reserveA,
    reserveB,
    totalLpSupply,
    priceAinB,
    priceBinA,
    feeBps,
    lpMint,
    calculateSwapOutput,
    refresh,
  };
}

