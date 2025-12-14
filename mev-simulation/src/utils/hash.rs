//! Hash Utilities for Commit-Reveal
//!
//! Implements SHA256 hashing that matches the on-chain program's
//! Borsh serialization format.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Swap details that are hashed for the commit-reveal scheme
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapDetails {
    /// Amount of input tokens in lamports
    pub amount_in: u64,
    /// Minimum output amount (slippage protection)
    pub min_out: u64,
    /// Slippage tolerance in basis points
    pub slippage_bps: u16,
    /// Random nonce for replay protection (32 bytes)
    pub nonce: [u8; 32],
}

impl SwapDetails {
    /// Create new swap details with a random nonce
    pub fn new(amount_in: u64, min_out: u64, slippage_bps: u16) -> Self {
        let mut nonce = [0u8; 32];
        rand::Rng::fill(&mut rand::thread_rng(), &mut nonce);
        
        Self {
            amount_in,
            min_out,
            slippage_bps,
            nonce,
        }
    }

    /// Create swap details with a specific nonce
    pub fn with_nonce(amount_in: u64, min_out: u64, slippage_bps: u16, nonce: [u8; 32]) -> Self {
        Self {
            amount_in,
            min_out,
            slippage_bps,
            nonce,
        }
    }

    /// Serialize to bytes matching on-chain Borsh format
    /// Layout: amount_in (u64 LE) + min_out (u64 LE) + slippage_bps (u16 LE) + nonce ([u8; 32])
    /// Total: 8 + 8 + 2 + 32 = 50 bytes
    pub fn serialize(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(50);
        
        // amount_in: u64 little-endian
        bytes.extend_from_slice(&self.amount_in.to_le_bytes());
        
        // min_out: u64 little-endian
        bytes.extend_from_slice(&self.min_out.to_le_bytes());
        
        // slippage_bps: u16 little-endian
        bytes.extend_from_slice(&self.slippage_bps.to_le_bytes());
        
        // nonce: [u8; 32]
        bytes.extend_from_slice(&self.nonce);
        
        bytes
    }
}

/// Hash swap details using SHA256
/// Returns a 32-byte hash matching the on-chain commitment
pub fn hash_swap_details(details: &SwapDetails) -> [u8; 32] {
    let serialized = details.serialize();
    let mut hasher = Sha256::new();
    hasher.update(&serialized);
    let result = hasher.finalize();
    
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Convert hash to hex string for display
pub fn hash_to_hex(hash: &[u8; 32]) -> String {
    hash.iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

/// Generate a random 32-byte nonce
pub fn generate_nonce() -> [u8; 32] {
    let mut nonce = [0u8; 32];
    rand::Rng::fill(&mut rand::thread_rng(), &mut nonce);
    nonce
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialization_length() {
        let details = SwapDetails::new(1_000_000_000, 900_000_000, 100);
        let serialized = details.serialize();
        assert_eq!(serialized.len(), 50);
    }

    #[test]
    fn test_hash_determinism() {
        let nonce = [42u8; 32];
        let details1 = SwapDetails::with_nonce(1_000_000_000, 900_000_000, 100, nonce);
        let details2 = SwapDetails::with_nonce(1_000_000_000, 900_000_000, 100, nonce);
        
        let hash1 = hash_swap_details(&details1);
        let hash2 = hash_swap_details(&details2);
        
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_different_inputs_different_hashes() {
        let nonce = [42u8; 32];
        let details1 = SwapDetails::with_nonce(1_000_000_000, 900_000_000, 100, nonce);
        let details2 = SwapDetails::with_nonce(2_000_000_000, 900_000_000, 100, nonce);
        
        let hash1 = hash_swap_details(&details1);
        let hash2 = hash_swap_details(&details2);
        
        assert_ne!(hash1, hash2);
    }
}

