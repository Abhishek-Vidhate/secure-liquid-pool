import {
  Connection,
  Transaction,
  PublicKey,
  ComputeBudgetProgram,
} from "@solana/web3.js";

// ============================================================================
// TRANSACTION UTILITIES
// ============================================================================

/**
 * Send a transaction with optimistic UI support
 * 
 * This function:
 * 1. Simulates the transaction first to catch errors early
 * 2. Sets priority fees for faster inclusion
 * 3. Sends the transaction and returns immediately (non-blocking)
 * 4. Returns signature for background confirmation
 * 
 * @param connection - Solana connection
 * @param transaction - Transaction to send
 * @param signTransaction - Wallet sign function
 * @param feePayer - Fee payer public key
 * @param options - Optional configuration
 * @returns Transaction signature
 */
export async function sendTransaction(
  connection: Connection,
  transaction: Transaction,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  feePayer: PublicKey,
  options?: {
    skipPreflight?: boolean;
    priorityFee?: number; // microLamports per compute unit
    computeUnitLimit?: number;
    simulateFirst?: boolean;
  }
): Promise<string> {
  const {
    skipPreflight = false,
    priorityFee = 1000, // Default 0.001 SOL per 1M CU (reasonable for fast confirmation)
    computeUnitLimit,
    simulateFirst = true,
  } = options || {};

  // Get latest blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  
  // IMPORTANT: Set the fee payer BEFORE signing
  transaction.feePayer = feePayer;
  transaction.recentBlockhash = blockhash;

  // Add priority fee for faster confirmation
  if (priorityFee > 0) {
    const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFee,
    });
    transaction.instructions.unshift(priorityFeeIx);
  }

  // Add compute unit limit if specified
  if (computeUnitLimit) {
    const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: computeUnitLimit,
    });
    transaction.instructions.unshift(computeLimitIx);
  }
  
  // Simulate transaction first to catch errors early (before wallet popup)
  if (simulateFirst) {
    try {
      const simulation = await connection.simulateTransaction(transaction);
      if (simulation.value.err) {
        throw new Error(
          `Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`
        );
      }
    } catch (error) {
      // If simulation fails, still allow sending (some RPCs have simulation issues)
      // but log the error
      console.warn("Transaction simulation warning:", error);
    }
  }
  
  // Sign the transaction using the wallet
  const signedTx = await signTransaction(transaction);
  
  // Send the signed transaction (non-blocking)
  // Reduced maxRetries to 1 to avoid excessive retries on rate limits
  // Rate limit errors will be handled by the Connection's disableRetryOnRateLimit setting
  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight,
    preflightCommitment: "processed", // Use "processed" for faster preflight
    maxRetries: 1, // Reduced from 3 to minimize retry spam on rate limits
  });
  
  return signature;
}

/**
 * Confirm a transaction in the background (non-blocking)
 * 
 * This function confirms the transaction without blocking the UI.
 * Use this for background confirmation after optimistic UI updates.
 * 
 * @param connection - Solana connection
 * @param signature - Transaction signature
 * @param commitment - Commitment level
 * @returns Promise that resolves when confirmed or rejects on failure
 */
export async function confirmTransaction(
  connection: Connection,
  signature: string,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed"
): Promise<void> {
  // First check if already confirmed (fast path)
  const status = await connection.getSignatureStatus(signature);
  
  if (status?.value?.confirmationStatus === commitment || 
      status?.value?.confirmationStatus === "finalized") {
    if (status.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
    }
    return; // Already confirmed
  }

  // If not confirmed yet, wait for confirmation with timeout
  // Use a more efficient confirmation method for Helius RPC
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(commitment);
  
  // Use confirmTransaction with timeout to avoid hanging
  await Promise.race([
    connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
    }, commitment),
    new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("Transaction confirmation timeout")), 10000); // 10s timeout
    }),
  ]);
}

/**
 * Confirm transaction with timeout
 * 
 * @param connection - Solana connection
 * @param signature - Transaction signature
 * @param timeoutMs - Timeout in milliseconds (default: 30000 = 30s)
 * @param commitment - Commitment level
 * @returns Promise that resolves when confirmed or rejects on timeout/failure
 */
export async function confirmTransactionWithTimeout(
  connection: Connection,
  signature: string,
  timeoutMs: number = 30000,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed"
): Promise<void> {
  return Promise.race([
    confirmTransaction(connection, signature, commitment),
    new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("Transaction confirmation timeout")), timeoutMs);
    }),
  ]);
}

