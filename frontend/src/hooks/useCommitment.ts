"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { fetchCommitment, Commitment as CommitmentType } from "../lib/program";

export interface CommitmentState {
  commitment: CommitmentType | null;
  isLoading: boolean;
  error: string | null;
  exists: boolean;
}

/**
 * Hook to fetch and track user's current commitment
 */
export function useCommitment(pollInterval: number = 5000): CommitmentState & { refetch: () => Promise<void> } {
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  const [state, setState] = useState<CommitmentState>({
    commitment: null,
    isLoading: true,
    error: null,
    exists: false,
  });

  const fetchCommitmentData = useCallback(async () => {
    if (!publicKey) {
      setState({
        commitment: null,
        isLoading: false,
        error: null,
        exists: false,
      });
      return;
    }

    try {
      const commitment = await fetchCommitment(connection, publicKey);
      setState({
        commitment,
        isLoading: false,
        error: null,
        exists: commitment !== null,
      });
    } catch (error) {
      console.error("Error fetching commitment:", error);
      setState({
        commitment: null,
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to fetch commitment",
        exists: false,
      });
    }
  }, [connection, publicKey]);

  // Initial fetch and polling
  useEffect(() => {
    fetchCommitmentData();

    const interval = setInterval(fetchCommitmentData, pollInterval);
    return () => clearInterval(interval);
  }, [fetchCommitmentData, pollInterval]);

  return { ...state, refetch: fetchCommitmentData };
}

/**
 * Check if a commitment has passed the minimum delay
 */
export function canReveal(commitment: CommitmentType | null, minDelaySeconds: number = 1): boolean {
  if (!commitment) return false;
  
  const now = Math.floor(Date.now() / 1000);
  const commitTime = Number(commitment.timestamp);
  return now >= commitTime + minDelaySeconds;
}

/**
 * Get the time remaining until reveal is allowed (in seconds)
 */
export function getTimeUntilReveal(commitment: CommitmentType | null, minDelaySeconds: number = 1): number {
  if (!commitment) return 0;
  
  const now = Math.floor(Date.now() / 1000);
  const commitTime = Number(commitment.timestamp);
  const revealTime = commitTime + minDelaySeconds;
  
  return Math.max(0, revealTime - now);
}

/**
 * Format commitment for display
 */
export function formatCommitment(commitment: CommitmentType): {
  type: "stake" | "unstake";
  amount: string;
  timestamp: Date;
  hashPreview: string;
} {
  return {
    type: commitment.isStake ? "stake" : "unstake",
    amount: (Number(commitment.amountLamports) / 1e9).toFixed(4),
    timestamp: new Date(Number(commitment.timestamp) * 1000),
    hashPreview: `${commitment.hash.slice(0, 4).join("")}...${commitment.hash.slice(-4).join("")}`,
  };
}

