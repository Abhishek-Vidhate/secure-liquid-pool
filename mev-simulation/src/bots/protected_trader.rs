//! Protected Trader Bot
//!
//! Simulates a user making trades using the commit-reveal scheme.
//! These trades are protected from MEV sandwich attacks.

use crate::utils::{
    amm_math::PoolState,
    hash::{hash_swap_details, SwapDetails},
};
use crate::bots::normal_trader::TradeResult;
use serde::{Deserialize, Serialize};
use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer};
use tracing::{debug, info};

/// State of a commitment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CommitmentState {
    /// No active commitment
    None,
    /// Commitment submitted, waiting for reveal
    Committed {
        hash: [u8; 32],
        details: SwapDetails,
        a_to_b: bool,
        commit_slot: u64,
    },
    /// Revealed and executed
    Revealed,
}

/// Result of a protected trade (commit-reveal)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtectedTradeResult {
    /// Commit transaction signature
    pub commit_sig: String,
    /// Reveal transaction signature
    pub reveal_sig: String,
    /// Underlying trade result
    pub trade: TradeResult,
    /// Slots waited between commit and reveal
    pub slots_waited: u64,
    /// Hash of the commitment
    pub commitment_hash: String,
}

/// Protected trader using commit-reveal scheme
pub struct ProtectedTrader {
    /// Trader's keypair
    keypair: Keypair,
    /// Current balance of token A (SOL)
    balance_a: u64,
    /// Current balance of token B (secuSOL)
    balance_b: u64,
    /// Current commitment state
    commitment_state: CommitmentState,
    /// Total trades executed
    total_trades: u32,
    /// Current simulated slot
    current_slot: u64,
}

impl ProtectedTrader {
    /// Create a new protected trader
    pub fn new(keypair: Keypair, initial_balance_a: u64, initial_balance_b: u64) -> Self {
        Self {
            keypair,
            balance_a: initial_balance_a,
            balance_b: initial_balance_b,
            commitment_state: CommitmentState::None,
            total_trades: 0,
            current_slot: 0,
        }
    }

    /// Get trader's public key
    pub fn pubkey(&self) -> Pubkey {
        self.keypair.pubkey()
    }

    /// Get current balances
    pub fn balances(&self) -> (u64, u64) {
        (self.balance_a, self.balance_b)
    }

    /// Check if there's an active commitment
    pub fn has_commitment(&self) -> bool {
        matches!(self.commitment_state, CommitmentState::Committed { .. })
    }

    /// Submit a commitment (Phase 1 of commit-reveal)
    /// 
    /// The commitment hides the trade details from attackers.
    /// They can see that a commitment exists but cannot determine:
    /// - Trade direction (buy or sell)
    /// - Trade amount
    /// - Minimum output
    pub fn commit(
        &mut self,
        amount_in: u64,
        min_out: u64,
        slippage_bps: u16,
        a_to_b: bool,
    ) -> Option<[u8; 32]> {
        // Check if there's already an active commitment
        if self.has_commitment() {
            debug!("Already has active commitment");
            return None;
        }

        // Check balance
        let has_balance = if a_to_b {
            self.balance_a >= amount_in
        } else {
            self.balance_b >= amount_in
        };

        if !has_balance {
            debug!("Insufficient balance for commitment");
            return None;
        }

        // Create swap details with random nonce
        let details = SwapDetails::new(amount_in, min_out, slippage_bps);
        
        // Compute hash
        let hash = hash_swap_details(&details);

        // Store commitment
        self.commitment_state = CommitmentState::Committed {
            hash,
            details,
            a_to_b,
            commit_slot: self.current_slot,
        };

        info!(
            "Commitment created: hash={}, amount={}, direction={}",
            hex::encode(&hash[..8]),
            amount_in,
            if a_to_b { "A->B" } else { "B->A" }
        );

        Some(hash)
    }

    /// Reveal and execute the trade (Phase 2 of commit-reveal)
    /// 
    /// This must be called after at least 1 slot has passed.
    /// The reveal verifies the hash matches and executes atomically.
    pub fn reveal_and_execute(&mut self, pool: &mut PoolState) -> Option<ProtectedTradeResult> {
        let timestamp = chrono::Utc::now().timestamp();

        // Extract commitment details
        let (hash, details, a_to_b, commit_slot) = match &self.commitment_state {
            CommitmentState::Committed { hash, details, a_to_b, commit_slot } => {
                (*hash, details.clone(), *a_to_b, *commit_slot)
            }
            _ => {
                debug!("No active commitment to reveal");
                return None;
            }
        };

        // Check if enough slots have passed (minimum 1)
        let slots_waited = self.current_slot.saturating_sub(commit_slot);
        if slots_waited < 1 {
            debug!("Must wait at least 1 slot before reveal");
            return None;
        }

        // Verify hash matches
        let computed_hash = hash_swap_details(&details);
        if computed_hash != hash {
            debug!("Hash mismatch!");
            return None;
        }

        // Deduct input
        if a_to_b {
            if self.balance_a < details.amount_in {
                return None;
            }
            self.balance_a -= details.amount_in;
        } else {
            if self.balance_b < details.amount_in {
                return None;
            }
            self.balance_b -= details.amount_in;
        }

        // Calculate expected output BEFORE any manipulation
        // (This is what the user expects based on current pool state)
        let expected_out = pool.calculate_swap_output(details.amount_in, a_to_b).amount_out;

        // Execute swap
        let result = pool.apply_swap(details.amount_in, a_to_b);

        // Credit output
        if a_to_b {
            self.balance_b += result.amount_out;
        } else {
            self.balance_a += result.amount_out;
        }

        // Update state
        self.commitment_state = CommitmentState::Revealed;
        self.total_trades += 1;

        // Slippage should be minimal (only from fee, no MEV)
        let slippage_loss = expected_out.saturating_sub(result.amount_out);

        info!(
            "Reveal executed: expected={}, actual={}, loss={}",
            expected_out, result.amount_out, slippage_loss
        );

        let trade = TradeResult {
            signature: format!("protected_reveal_{}", self.total_trades),
            trader: self.keypair.pubkey().to_string(),
            amount_in: details.amount_in,
            a_to_b,
            expected_out,
            actual_out: result.amount_out,
            slippage_loss,
            was_attacked: false, // Protected trades cannot be attacked
            fee_paid: result.fee,
            price_impact_bps: result.price_impact_bps,
            timestamp,
        };

        Some(ProtectedTradeResult {
            commit_sig: format!("protected_commit_{}", self.total_trades),
            reveal_sig: format!("protected_reveal_{}", self.total_trades),
            trade,
            slots_waited,
            commitment_hash: hex::encode(hash),
        })
    }

    /// Execute a complete protected trade (commit + wait + reveal)
    /// 
    /// This is a convenience method that simulates the full flow.
    pub fn execute_protected_trade(
        &mut self,
        amount: u64,
        a_to_b: bool,
        pool: &mut PoolState,
        slippage_bps: u16,
    ) -> Option<ProtectedTradeResult> {
        // Calculate min_out with slippage
        let min_out = pool.calculate_min_output(amount, a_to_b, slippage_bps);

        // Phase 1: Commit
        let _hash = self.commit(amount, min_out, slippage_bps, a_to_b)?;

        // Simulate waiting for 1 slot
        self.advance_slot();

        // Phase 2: Reveal and execute
        self.reveal_and_execute(pool)
    }

    /// Advance the simulated slot counter
    pub fn advance_slot(&mut self) {
        self.current_slot += 1;
    }

    /// Set the current slot
    pub fn set_slot(&mut self, slot: u64) {
        self.current_slot = slot;
    }

    /// Cancel an active commitment
    pub fn cancel_commitment(&mut self) {
        if self.has_commitment() {
            info!("Commitment cancelled");
            self.commitment_state = CommitmentState::None;
        }
    }

    /// Reset trader state
    pub fn reset(&mut self, balance_a: u64, balance_b: u64) {
        self.balance_a = balance_a;
        self.balance_b = balance_b;
        self.commitment_state = CommitmentState::None;
        self.total_trades = 0;
        self.current_slot = 0;
    }
}

/// Helper to encode bytes as hex
mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes.as_ref().iter().map(|b| format!("{:02x}", b)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protected_trade() {
        let keypair = Keypair::new();
        let mut trader = ProtectedTrader::new(
            keypair,
            50_000_000_000,  // 50 SOL
            50_000_000_000,  // 50 secuSOL
        );

        let mut pool = PoolState::new(
            1_000_000_000_000,  // 1000 SOL
            1_000_000_000_000,  // 1000 secuSOL
            30,
        );

        let result = trader.execute_protected_trade(
            1_000_000_000,  // 1 SOL
            true,           // SOL -> secuSOL
            &mut pool,
            100,            // 1% slippage
        );

        assert!(result.is_some());
        let trade = result.unwrap();
        
        // Protected trade should not be attacked
        assert!(!trade.trade.was_attacked);
        
        println!("Expected: {}", trade.trade.expected_out);
        println!("Actual: {}", trade.trade.actual_out);
        println!("Loss: {}", trade.trade.slippage_loss);
    }

    #[test]
    fn test_commit_reveal_flow() {
        let keypair = Keypair::new();
        let mut trader = ProtectedTrader::new(keypair, 50_000_000_000, 50_000_000_000);
        let mut pool = PoolState::new(1_000_000_000_000, 1_000_000_000_000, 30);

        // Phase 1: Commit
        let hash = trader.commit(1_000_000_000, 900_000_000, 100, true);
        assert!(hash.is_some());
        assert!(trader.has_commitment());

        // Try to reveal too early (should fail)
        let early_result = trader.reveal_and_execute(&mut pool);
        assert!(early_result.is_none());

        // Advance slot
        trader.advance_slot();

        // Now reveal should work
        let result = trader.reveal_and_execute(&mut pool);
        assert!(result.is_some());
    }
}

