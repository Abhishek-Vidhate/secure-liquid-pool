//! Normal Trader Bot
//!
//! Simulates a regular user making direct AMM swaps.
//! These trades are vulnerable to MEV sandwich attacks.

use crate::utils::amm_math::PoolState;
use serde::{Deserialize, Serialize};
use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer};
use tracing::debug;

/// Result of a normal trade
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeResult {
    /// Transaction signature (simulated)
    pub signature: String,
    /// Trader's public key
    pub trader: String,
    /// Amount of input tokens
    pub amount_in: u64,
    /// Direction: true = A to B (SOL -> secuSOL)
    pub a_to_b: bool,
    /// Expected output (calculated before trade)
    pub expected_out: u64,
    /// Actual output received
    pub actual_out: u64,
    /// Loss due to slippage/MEV (expected - actual)
    pub slippage_loss: u64,
    /// Whether this trade was attacked
    pub was_attacked: bool,
    /// Fee paid
    pub fee_paid: u64,
    /// Price impact in basis points
    pub price_impact_bps: u64,
    /// Timestamp
    pub timestamp: i64,
}

impl TradeResult {
    /// Calculate loss percentage
    pub fn loss_percentage(&self) -> f64 {
        if self.expected_out == 0 {
            return 0.0;
        }
        (self.slippage_loss as f64 / self.expected_out as f64) * 100.0
    }
}

/// Normal trader that makes direct AMM swaps
pub struct NormalTrader {
    /// Trader's keypair
    keypair: Keypair,
    /// Current balance of token A (SOL)
    balance_a: u64,
    /// Current balance of token B (secuSOL)
    balance_b: u64,
    /// Total trades executed
    total_trades: u32,
    /// Total losses from MEV
    total_loss: u64,
}

impl NormalTrader {
    /// Create a new normal trader
    pub fn new(keypair: Keypair, initial_balance_a: u64, initial_balance_b: u64) -> Self {
        Self {
            keypair,
            balance_a: initial_balance_a,
            balance_b: initial_balance_b,
            total_trades: 0,
            total_loss: 0,
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

    /// Get statistics
    pub fn stats(&self) -> (u32, u64) {
        (self.total_trades, self.total_loss)
    }

    /// Check if trader has sufficient balance for a swap
    pub fn can_trade(&self, amount: u64, a_to_b: bool) -> bool {
        if a_to_b {
            self.balance_a >= amount
        } else {
            self.balance_b >= amount
        }
    }

    /// Calculate expected output for a trade (before execution)
    pub fn calculate_expected(&self, amount: u64, a_to_b: bool, pool: &PoolState) -> u64 {
        pool.calculate_swap_output(amount, a_to_b).amount_out
    }

    /// Execute a trade on the AMM
    /// 
    /// In a real implementation, this would build and submit a transaction.
    /// In simulation, we update local state based on pool math.
    pub fn execute_trade(
        &mut self,
        amount: u64,
        a_to_b: bool,
        pool: &mut PoolState,
        expected_out: u64,
        was_attacked: bool,
    ) -> Option<TradeResult> {
        let timestamp = chrono::Utc::now().timestamp();

        // Check balance
        if !self.can_trade(amount, a_to_b) {
            debug!("Insufficient balance for trade");
            return None;
        }

        // Deduct input
        if a_to_b {
            self.balance_a -= amount;
        } else {
            self.balance_b -= amount;
        }

        // Execute swap
        let result = pool.apply_swap(amount, a_to_b);

        // Credit output
        if a_to_b {
            self.balance_b += result.amount_out;
        } else {
            self.balance_a += result.amount_out;
        }

        // Calculate loss
        let slippage_loss = expected_out.saturating_sub(result.amount_out);
        self.total_loss += slippage_loss;
        self.total_trades += 1;

        Some(TradeResult {
            signature: format!("simulated_trade_{}", self.total_trades),
            trader: self.keypair.pubkey().to_string(),
            amount_in: amount,
            a_to_b,
            expected_out,
            actual_out: result.amount_out,
            slippage_loss,
            was_attacked,
            fee_paid: result.fee,
            price_impact_bps: result.price_impact_bps,
            timestamp,
        })
    }

    /// Reset trader state
    pub fn reset(&mut self, balance_a: u64, balance_b: u64) {
        self.balance_a = balance_a;
        self.balance_b = balance_b;
        self.total_trades = 0;
        self.total_loss = 0;
    }
}

/// Generate a random trade amount within the configured range
pub fn random_trade_amount(min: u64, max: u64) -> u64 {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    rng.gen_range(min..=max)
}

/// Generate a random trade direction
pub fn random_direction() -> bool {
    use rand::Rng;
    rand::thread_rng().gen_bool(0.5)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normal_trade() {
        let keypair = Keypair::new();
        let mut trader = NormalTrader::new(
            keypair,
            50_000_000_000,  // 50 SOL
            50_000_000_000,  // 50 secuSOL
        );

        let mut pool = PoolState::new(
            1_000_000_000_000,  // 1000 SOL
            1_000_000_000_000,  // 1000 secuSOL
            30,
        );

        let amount = 1_000_000_000; // 1 SOL
        let expected = trader.calculate_expected(amount, true, &pool);
        
        let result = trader.execute_trade(amount, true, &mut pool, expected, false);
        
        assert!(result.is_some());
        let trade = result.unwrap();
        
        // Actual should be close to expected (small difference due to pool state)
        println!("Expected: {}, Actual: {}", trade.expected_out, trade.actual_out);
        assert!(trade.actual_out > 0);
    }
}

