import {
  Connection,
  Transaction,
  PublicKey,
} from "@solana/web3.js";

// ============================================================================
// TRANSACTION UTILITIES
// ============================================================================

/**
 * Send a transaction using standard RPC
 * 
 * This function properly prepares a transaction for signing:
 * 1. Sets the fee payer to the wallet's public key
 * 2. Fetches a recent blockhash
 * 3. Signs the transaction via the wallet adapter
 * 4. Sends the raw transaction to the network
 */
export async function sendTransaction(
  connection: Connection,
  transaction: Transaction,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  feePayer: PublicKey
): Promise<string> {
  // Get latest blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  
  // IMPORTANT: Set the fee payer BEFORE signing
  transaction.feePayer = feePayer;
  transaction.recentBlockhash = blockhash;
  
  // Sign the transaction using the wallet
  const signedTx = await signTransaction(transaction);
  
  // Send the signed transaction
  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  
  // Optionally wait for confirmation
  // await connection.confirmTransaction({
  //   signature,
  //   blockhash,
  //   lastValidBlockHeight,
  // });
  
  return signature;
}

/**
 * Helper to confirm a transaction
 */
export async function confirmTransaction(
  connection: Connection,
  signature: string,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed"
): Promise<void> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(commitment);
  
  await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  }, commitment);
}

