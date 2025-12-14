//! Simulated Pool State Management
//!
//! Tracks pool state throughout the simulation.

use crate::utils::amm_math::PoolState;
use serde::{Deserialize, Serialize};

/// Simulated pool with history tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulatedPool {
    /// Current pool state
    pub state: PoolState,
    /// History of pool states (for analysis)
    pub history: Vec<PoolSnapshot>,
    /// Initial state for resets
    initial_state: PoolState,
}

/// Snapshot of pool state at a point in time
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolSnapshot {
    pub reserve_a: u64,
    pub reserve_b: u64,
    pub timestamp: i64,
    pub transaction_id: u32,
    pub event: String,
}

impl SimulatedPool {
    /// Create a new simulated pool
    pub fn new(reserve_a: u64, reserve_b: u64, fee_bps: u16) -> Self {
        let state = PoolState::new(reserve_a, reserve_b, fee_bps);
        
        Self {
            state: state.clone(),
            history: vec![PoolSnapshot {
                reserve_a,
                reserve_b,
                timestamp: chrono::Utc::now().timestamp(),
                transaction_id: 0,
                event: "initialization".to_string(),
            }],
            initial_state: state,
        }
    }

    /// Get current state
    pub fn current(&self) -> &PoolState {
        &self.state
    }

    /// Get mutable reference to current state
    pub fn current_mut(&mut self) -> &mut PoolState {
        &mut self.state
    }

    /// Record a snapshot
    pub fn snapshot(&mut self, transaction_id: u32, event: &str) {
        self.history.push(PoolSnapshot {
            reserve_a: self.state.reserve_a,
            reserve_b: self.state.reserve_b,
            timestamp: chrono::Utc::now().timestamp(),
            transaction_id,
            event: event.to_string(),
        });
    }

    /// Reset to initial state
    pub fn reset(&mut self) {
        self.state = self.initial_state.clone();
        self.history.clear();
        self.history.push(PoolSnapshot {
            reserve_a: self.state.reserve_a,
            reserve_b: self.state.reserve_b,
            timestamp: chrono::Utc::now().timestamp(),
            transaction_id: 0,
            event: "reset".to_string(),
        });
    }

    /// Clone current state (for A/B comparison)
    pub fn clone_state(&self) -> PoolState {
        self.state.clone()
    }

    /// Set state from a cloned state
    pub fn set_state(&mut self, state: PoolState) {
        self.state = state;
    }

    /// Get price of A in terms of B
    pub fn price_a_in_b(&self) -> f64 {
        self.state.price_a_in_b()
    }

    /// Get price of B in terms of A
    pub fn price_b_in_a(&self) -> f64 {
        self.state.price_b_in_a()
    }

    /// Calculate constant product k
    pub fn k(&self) -> u128 {
        self.state.k()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simulated_pool() {
        let mut pool = SimulatedPool::new(
            1_000_000_000_000,
            1_000_000_000_000,
            30,
        );

        assert_eq!(pool.history.len(), 1);
        
        pool.snapshot(1, "test_swap");
        assert_eq!(pool.history.len(), 2);
        
        pool.reset();
        assert_eq!(pool.history.len(), 1);
    }
}

