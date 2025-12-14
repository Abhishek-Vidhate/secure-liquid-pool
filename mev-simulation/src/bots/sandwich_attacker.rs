//! Sandwich Attack Bot
//!
//! Implements MEV sandwich attacks on AMM swaps.
//! This bot front-runs victim transactions to extract value.

use crate::utils::amm_math::{PoolState, SandwichCalculation};
use serde::{Deserialize, Serialize};
use solana_sdk::{
    pubkey::Pubkey,
    signature::Keypair,
    signer::Signer,
};
use tracing::{debug, info};

/// Result of a sandwich attack attempt
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandwichResult {
    /// Transaction ID of the front-run
    pub frontrun_sig: Option<String>,
    /// Transaction ID of the victim's trade
    pub victim_sig: Option<String>,
    /// Transaction ID of the back-run
    pub backrun_sig: Option<String>,
    /// Net profit in lamports (can be negative)
    pub profit_lamports: i64,
    /// Victim's loss in lamports due to the attack
    pub victim_loss_lamports: u64,
    /// Amount used for front-run
    pub frontrun_amount: u64,
    /// Amount received from front-run
    pub frontrun_received: u64,
    /// Amount used for back-run
    pub backrun_amount: u64,
    /// Amount received from back-run
    pub backrun_received: u64,
    /// Whether the attack was successful (profitable)
    pub success: bool,
    /// Timestamp of the attack
    pub timestamp: i64,
}

impl SandwichResult {
    /// Create a failed/skipped result
    pub fn skipped() -> Self {
        Self {
            frontrun_sig: None,
            victim_sig: None,
            backrun_sig: None,
            profit_lamports: 0,
            victim_loss_lamports: 0,
            frontrun_amount: 0,
            frontrun_received: 0,
            backrun_amount: 0,
            backrun_received: 0,
            success: false,
            timestamp: chrono::Utc::now().timestamp(),
        }
    }
}

/// Pending swap transaction that the attacker can see
#[derive(Debug, Clone)]
pub struct PendingSwap {
    /// Amount of input tokens
    pub amount_in: u64,
    /// Direction: true = A to B (SOL -> secuSOL)
    pub a_to_b: bool,
    /// Victim's public key
    pub victim: Pubkey,
    /// Minimum output expected by victim
    pub min_out: u64,
}

/// Sandwich attack bot
pub struct SandwichAttacker {
    /// Attacker's keypair
    keypair: Keypair,
    /// Current balance of token A (SOL)
    balance_a: u64,
    /// Current balance of token B (secuSOL)
    balance_b: u64,
    /// Total profit accumulated
    total_profit: i64,
    /// Number of successful attacks
    successful_attacks: u32,
    /// Number of failed attacks
    failed_attacks: u32,
}

impl SandwichAttacker {
    /// Create a new sandwich attacker
    pub fn new(keypair: Keypair, initial_capital_a: u64, initial_capital_b: u64) -> Self {
        info!("Sandwich attacker initialized: {}", keypair.pubkey());
        info!("  Capital A (SOL): {} lamports", initial_capital_a);
        info!("  Capital B (secuSOL): {} lamports", initial_capital_b);
        
        Self {
            keypair,
            balance_a: initial_capital_a,
            balance_b: initial_capital_b,
            total_profit: 0,
            successful_attacks: 0,
            failed_attacks: 0,
        }
    }

    /// Get attacker's public key
    pub fn pubkey(&self) -> Pubkey {
        self.keypair.pubkey()
    }

    /// Get current balances
    pub fn balances(&self) -> (u64, u64) {
        (self.balance_a, self.balance_b)
    }

    /// Get statistics
    pub fn stats(&self) -> (i64, u32, u32) {
        (self.total_profit, self.successful_attacks, self.failed_attacks)
    }

    /// Analyze a pending swap and decide whether to attack
    pub fn should_attack(&self, pending: &PendingSwap, pool: &PoolState) -> Option<SandwichCalculation> {
        // Calculate potential profit
        let max_capital = if pending.a_to_b {
            self.balance_a
        } else {
            self.balance_b
        };

        if max_capital == 0 {
            debug!("No capital available for attack");
            return None;
        }

        let calc = pool.calculate_optimal_frontrun(
            pending.amount_in,
            pending.a_to_b,
            max_capital,
        );

        // Only attack if profitable
        if calc.expected_profit > 0 {
            debug!("Profitable sandwich found: {} lamports profit", calc.expected_profit);
            Some(calc)
        } else {
            debug!("Sandwich not profitable, skipping");
            None
        }
    }

    /// Execute a sandwich attack (simulation mode - updates local state)
    /// 
    /// In a real implementation, this would:
    /// 1. Submit front-run transaction
    /// 2. Wait for victim transaction to land
    /// 3. Submit back-run transaction
    /// 
    /// In simulation, we calculate the outcome deterministically.
    pub fn execute_sandwich(
        &mut self,
        pending: &PendingSwap,
        pool: &mut PoolState,
    ) -> SandwichResult {
        let timestamp = chrono::Utc::now().timestamp();
        
        // Calculate optimal attack
        let max_capital = if pending.a_to_b {
            self.balance_a
        } else {
            self.balance_b
        };

        let calc = pool.calculate_optimal_frontrun(
            pending.amount_in,
            pending.a_to_b,
            max_capital,
        );

        if calc.frontrun_amount == 0 || calc.expected_profit <= 0 {
            self.failed_attacks += 1;
            return SandwichResult::skipped();
        }

        // Store pre-attack state
        let victim_expected = pool.calculate_swap_output(pending.amount_in, pending.a_to_b);

        // === EXECUTE FRONT-RUN ===
        debug!("Front-running with {} lamports", calc.frontrun_amount);
        
        // Deduct from attacker's balance
        if pending.a_to_b {
            if self.balance_a < calc.frontrun_amount {
                self.failed_attacks += 1;
                return SandwichResult::skipped();
            }
            self.balance_a -= calc.frontrun_amount;
        } else {
            if self.balance_b < calc.frontrun_amount {
                self.failed_attacks += 1;
                return SandwichResult::skipped();
            }
            self.balance_b -= calc.frontrun_amount;
        }

        // Execute front-run swap
        let frontrun_result = pool.apply_swap(calc.frontrun_amount, pending.a_to_b);
        
        // Credit received tokens
        if pending.a_to_b {
            self.balance_b += frontrun_result.amount_out;
        } else {
            self.balance_a += frontrun_result.amount_out;
        }

        // === VICTIM TRANSACTION ===
        debug!("Victim swap: {} lamports", pending.amount_in);
        let victim_result = pool.apply_swap(pending.amount_in, pending.a_to_b);
        let victim_actual = victim_result.amount_out;
        let victim_loss = victim_expected.amount_out.saturating_sub(victim_actual);

        // === EXECUTE BACK-RUN ===
        // Sell what we got from front-run
        let backrun_amount = frontrun_result.amount_out;
        debug!("Back-running with {} lamports", backrun_amount);

        // Deduct from attacker's balance
        if pending.a_to_b {
            // We got B tokens from front-run, sell them for A
            if self.balance_b < backrun_amount {
                // This shouldn't happen, but handle it
                self.failed_attacks += 1;
                return SandwichResult {
                    frontrun_sig: Some("simulated_frontrun".to_string()),
                    victim_sig: Some("simulated_victim".to_string()),
                    backrun_sig: None,
                    profit_lamports: -(calc.frontrun_amount as i64),
                    victim_loss_lamports: victim_loss,
                    frontrun_amount: calc.frontrun_amount,
                    frontrun_received: frontrun_result.amount_out,
                    backrun_amount: 0,
                    backrun_received: 0,
                    success: false,
                    timestamp,
                };
            }
            self.balance_b -= backrun_amount;
        } else {
            // We got A tokens from front-run, sell them for B
            if self.balance_a < backrun_amount {
                self.failed_attacks += 1;
                return SandwichResult {
                    frontrun_sig: Some("simulated_frontrun".to_string()),
                    victim_sig: Some("simulated_victim".to_string()),
                    backrun_sig: None,
                    profit_lamports: -(calc.frontrun_amount as i64),
                    victim_loss_lamports: victim_loss,
                    frontrun_amount: calc.frontrun_amount,
                    frontrun_received: frontrun_result.amount_out,
                    backrun_amount: 0,
                    backrun_received: 0,
                    success: false,
                    timestamp,
                };
            }
            self.balance_a -= backrun_amount;
        }

        // Execute back-run swap (opposite direction)
        let backrun_result = pool.apply_swap(backrun_amount, !pending.a_to_b);

        // Credit received tokens
        if pending.a_to_b {
            // Back-run: B -> A, we get A tokens back
            self.balance_a += backrun_result.amount_out;
        } else {
            // Back-run: A -> B, we get B tokens back
            self.balance_b += backrun_result.amount_out;
        }

        // === CALCULATE PROFIT ===
        let profit = (backrun_result.amount_out as i64) - (calc.frontrun_amount as i64);
        self.total_profit += profit;

        let success = profit > 0;
        if success {
            self.successful_attacks += 1;
            info!("Sandwich successful! Profit: {} lamports", profit);
        } else {
            self.failed_attacks += 1;
            info!("Sandwich failed. Loss: {} lamports", -profit);
        }

        SandwichResult {
            frontrun_sig: Some("simulated_frontrun".to_string()),
            victim_sig: Some("simulated_victim".to_string()),
            backrun_sig: Some("simulated_backrun".to_string()),
            profit_lamports: profit,
            victim_loss_lamports: victim_loss,
            frontrun_amount: calc.frontrun_amount,
            frontrun_received: frontrun_result.amount_out,
            backrun_amount,
            backrun_received: backrun_result.amount_out,
            success,
            timestamp,
        }
    }

    /// Reset the attacker's state (for running multiple simulations)
    pub fn reset(&mut self, capital_a: u64, capital_b: u64) {
        self.balance_a = capital_a;
        self.balance_b = capital_b;
        self.total_profit = 0;
        self.successful_attacks = 0;
        self.failed_attacks = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sandwich_attack() {
        let keypair = Keypair::new();
        let mut attacker = SandwichAttacker::new(
            keypair,
            100_000_000_000,  // 100 SOL
            100_000_000_000,  // 100 secuSOL
        );

        let mut pool = PoolState::new(
            1_000_000_000_000,  // 1000 SOL
            1_000_000_000_000,  // 1000 secuSOL
            30,  // 0.3% fee
        );

        let pending = PendingSwap {
            amount_in: 10_000_000_000,  // 10 SOL
            a_to_b: true,
            victim: Pubkey::new_unique(),
            min_out: 0,
        };

        let result = attacker.execute_sandwich(&pending, &mut pool);
        
        println!("Profit: {} lamports", result.profit_lamports);
        println!("Victim loss: {} lamports", result.victim_loss_lamports);
        println!("Success: {}", result.success);
        
        // The attack should cause some victim loss
        assert!(result.victim_loss_lamports > 0);
    }
}

