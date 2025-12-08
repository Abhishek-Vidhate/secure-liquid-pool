"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { 
  fetchPoolConfig, 
  PoolConfig, 
  calculateExchangeRate,
  calculateSlpForDeposit,
  calculateSolForWithdrawal,
  getPoolConfigPDA,
} from "../lib/program";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

interface UseStakePoolReturn {
  poolConfig: PoolConfig | null;
  loading: boolean;
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
 */
export function useStakePool(): UseStakePoolReturn {
  const { connection } = useConnection();
  const [poolConfig, setPoolConfig] = useState<PoolConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const config = await fetchPoolConfig(connection);
      setPoolConfig(config);
    } catch (err) {
      console.error("Error fetching pool config:", err);
      setError("Failed to load stake pool data");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    refresh();
    // Poll every 30 seconds
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Calculate derived values
  const exchangeRate = poolConfig ? calculateExchangeRate(poolConfig) : 1.0;
  const totalStakedSol = poolConfig 
    ? Number(poolConfig.totalStakedLamports) / LAMPORTS_PER_SOL 
    : 0;
  const totalSlpSupply = poolConfig 
    ? Number(poolConfig.totalSlpSupply) / LAMPORTS_PER_SOL 
    : 0;
  const reserveSol = poolConfig 
    ? Number(poolConfig.reserveLamports) / LAMPORTS_PER_SOL 
    : 0;

  // Estimate APY based on Solana staking rewards (~7% annually)
  // In production, this would be calculated from actual epoch rewards
  const apy = 7.0;

  const calculateSlpForSol = useCallback((solLamports: bigint): bigint => {
    if (!poolConfig) return solLamports;
    return calculateSlpForDeposit(poolConfig, solLamports);
  }, [poolConfig]);

  const calculateSolForSlp = useCallback((slpAmount: bigint): bigint => {
    if (!poolConfig) return slpAmount;
    return calculateSolForWithdrawal(poolConfig, slpAmount);
  }, [poolConfig]);

  return {
    poolConfig,
    loading,
    error,
    exchangeRate,
    totalStakedSol,
    totalSlpSupply,
    reserveSol,
    apy,
    calculateSlpForSol,
    calculateSolForSlp,
    refresh,
  };
}

