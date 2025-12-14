"use client";

import { usePoolData } from "../contexts/PoolDataContext";
import { Commitment as CommitmentType } from "../lib/program";

export interface CommitmentState {
  commitment: CommitmentType | null;
  isLoading: boolean;
  error: string | null;
  exists: boolean;
}

/**
 * Hook to fetch and track user's current commitment
 * 
 * Now consumes data from PoolDataContext for centralized state management.
 * The pollInterval parameter is ignored as polling is handled by PoolDataContext.
 */
export function useCommitment(pollInterval?: number): CommitmentState & { refetch: (bypassThrottle?: boolean) => Promise<void> } {
  const {
    commitment,
    commitmentInitialLoading,
    commitmentIsRefreshing,
    commitmentError,
    commitmentExists,
    refreshCommitment,
  } = usePoolData();

  return {
        commitment,
    isLoading: commitmentInitialLoading,
    error: commitmentError?.message ?? null,
    exists: commitmentExists,
    refetch: refreshCommitment,
  };
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

