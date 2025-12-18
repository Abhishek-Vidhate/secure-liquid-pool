"use client";

import { useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { useProgram } from "./useProgram";
import { useCommitment } from "./useCommitment";
import { useBalances } from "./useBalances";
import { useStakePool } from "./useStakePool";
import { createSwapDetailsWithHash, hashToArray } from "../lib/hash";
import { sendTransaction, confirmTransaction } from "../lib/transaction";
import {
  type SwapDetails,
  getPoolConfigPDA,
  getPoolAuthorityPDA,
  getReserveVaultPDA,
  getSecurelpProgram,
  getStakePoolProgram,
} from "../lib/program";
import {
  MIN_DELAY_SECONDS,
} from "../lib/constants";
import { AnchorProvider } from "@coral-xyz/anchor";
import BN from "bn.js";

// ============================================================================
// TYPES
// ============================================================================

export type CommitRevealPhase =
  | "idle"
  | "calculating"
  | "committing"
  | "committed"
  | "waiting_delay"
  | "revealing"
  | "submitting"
  | "completed"
  | "error";

export interface CommitRevealState {
  phase: CommitRevealPhase;
  error: string | null;
  txSignature: string | null;
  quote: {
    inputAmount: bigint;
    outputAmount: bigint;
    exchangeRate: number;
  } | null;
  // Stored for reveal phase
  swapDetails: SwapDetails | null;
  nonce: Uint8Array | null;
}

export interface CommitRevealActions {
  // Stake flow (SOL -> slpSOL)
  initiateStake: (amountSol: number, slippageBps: number) => Promise<void>;
  executeStakeReveal: () => Promise<void>;

  // Unstake flow (slpSOL -> SOL)
  initiateUnstake: (amountSlpSol: number, slippageBps: number) => Promise<void>;
  executeUnstakeReveal: () => Promise<void>;

  // Cancel
  cancelCommitment: () => Promise<void>;

  // Reset
  reset: () => void;
}

// ============================================================================
// HOOK
// ============================================================================

export function useCommitReveal(): CommitRevealState & CommitRevealActions {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, signTransaction } = wallet;
  const program = useProgram();
  const { commitment, refetch: refetchCommitment } = useCommitment(); // Get commitment to validate in reveal
  const { refetch: refetchBalances, slpSolMint } = useBalances();
  const { poolConfig, calculateSlpForSol, calculateSolForSlp, exchangeRate } = useStakePool();

  const [state, setState] = useState<CommitRevealState>({
    phase: "idle",
    error: null,
    txSignature: null,
    quote: null,
    swapDetails: null,
    nonce: null,
  });

  // ============================================================================
  // STAKE FLOW (SOL -> slpSOL)
  // ============================================================================

  const initiateStake = useCallback(async (amountSol: number, slippageBps: number) => {
    if (!publicKey || !program || !signTransaction) {
      setState(prev => ({ ...prev, phase: "error", error: "Wallet not connected" }));
      return;
    }

    if (!poolConfig) {
      setState(prev => ({ ...prev, phase: "error", error: "Stake pool not initialized" }));
      return;
    }

    try {
      setState(prev => ({ ...prev, phase: "calculating", error: null }));

      // Check if a commitment already exists
      const existingCommitment = await import("../lib/program").then(m =>
        m.fetchCommitment(connection, publicKey)
      );

      if (existingCommitment) {
        setState(prev => ({
          ...prev,
          phase: "error",
          error: `You already have a pending ${existingCommitment.isStake ? "stake" : "unstake"} commitment. Please execute or cancel it first.`
        }));
        return;
      }

      // Convert SOL to lamports
      const amountLamports = BigInt(Math.floor(amountSol * LAMPORTS_PER_SOL));

      // Calculate expected slpSOL output
      const expectedSlpSol = calculateSlpForSol(amountLamports);

      // Apply slippage tolerance
      const minOut = expectedSlpSol - (expectedSlpSol * BigInt(slippageBps) / BigInt(10000));

      // Create swap details and hash
      const { details, hash, nonce } = createSwapDetailsWithHash(
        amountLamports,
        minOut,
        slippageBps
      );

      setState(prev => ({
        ...prev,
        phase: "committing",
        quote: {
          inputAmount: amountLamports,
          outputAmount: expectedSlpSol,
          exchangeRate,
        },
        swapDetails: details,
        nonce,
      }));

      // Build commit transaction
      const commitTx = await program.methods
        .commit(hashToArray(hash), new BN(amountLamports.toString()), true)
        .accounts({
          user: publicKey,
        })
        .transaction();

      // Send transaction (non-blocking)
      // Note: sendTransaction returns after wallet confirmation, but we wait for on-chain confirmation
      const signature = await sendTransaction(
        connection,
        commitTx,
        signTransaction,
        publicKey,
        { simulateFirst: true, priorityFee: 1000 }
      );

      // Keep phase as "committing" until transaction is confirmed on-chain
      // This prevents the execute button from appearing before confirmation
      setState(prev => ({
        ...prev,
        txSignature: signature,
        // Keep phase as "committing" - will change to "committed" after confirmation
      }));

      // Confirm in background (non-blocking)
      // After confirmation, refresh commitment data and THEN show execute button
      confirmTransaction(connection, signature, "confirmed")
        .then(() => {
          // Transaction confirmed on-chain - now refresh commitment and update UI
          return refetchCommitment(true).then(() => {
            // After commitment is refreshed, update phase to "committed" to show execute button
            setState(prev => ({
              ...prev,
              phase: "committed",
            }));
          }).catch((err) => {
            // If refresh fails, still update phase - polling will eventually update it
            console.warn("Immediate commitment refresh failed, will retry via polling:", err);
            setState(prev => ({
              ...prev,
              phase: "committed", // Show execute button even if refresh failed - polling will update
            }));
          });
        })
        .catch((error) => {
          // Transaction failed - revert optimistic update
          console.error("Transaction confirmation failed:", error);
          setState(prev => ({
            ...prev,
            phase: "error",
            error: error instanceof Error ? error.message : "Transaction failed",
            txSignature: null,
          }));
        });

    } catch (error) {
      console.error("Stake initiation failed:", error);
      setState(prev => ({
        ...prev,
        phase: "error",
        error: error instanceof Error ? error.message : "Failed to initiate stake",
      }));
    }
  }, [publicKey, program, signTransaction, connection, refetchCommitment, refetchBalances, poolConfig, calculateSlpForSol, exchangeRate]);

  const executeStakeReveal = useCallback(async () => {
    // Validate requirements - check both state and commitment from context
    if (!publicKey || !signTransaction || !poolConfig || !slpSolMint) {
      setState(prev => ({ ...prev, phase: "error", error: "Missing requirements for reveal" }));
      return;
    }

    // Check commitment exists and has required data
    if (!commitment || !state.swapDetails) {
      setState(prev => ({ ...prev, phase: "error", error: "Missing requirements for reveal - commitment or swap details not found" }));
      return;
    }

    try {
      setState(prev => ({ ...prev, phase: "waiting_delay" }));

      // Wait for minimum delay
      await new Promise(resolve => setTimeout(resolve, MIN_DELAY_SECONDS * 1000 + 500));

      setState(prev => ({ ...prev, phase: "revealing" }));

      // Create AnchorProvider
      const provider = new AnchorProvider(
        connection,
        wallet as any,
        { commitment: "confirmed" }
      );

      const securelpProgram = getSecurelpProgram(provider);
      const stakePoolProgram = getStakePoolProgram(provider);

      // Get PDAs
      const [poolConfigPda] = getPoolConfigPDA();
      const [poolAuthority] = getPoolAuthorityPDA(poolConfigPda);
      const [reserveVault] = getReserveVaultPDA(poolConfigPda);

      // Get or create user's slpSOL token account
      const userSlpAccount = await getAssociatedTokenAddress(slpSolMint, publicKey);

      // Check if account exists, if not add create instruction
      const accountInfo = await connection.getAccountInfo(userSlpAccount);

      // Build reveal transaction
      const swapDetailsArg = {
        amountIn: new BN(state.swapDetails.amountIn.toString()),
        minOut: new BN(state.swapDetails.minOut.toString()),
        slippageBps: state.swapDetails.slippageBps,
        nonce: Array.from(state.swapDetails.nonce),
      };

      // Use type assertion since Anchor's type resolution is strict
      let revealTx = await securelpProgram.methods
        .revealAndStake(swapDetailsArg)
        .accounts({
          user: publicKey,
          poolConfig: poolConfigPda,
          poolAuthority: poolAuthority,
          reserveVault: reserveVault,
          slpMint: slpSolMint,
          userSlpAccount: userSlpAccount,
        } as any)
        .transaction();

      // If user doesn't have slpSOL account, prepend create instruction
      if (!accountInfo) {
        const createAtaIx = createAssociatedTokenAccountInstruction(
          publicKey,
          userSlpAccount,
          publicKey,
          slpSolMint
        );
        revealTx.instructions.unshift(createAtaIx);
      }

      // Send transaction (non-blocking)
      // Note: sendTransaction returns after wallet confirmation, but we wait for on-chain confirmation
      const signature = await sendTransaction(
        connection,
        revealTx,
        signTransaction,
        publicKey,
        { simulateFirst: true, priorityFee: 1000 }
      );

      // Optimistic UI update - set to completed immediately
      setState(prev => ({
        ...prev,
        txSignature: signature,
        phase: "completed",
      }));

      // Confirm in background (non-blocking)
      // After confirmation, refresh commitment (should be null after reveal - account is closed) and balances
      confirmTransaction(connection, signature, "confirmed")
        .then(() => {
          // Transaction confirmed on-chain - commitment PDA is closed, so commitment should be null
          // Refresh commitment and balances immediately (bypass throttling)
          return Promise.all([
            refetchCommitment(true).catch(err => console.warn("Commitment refresh failed:", err)),
            refetchBalances(true).catch(err => console.warn("Balance refresh failed:", err)),
          ]);
        })
        .catch((error) => {
          console.error("Transaction confirmation failed:", error);
          setState(prev => ({
            ...prev,
            phase: "error",
            error: error instanceof Error ? error.message : "Transaction failed",
            txSignature: null,
          }));
        });

    } catch (error) {
      console.error("Stake reveal failed:", error);
      setState(prev => ({
        ...prev,
        phase: "error",
        error: error instanceof Error ? error.message : "Failed to execute reveal",
      }));
    }
  }, [publicKey, signTransaction, connection, state.swapDetails, refetchCommitment, refetchBalances, poolConfig, slpSolMint, wallet]);

  // ============================================================================
  // UNSTAKE FLOW (slpSOL -> SOL)
  // ============================================================================

  const initiateUnstake = useCallback(async (amountSlpSol: number, slippageBps: number) => {
    if (!publicKey || !program || !signTransaction) {
      setState(prev => ({ ...prev, phase: "error", error: "Wallet not connected" }));
      return;
    }

    if (!poolConfig) {
      setState(prev => ({ ...prev, phase: "error", error: "Stake pool not initialized" }));
      return;
    }

    try {
      setState(prev => ({ ...prev, phase: "calculating", error: null }));

      // Check if a commitment already exists
      const existingCommitment = await import("../lib/program").then(m =>
        m.fetchCommitment(connection, publicKey)
      );

      if (existingCommitment) {
        setState(prev => ({
          ...prev,
          phase: "error",
          error: `You already have a pending ${existingCommitment.isStake ? "stake" : "unstake"} commitment. Please execute or cancel it first.`
        }));
        return;
      }

      // Convert slpSOL to lamports (same decimals as SOL)
      const amountLamports = BigInt(Math.floor(amountSlpSol * LAMPORTS_PER_SOL));

      // Calculate expected SOL output
      const expectedSol = calculateSolForSlp(amountLamports);

      // Apply slippage tolerance
      const minOut = expectedSol - (expectedSol * BigInt(slippageBps) / BigInt(10000));

      // Create swap details and hash
      const { details, hash, nonce } = createSwapDetailsWithHash(
        amountLamports,
        minOut,
        slippageBps
      );

      setState(prev => ({
        ...prev,
        phase: "committing",
        quote: {
          inputAmount: amountLamports,
          outputAmount: expectedSol,
          exchangeRate,
        },
        swapDetails: details,
        nonce,
      }));

      // Build commit transaction (is_stake = false for unstake)
      const commitTx = await program.methods
        .commit(hashToArray(hash), new BN(amountLamports.toString()), false)
        .accounts({
          user: publicKey,
        })
        .transaction();

      // Send transaction (non-blocking)
      const signature = await sendTransaction(
        connection,
        commitTx,
        signTransaction,
        publicKey,
        { simulateFirst: true, priorityFee: 1000 }
      );

      // Keep phase as "committing" until transaction is confirmed on-chain
      // This prevents the execute button from appearing before confirmation
      setState(prev => ({
        ...prev,
        txSignature: signature,
        // Keep phase as "committing" - will change to "committed" after confirmation
      }));

      // Confirm in background (non-blocking)
      // After confirmation, refresh commitment data and THEN show execute button
      confirmTransaction(connection, signature, "confirmed")
        .then(() => {
          // Transaction confirmed on-chain - now refresh commitment and update UI
          return refetchCommitment(true).then(() => {
            // After commitment is refreshed, update phase to "committed" to show execute button
            setState(prev => ({
              ...prev,
              phase: "committed",
            }));
          }).catch((err) => {
            // If refresh fails, still update phase - polling will eventually update it
            console.warn("Immediate commitment refresh failed, will retry via polling:", err);
            setState(prev => ({
              ...prev,
              phase: "committed", // Show execute button even if refresh failed - polling will update
            }));
          });
        })
        .catch((error) => {
          console.error("Transaction confirmation failed:", error);
          setState(prev => ({
            ...prev,
            phase: "error",
            error: error instanceof Error ? error.message : "Transaction failed",
            txSignature: null,
          }));
        });

    } catch (error) {
      console.error("Unstake initiation failed:", error);
      setState(prev => ({
        ...prev,
        phase: "error",
        error: error instanceof Error ? error.message : "Failed to initiate unstake",
      }));
    }
  }, [publicKey, program, signTransaction, connection, refetchCommitment, refetchBalances, poolConfig, calculateSolForSlp, exchangeRate]);

  const executeUnstakeReveal = useCallback(async () => {
    // Validate requirements - check both state and commitment from context
    if (!publicKey || !signTransaction || !poolConfig || !slpSolMint) {
      setState(prev => ({ ...prev, phase: "error", error: "Missing requirements for reveal" }));
      return;
    }

    // Check commitment exists and has required data
    if (!commitment || !state.swapDetails) {
      setState(prev => ({ ...prev, phase: "error", error: "Missing requirements for reveal - commitment or swap details not found" }));
      return;
    }

    try {
      setState(prev => ({ ...prev, phase: "waiting_delay" }));

      // Wait for minimum delay
      await new Promise(resolve => setTimeout(resolve, MIN_DELAY_SECONDS * 1000 + 500));

      setState(prev => ({ ...prev, phase: "revealing" }));

      // Create AnchorProvider
      const provider = new AnchorProvider(
        connection,
        wallet as any,
        { commitment: "confirmed" }
      );

      const securelpProgram = getSecurelpProgram(provider);

      // Get PDAs
      const [poolConfigPda] = getPoolConfigPDA();
      const [reserveVault] = getReserveVaultPDA(poolConfigPda);

      // Get user's slpSOL token account
      const userSlpAccount = await getAssociatedTokenAddress(slpSolMint, publicKey);

      // Build reveal transaction
      const swapDetailsArg = {
        amountIn: new BN(state.swapDetails.amountIn.toString()),
        minOut: new BN(state.swapDetails.minOut.toString()),
        slippageBps: state.swapDetails.slippageBps,
        nonce: Array.from(state.swapDetails.nonce),
      };

      // Use type assertion since Anchor's type resolution is strict
      const revealTx = await securelpProgram.methods
        .revealAndUnstake(swapDetailsArg)
        .accounts({
          user: publicKey,
          poolConfig: poolConfigPda,
          reserveVault: reserveVault,
          slpMint: slpSolMint,
          userSlpAccount: userSlpAccount,
        } as any)
        .transaction();

      // Send transaction (non-blocking)
      // Note: sendTransaction returns after wallet confirmation, but we wait for on-chain confirmation
      const signature = await sendTransaction(
        connection,
        revealTx,
        signTransaction,
        publicKey,
        { simulateFirst: true, priorityFee: 1000 }
      );

      // Optimistic UI update - set to completed immediately
      setState(prev => ({
        ...prev,
        txSignature: signature,
        phase: "completed",
      }));

      // Confirm in background (non-blocking)
      // After confirmation, refresh commitment (should be null after reveal - account is closed) and balances
      confirmTransaction(connection, signature, "confirmed")
        .then(() => {
          // Transaction confirmed on-chain - commitment PDA is closed, so commitment should be null
          // Refresh commitment and balances immediately (bypass throttling)
          return Promise.all([
            refetchCommitment(true).catch(err => console.warn("Commitment refresh failed:", err)),
            refetchBalances(true).catch(err => console.warn("Balance refresh failed:", err)),
          ]);
        })
        .catch((error) => {
          console.error("Transaction confirmation failed:", error);
          setState(prev => ({
            ...prev,
            phase: "error",
            error: error instanceof Error ? error.message : "Transaction failed",
            txSignature: null,
          }));
        });

    } catch (error) {
      console.error("Unstake reveal failed:", error);
      setState(prev => ({
        ...prev,
        phase: "error",
        error: error instanceof Error ? error.message : "Failed to execute reveal",
      }));
    }
  }, [publicKey, signTransaction, connection, state.swapDetails, refetchCommitment, refetchBalances, poolConfig, slpSolMint, wallet]);

  // ============================================================================
  // CANCEL
  // ============================================================================

  const cancelCommitment = useCallback(async () => {
    if (!publicKey || !program || !signTransaction) {
      setState(prev => ({ ...prev, phase: "error", error: "Wallet not connected" }));
      return;
    }

    try {
      setState(prev => ({ ...prev, phase: "committing" }));

      const cancelTx = await program.methods
        .cancelCommitment()
        .accounts({
          user: publicKey,
        })
        .transaction();

      // Send transaction (non-blocking)
      const signature = await sendTransaction(
        connection,
        cancelTx,
        signTransaction,
        publicKey,
        { simulateFirst: true, priorityFee: 1000 }
      );

      // Optimistic UI update
      setState({
        phase: "idle",
        error: null,
        txSignature: signature,
        quote: null,
        swapDetails: null,
        nonce: null,
      });

      // Confirm in background
      // After confirmation, immediately refresh commitment to update UI (commitment cleared after cancel)
      confirmTransaction(connection, signature, "confirmed")
        .then(() => {
          // Transaction confirmed successfully - refresh commitment immediately (bypass throttling)
          // This allows UI to update quickly without waiting for next poll cycle
          refetchCommitment(true).catch(err => {
            // If refresh fails, polling will eventually update
            console.warn("Commitment refresh failed, will retry via polling:", err);
          });
        })
        .catch((error) => {
          console.error("Transaction confirmation failed:", error);
          setState(prev => ({
            ...prev,
            phase: "error",
            error: error instanceof Error ? error.message : "Transaction failed",
          }));
        });

    } catch (error) {
      console.error("Cancel commitment failed:", error);
      setState(prev => ({
        ...prev,
        phase: "error",
        error: error instanceof Error ? error.message : "Failed to cancel commitment",
      }));
    }
  }, [publicKey, program, signTransaction, connection, refetchCommitment, refetchBalances]);

  // ============================================================================
  // RESET
  // ============================================================================

  const reset = useCallback(() => {
    setState({
      phase: "idle",
      error: null,
      txSignature: null,
      quote: null,
      swapDetails: null,
      nonce: null,
    });
  }, []);

  return {
    ...state,
    initiateStake,
    executeStakeReveal,
    initiateUnstake,
    executeUnstakeReveal,
    cancelCommitment,
    reset,
  };
}
