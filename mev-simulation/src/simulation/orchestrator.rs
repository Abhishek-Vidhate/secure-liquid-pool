//! Simulation Orchestrator
//!
//! Controls the flow of the MEV simulation, running both scenarios
//! (vulnerable normal trading vs protected commit-reveal) and collecting results.

use crate::bots::{
    normal_trader::{NormalTrader, TradeResult, random_trade_amount, random_direction},
    protected_trader::ProtectedTrader,
    sandwich_attacker::{SandwichAttacker, SandwichResult, PendingSwap},
};
use crate::config::SimulationConfig;
use crate::simulation::pool_state::SimulatedPool;
use anyhow::Result;
use rand::Rng;
use serde::{Deserialize, Serialize};
use solana_sdk::signature::Keypair;
#[allow(unused_imports)]
use solana_sdk::signer::Signer;
use tracing::{info, debug};

/// Results of the complete simulation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationResults {
    /// Configuration used
    pub config: SimulationConfigSummary,
    /// Results from normal (vulnerable) trades
    pub normal_trades: Vec<TradeResult>,
    /// Results from protected trades
    pub protected_trades: Vec<TradeResult>,
    /// Sandwich attack results
    pub sandwich_results: Vec<SandwichResult>,
    /// Summary statistics
    pub summary: SimulationSummary,
    /// Pool state history
    pub pool_history: Vec<PoolStateRecord>,
}

/// Summary of simulation configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationConfigSummary {
    pub total_transactions: u32,
    pub attack_probability: f64,
    pub min_swap_lamports: u64,
    pub max_swap_lamports: u64,
    pub initial_pool_a: u64,
    pub initial_pool_b: u64,
    pub fee_bps: u16,
}

/// Summary statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SimulationSummary {
    /// Total transactions simulated
    pub total_transactions: u32,
    /// Number of attack attempts
    pub attack_attempts: u32,
    /// Number of successful attacks
    pub successful_attacks: u32,
    /// Attack success rate (%)
    pub attack_success_rate: f64,
    /// Total MEV extracted (lamports)
    pub total_mev_extracted: i64,
    /// Total victim losses (lamports)
    pub total_victim_losses: u64,
    /// Average loss per attacked transaction (lamports)
    pub avg_loss_per_attack: f64,
    /// Total protected savings (lamports) - what users saved by using commit-reveal
    pub total_protected_savings: u64,
    /// Average trade amount (lamports)
    pub avg_trade_amount: f64,
    /// Total volume traded (lamports)
    pub total_volume: u64,
}

/// Record of pool state at a point in time
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolStateRecord {
    pub transaction_id: u32,
    pub reserve_a: u64,
    pub reserve_b: u64,
    pub price_a_in_b: f64,
    pub scenario: String,
}

/// Main simulation orchestrator
pub struct Orchestrator {
    /// Configuration
    config: SimulationConfig,
    /// Sandwich attacker bot
    attacker: SandwichAttacker,
    /// Normal trader (for vulnerable scenario)
    normal_traders: Vec<NormalTrader>,
    /// Protected traders (for commit-reveal scenario)
    protected_traders: Vec<ProtectedTrader>,
    /// Simulated pool
    pool: SimulatedPool,
    /// Current transaction counter
    transaction_counter: u32,
}

impl Orchestrator {
    /// Create a new orchestrator with the given configuration
    pub fn new(config: SimulationConfig) -> Self {
        // Create attacker
        let attacker_keypair = Keypair::new();
        let attacker = SandwichAttacker::new(
            attacker_keypair,
            config.attacker_capital,
            config.attacker_capital, // Give attacker both tokens
        );

        // Create normal traders
        let mut normal_traders = Vec::new();
        for _ in 0..config.num_victims {
            let keypair = Keypair::new();
            let trader = NormalTrader::new(
                keypair,
                config.victim_sol,
                config.victim_secusol,
            );
            normal_traders.push(trader);
        }

        // Create protected traders (same balances as normal traders)
        let mut protected_traders = Vec::new();
        for _ in 0..config.num_victims {
            let keypair = Keypair::new();
            let trader = ProtectedTrader::new(
                keypair,
                config.victim_sol,
                config.victim_secusol,
            );
            protected_traders.push(trader);
        }

        // Create pool
        let pool = SimulatedPool::new(
            config.initial_pool_a,
            config.initial_pool_b,
            config.fee_bps,
        );

        Self {
            config,
            attacker,
            normal_traders,
            protected_traders,
            pool,
            transaction_counter: 0,
        }
    }

    /// Run the complete simulation
    pub fn run(&mut self) -> Result<SimulationResults> {
        info!("Starting MEV simulation...");
        info!("Total transactions: {}", self.config.total_transactions);
        info!("Attack probability: {:.0}%", self.config.attack_probability * 100.0);

        let mut normal_trades = Vec::new();
        let mut protected_trades = Vec::new();
        let mut sandwich_results = Vec::new();
        let mut pool_history = Vec::new();

        let mut rng = rand::thread_rng();

        for i in 0..self.config.total_transactions {
            self.transaction_counter = i;

            // Generate random trade parameters
            let amount = random_trade_amount(
                self.config.min_swap_lamports,
                self.config.max_swap_lamports,
            );
            let a_to_b = random_direction();
            let trader_idx = rng.gen_range(0..self.normal_traders.len());

            // Decide if attacker will attempt a sandwich
            let should_attack = rng.gen::<f64>() < self.config.attack_probability;

            // === SCENARIO A: Normal Trading (Vulnerable) ===
            // Save pool state before normal scenario
            let pool_state_before = self.pool.clone_state();

            let normal_trade = self.run_normal_scenario(
                trader_idx,
                amount,
                a_to_b,
                should_attack,
                &mut sandwich_results,
            );

            if let Some(trade) = normal_trade {
                normal_trades.push(trade);
            }

            // Record pool state after normal scenario
            pool_history.push(PoolStateRecord {
                transaction_id: i,
                reserve_a: self.pool.current().reserve_a,
                reserve_b: self.pool.current().reserve_b,
                price_a_in_b: self.pool.price_a_in_b(),
                scenario: "normal".to_string(),
            });

            // === SCENARIO B: Protected Trading (Commit-Reveal) ===
            // Reset pool to same state as before normal scenario
            self.pool.set_state(pool_state_before);

            let protected_trade = self.run_protected_scenario(
                trader_idx,
                amount,
                a_to_b,
            );

            if let Some(trade) = protected_trade {
                protected_trades.push(trade);
            }

            // Record pool state after protected scenario
            pool_history.push(PoolStateRecord {
                transaction_id: i,
                reserve_a: self.pool.current().reserve_a,
                reserve_b: self.pool.current().reserve_b,
                price_a_in_b: self.pool.price_a_in_b(),
                scenario: "protected".to_string(),
            });

            // Progress logging
            if (i + 1) % 100 == 0 || i == 0 {
                info!("Progress: {}/{} transactions", i + 1, self.config.total_transactions);
            }
        }

        // Calculate summary statistics
        let summary = self.calculate_summary(&normal_trades, &protected_trades, &sandwich_results);

        info!("Simulation complete!");
        info!("Total MEV extracted: {} lamports ({:.4} SOL)", 
              summary.total_mev_extracted,
              summary.total_mev_extracted as f64 / 1_000_000_000.0);
        info!("Total victim losses: {} lamports ({:.4} SOL)",
              summary.total_victim_losses,
              summary.total_victim_losses as f64 / 1_000_000_000.0);

        Ok(SimulationResults {
            config: SimulationConfigSummary {
                total_transactions: self.config.total_transactions,
                attack_probability: self.config.attack_probability,
                min_swap_lamports: self.config.min_swap_lamports,
                max_swap_lamports: self.config.max_swap_lamports,
                initial_pool_a: self.config.initial_pool_a,
                initial_pool_b: self.config.initial_pool_b,
                fee_bps: self.config.fee_bps,
            },
            normal_trades,
            protected_trades,
            sandwich_results,
            summary,
            pool_history,
        })
    }

    /// Run the normal (vulnerable) trading scenario
    fn run_normal_scenario(
        &mut self,
        trader_idx: usize,
        amount: u64,
        a_to_b: bool,
        should_attack: bool,
        sandwich_results: &mut Vec<SandwichResult>,
    ) -> Option<TradeResult> {
        let trader = &mut self.normal_traders[trader_idx];

        // Check if trader has sufficient balance
        if !trader.can_trade(amount, a_to_b) {
            debug!("Trader {} has insufficient balance", trader_idx);
            return None;
        }

        // Calculate expected output BEFORE any attack
        let expected_out = trader.calculate_expected(amount, a_to_b, self.pool.current());

        let was_attacked = if should_attack {
            // Create pending swap that attacker can see
            let pending = PendingSwap {
                amount_in: amount,
                a_to_b,
                victim: trader.pubkey(),
                min_out: 0, // Normal trades often don't set this properly
            };

            // Attacker executes sandwich
            let sandwich = self.attacker.execute_sandwich(&pending, self.pool.current_mut());
            
            let attacked = sandwich.success;
            sandwich_results.push(sandwich);
            attacked
        } else {
            // No attack, just execute victim's trade
            let _ = self.pool.current_mut().apply_swap(amount, a_to_b);
            false
        };

        // Now the victim's trade has already been executed as part of the sandwich
        // We just need to record the result
        Some(TradeResult {
            signature: format!("normal_trade_{}", self.transaction_counter),
            trader: trader.pubkey().to_string(),
            amount_in: amount,
            a_to_b,
            expected_out,
            actual_out: if was_attacked {
                // The actual output was calculated during sandwich
                let last_sandwich = sandwich_results.last().unwrap();
                expected_out.saturating_sub(last_sandwich.victim_loss_lamports)
            } else {
                expected_out
            },
            slippage_loss: if was_attacked {
                sandwich_results.last().unwrap().victim_loss_lamports
            } else {
                0
            },
            was_attacked,
            fee_paid: (amount as u128 * self.config.fee_bps as u128 / 10000) as u64,
            price_impact_bps: 0,
            timestamp: chrono::Utc::now().timestamp(),
        })
    }

    /// Run the protected (commit-reveal) trading scenario
    fn run_protected_scenario(
        &mut self,
        trader_idx: usize,
        amount: u64,
        a_to_b: bool,
    ) -> Option<TradeResult> {
        let trader = &mut self.protected_traders[trader_idx];

        // Execute protected trade
        let result = trader.execute_protected_trade(
            amount,
            a_to_b,
            self.pool.current_mut(),
            100, // 1% slippage tolerance
        )?;

        // Return the underlying trade result
        Some(result.trade)
    }

    /// Calculate summary statistics
    fn calculate_summary(
        &self,
        normal_trades: &[TradeResult],
        _protected_trades: &[TradeResult],
        sandwich_results: &[SandwichResult],
    ) -> SimulationSummary {
        let total_transactions = normal_trades.len() as u32;
        let attack_attempts = sandwich_results.len() as u32;
        let successful_attacks = sandwich_results.iter()
            .filter(|s| s.success)
            .count() as u32;

        let attack_success_rate = if attack_attempts > 0 {
            (successful_attacks as f64 / attack_attempts as f64) * 100.0
        } else {
            0.0
        };

        let total_mev_extracted: i64 = sandwich_results.iter()
            .map(|s| s.profit_lamports)
            .sum();

        let total_victim_losses: u64 = sandwich_results.iter()
            .map(|s| s.victim_loss_lamports)
            .sum();

        let avg_loss_per_attack = if successful_attacks > 0 {
            total_victim_losses as f64 / successful_attacks as f64
        } else {
            0.0
        };

        // Protected savings = what victims would have lost without protection
        let total_protected_savings = total_victim_losses;

        let total_volume: u64 = normal_trades.iter()
            .map(|t| t.amount_in)
            .sum();

        let avg_trade_amount = if total_transactions > 0 {
            total_volume as f64 / total_transactions as f64
        } else {
            0.0
        };

        SimulationSummary {
            total_transactions,
            attack_attempts,
            successful_attacks,
            attack_success_rate,
            total_mev_extracted,
            total_victim_losses,
            avg_loss_per_attack,
            total_protected_savings,
            avg_trade_amount,
            total_volume,
        }
    }

    /// Reset the orchestrator for another run
    pub fn reset(&mut self) {
        self.attacker.reset(
            self.config.attacker_capital,
            self.config.attacker_capital,
        );

        for trader in &mut self.normal_traders {
            trader.reset(self.config.victim_sol, self.config.victim_secusol);
        }

        for trader in &mut self.protected_traders {
            trader.reset(self.config.victim_sol, self.config.victim_secusol);
        }

        self.pool.reset();
        self.transaction_counter = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_orchestrator_quick_run() {
        let config = SimulationConfig {
            total_transactions: 10,
            ..SimulationConfig::quick_test()
        };

        let mut orchestrator = Orchestrator::new(config);
        let results = orchestrator.run().unwrap();

        assert_eq!(results.normal_trades.len(), 10);
        assert_eq!(results.protected_trades.len(), 10);
        
        println!("MEV extracted: {} lamports", results.summary.total_mev_extracted);
        println!("Victim losses: {} lamports", results.summary.total_victim_losses);
        println!("Attack success rate: {:.1}%", results.summary.attack_success_rate);
    }
}

