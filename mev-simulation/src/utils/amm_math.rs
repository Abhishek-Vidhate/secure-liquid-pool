//! AMM Math Utilities
//!
//! Implements constant-product (x * y = k) AMM calculations
//! matching the on-chain AMM program logic.

use serde::{Deserialize, Serialize};

/// Represents the current state of an AMM pool
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolState {
    /// Reserve of token A (SOL/wSOL) in lamports
    pub reserve_a: u64,
    /// Reserve of token B (secuSOL) in lamports
    pub reserve_b: u64,
    /// Fee in basis points (e.g., 30 = 0.3%)
    pub fee_bps: u16,
    /// Total LP token supply
    pub total_lp_supply: u64,
}

/// Result of a swap calculation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapResult {
    /// Amount of output tokens
    pub amount_out: u64,
    /// Fee charged in input tokens
    pub fee: u64,
    /// Price impact in basis points
    pub price_impact_bps: u64,
}

/// Result of a sandwich attack calculation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandwichCalculation {
    /// Optimal front-run amount
    pub frontrun_amount: u64,
    /// Expected profit from the sandwich
    pub expected_profit: i64,
    /// Victim's loss due to the sandwich
    pub victim_loss: u64,
    /// Tokens received from front-run
    pub frontrun_output: u64,
    /// Tokens needed to back-run
    pub backrun_input: u64,
    /// Final tokens after back-run
    pub backrun_output: u64,
}

impl PoolState {
    /// Create a new pool state
    pub fn new(reserve_a: u64, reserve_b: u64, fee_bps: u16) -> Self {
        Self {
            reserve_a,
            reserve_b,
            fee_bps,
            total_lp_supply: 0,
        }
    }

    /// Calculate the constant product k
    pub fn k(&self) -> u128 {
        (self.reserve_a as u128) * (self.reserve_b as u128)
    }

    /// Calculate the current price of A in terms of B
    pub fn price_a_in_b(&self) -> f64 {
        if self.reserve_a == 0 {
            return 0.0;
        }
        self.reserve_b as f64 / self.reserve_a as f64
    }

    /// Calculate the current price of B in terms of A
    pub fn price_b_in_a(&self) -> f64 {
        if self.reserve_b == 0 {
            return 0.0;
        }
        self.reserve_a as f64 / self.reserve_b as f64
    }

    /// Calculate output amount for a swap using constant product formula
    /// 
    /// Formula: amount_out = (amount_in_after_fee * reserve_out) / (reserve_in + amount_in_after_fee)
    pub fn calculate_swap_output(&self, amount_in: u64, a_to_b: bool) -> SwapResult {
        let (reserve_in, reserve_out) = if a_to_b {
            (self.reserve_a, self.reserve_b)
        } else {
            (self.reserve_b, self.reserve_a)
        };

        // Calculate fee
        let fee = ((amount_in as u128) * (self.fee_bps as u128) / 10000) as u64;
        let amount_in_after_fee = amount_in.saturating_sub(fee);

        if reserve_in == 0 || reserve_out == 0 {
            return SwapResult {
                amount_out: 0,
                fee,
                price_impact_bps: 10000, // 100% impact if no liquidity
            };
        }

        // Constant product formula
        let numerator = (amount_in_after_fee as u128) * (reserve_out as u128);
        let denominator = (reserve_in as u128) + (amount_in_after_fee as u128);
        let amount_out = (numerator / denominator) as u64;

        // Calculate price impact
        // Ideal output (no impact) = amount_in_after_fee * (reserve_out / reserve_in)
        let ideal_output = ((amount_in_after_fee as u128) * (reserve_out as u128) 
            / (reserve_in as u128)) as u64;
        
        let price_impact_bps = if ideal_output > 0 {
            ((ideal_output.saturating_sub(amount_out)) as u128 * 10000 / ideal_output as u128) as u64
        } else {
            0
        };

        SwapResult {
            amount_out,
            fee,
            price_impact_bps,
        }
    }

    /// Apply a swap to the pool state (mutates reserves)
    pub fn apply_swap(&mut self, amount_in: u64, a_to_b: bool) -> SwapResult {
        let result = self.calculate_swap_output(amount_in, a_to_b);
        
        if a_to_b {
            self.reserve_a = self.reserve_a.saturating_add(amount_in);
            self.reserve_b = self.reserve_b.saturating_sub(result.amount_out);
        } else {
            self.reserve_b = self.reserve_b.saturating_add(amount_in);
            self.reserve_a = self.reserve_a.saturating_sub(result.amount_out);
        }
        
        result
    }

    /// Calculate the optimal front-run amount for a sandwich attack
    /// 
    /// The optimal front-run maximizes: profit = backrun_output - frontrun_input
    /// 
    /// Using a simplified heuristic: frontrun ~ sqrt(victim_amount * reserve_in) - reserve_in
    /// But capped at a fraction of victim amount and attacker capital
    pub fn calculate_optimal_frontrun(
        &self,
        victim_amount: u64,
        a_to_b: bool,
        max_attacker_capital: u64,
    ) -> SandwichCalculation {
        let reserve_in = if a_to_b {
            self.reserve_a
        } else {
            self.reserve_b
        };

        // Calculate what victim would get without attack
        let victim_no_attack = self.calculate_swap_output(victim_amount, a_to_b);
        
        // Heuristic: front-run with ~30-50% of victim's amount
        // This is a simplification; real MEV bots use more sophisticated optimization
        let mut frontrun_amount = victim_amount / 2;
        
        // Cap at attacker's capital
        frontrun_amount = frontrun_amount.min(max_attacker_capital);
        
        // Cap at a reasonable fraction of reserve to avoid excessive price impact
        frontrun_amount = frontrun_amount.min(reserve_in / 10);

        if frontrun_amount == 0 {
            return SandwichCalculation {
                frontrun_amount: 0,
                expected_profit: 0,
                victim_loss: 0,
                frontrun_output: 0,
                backrun_input: 0,
                backrun_output: 0,
            };
        }

        // Simulate the sandwich attack
        let mut sim_pool = self.clone();
        
        // 1. Front-run: attacker swaps in same direction as victim
        let frontrun_result = sim_pool.apply_swap(frontrun_amount, a_to_b);
        let frontrun_output = frontrun_result.amount_out;
        
        // 2. Victim's swap (at worse price)
        let victim_result = sim_pool.apply_swap(victim_amount, a_to_b);
        let victim_actual = victim_result.amount_out;
        
        // 3. Back-run: attacker swaps back (opposite direction)
        let backrun_input = frontrun_output; // Sell what we got from front-run
        let backrun_result = sim_pool.apply_swap(backrun_input, !a_to_b);
        let backrun_output = backrun_result.amount_out;
        
        // Calculate profit (can be negative if attack fails)
        let profit = (backrun_output as i64) - (frontrun_amount as i64);
        
        // Calculate victim's loss
        let victim_loss = victim_no_attack.amount_out.saturating_sub(victim_actual);

        SandwichCalculation {
            frontrun_amount,
            expected_profit: profit,
            victim_loss,
            frontrun_output,
            backrun_input,
            backrun_output,
        }
    }

    /// Calculate minimum output with slippage tolerance
    pub fn calculate_min_output(&self, amount_in: u64, a_to_b: bool, slippage_bps: u16) -> u64 {
        let result = self.calculate_swap_output(amount_in, a_to_b);
        let slippage = (result.amount_out as u128 * slippage_bps as u128 / 10000) as u64;
        result.amount_out.saturating_sub(slippage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_swap_calculation() {
        let pool = PoolState::new(
            1_000_000_000_000, // 1000 SOL
            1_000_000_000_000, // 1000 secuSOL
            30, // 0.3% fee
        );

        // Swap 1 SOL for secuSOL
        let result = pool.calculate_swap_output(1_000_000_000, true);
        
        // Should get slightly less than 1 secuSOL due to fee and price impact
        assert!(result.amount_out < 1_000_000_000);
        assert!(result.amount_out > 900_000_000);
        assert!(result.fee > 0);
    }

    #[test]
    fn test_sandwich_calculation() {
        let pool = PoolState::new(
            1_000_000_000_000, // 1000 SOL
            1_000_000_000_000, // 1000 secuSOL
            30, // 0.3% fee
        );

        // Victim wants to swap 10 SOL
        let victim_amount = 10_000_000_000;
        let attacker_capital = 100_000_000_000;

        let sandwich = pool.calculate_optimal_frontrun(victim_amount, true, attacker_capital);
        
        // Sandwich should be profitable (in most cases)
        assert!(sandwich.frontrun_amount > 0);
        assert!(sandwich.victim_loss > 0);
        
        println!("Frontrun: {} lamports", sandwich.frontrun_amount);
        println!("Expected profit: {} lamports", sandwich.expected_profit);
        println!("Victim loss: {} lamports", sandwich.victim_loss);
    }
}

