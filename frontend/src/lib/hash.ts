import { sha256 } from "@noble/hashes/sha256";
import type { SwapDetails } from "./program";

// ============================================================================
// BORSH SERIALIZATION HELPERS
// ============================================================================

/**
 * Convert a bigint to a little-endian Uint8Array (u64)
 */
function bigintToU64LE(value: bigint): Uint8Array {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, value, true); // little-endian
  return new Uint8Array(buffer);
}

/**
 * Convert a number to a little-endian Uint8Array (u16)
 */
function numberToU16LE(value: number): Uint8Array {
  const buffer = new ArrayBuffer(2);
  const view = new DataView(buffer);
  view.setUint16(0, value, true); // little-endian
  return new Uint8Array(buffer);
}

// ============================================================================
// SWAP DETAILS HASHING
// ============================================================================

/**
 * Serialize SwapDetails to match on-chain Borsh serialization
 * Layout: amount_in (u64 LE) + min_out (u64 LE) + slippage_bps (u16 LE) + nonce ([u8; 32])
 * Total: 8 + 8 + 2 + 32 = 50 bytes
 */
export function serializeSwapDetails(details: SwapDetails): Uint8Array {
  const amountInBytes = bigintToU64LE(details.amountIn);
  const minOutBytes = bigintToU64LE(details.minOut);
  const slippageBpsBytes = numberToU16LE(details.slippageBps);
  
  // Combine all parts
  const result = new Uint8Array(50);
  result.set(amountInBytes, 0);       // bytes 0-7
  result.set(minOutBytes, 8);         // bytes 8-15
  result.set(slippageBpsBytes, 16);   // bytes 16-17
  result.set(details.nonce, 18);      // bytes 18-49
  
  return result;
}

/**
 * Hash SwapDetails using SHA-256
 * This must match the on-chain hashing exactly
 */
export function hashSwapDetails(details: SwapDetails): Uint8Array {
  const serialized = serializeSwapDetails(details);
  return sha256(serialized);
}

/**
 * Generate a random nonce for replay protection
 */
export function generateNonce(): Uint8Array {
  const nonce = new Uint8Array(32);
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(nonce);
  } else {
    // Fallback for Node.js environment
    for (let i = 0; i < 32; i++) {
      nonce[i] = Math.floor(Math.random() * 256);
    }
  }
  return nonce;
}

/**
 * Create SwapDetails and compute its hash
 * Returns both the details and the hash for use in commit/reveal
 */
export function createSwapDetailsWithHash(
  amountIn: bigint,
  minOut: bigint,
  slippageBps: number
): { details: SwapDetails; hash: Uint8Array; nonce: Uint8Array } {
  const nonce = generateNonce();
  
  const details: SwapDetails = {
    amountIn,
    minOut,
    slippageBps,
    nonce,
  };
  
  const hash = hashSwapDetails(details);
  
  return { details, hash, nonce };
}

/**
 * Convert hash bytes to hex string for display
 */
export function hashToHex(hash: Uint8Array): string {
  return Array.from(hash)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert hash to array format for instruction arguments
 */
export function hashToArray(hash: Uint8Array): number[] {
  return Array.from(hash);
}

