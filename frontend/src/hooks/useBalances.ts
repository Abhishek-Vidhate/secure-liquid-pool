"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError } from "@solana/spl-token";
import { SOL_DECIMALS, SLP_SOL_DECIMALS } from "../lib/constants";
import { fetchPoolConfig } from "../lib/program";

export interface Balances {
  solBalance: number;
  solBalanceLamports: bigint;
  slpSolBalance: number;
  slpSolBalanceLamports: bigint;
  slpSolMint: PublicKey | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook to fetch and track user's SOL and slpSOL balances
 */
export function useBalances(pollInterval: number = 10000): Balances & { refetch: () => Promise<void> } {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  
  const [balances, setBalances] = useState<Balances>({
    solBalance: 0,
    solBalanceLamports: BigInt(0),
    slpSolBalance: 0,
    slpSolBalanceLamports: BigInt(0),
    slpSolMint: null,
    isLoading: true,
    error: null,
  });

  const fetchBalances = useCallback(async () => {
    if (!publicKey) {
      setBalances({
        solBalance: 0,
        solBalanceLamports: BigInt(0),
        slpSolBalance: 0,
        slpSolBalanceLamports: BigInt(0),
        slpSolMint: null,
        isLoading: false,
        error: null,
      });
      return;
    }

    try {
      // Fetch SOL balance
      const solBalanceLamports = await connection.getBalance(publicKey);
      const solBalance = solBalanceLamports / LAMPORTS_PER_SOL;

      // Fetch pool config to get slpSOL mint
      const poolConfig = await fetchPoolConfig(connection);
      let slpSolBalanceLamports = BigInt(0);
      let slpSolBalance = 0;
      let slpSolMint: PublicKey | null = null;

      if (poolConfig) {
        slpSolMint = poolConfig.slpMint;
        
        try {
          const slpSolAta = await getAssociatedTokenAddress(slpSolMint, publicKey);
          const tokenAccount = await getAccount(connection, slpSolAta);
          slpSolBalanceLamports = tokenAccount.amount;
          slpSolBalance = Number(slpSolBalanceLamports) / Math.pow(10, SLP_SOL_DECIMALS);
        } catch (e) {
          // Token account doesn't exist - that's fine, balance is 0
          if (!(e instanceof TokenAccountNotFoundError)) {
            console.error("Error fetching slpSOL balance:", e);
          }
        }
      }

      setBalances({
        solBalance,
        solBalanceLamports: BigInt(solBalanceLamports),
        slpSolBalance,
        slpSolBalanceLamports,
        slpSolMint,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      console.error("Error fetching balances:", error);
      setBalances((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to fetch balances",
      }));
    }
  }, [connection, publicKey]);

  // Initial fetch and polling
  useEffect(() => {
    fetchBalances();
    
    const interval = setInterval(fetchBalances, pollInterval);
    return () => clearInterval(interval);
  }, [fetchBalances, pollInterval]);

  return { ...balances, refetch: fetchBalances };
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
