//! Simulation configuration

use serde::{Deserialize, Serialize};
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

/// Program IDs for the deployed Solana programs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgramIds {
    pub stake_pool: Pubkey,
    pub amm: Pubkey,
    pub securelp: Pubkey,
}

impl Default for ProgramIds {
    fn default() -> Self {
        Self {
            stake_pool: Pubkey::from_str("EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7").unwrap(),
            amm: Pubkey::from_str("AcaXW2nDrvkpmuZnuiARDRJzmmfT1AZwLm4SMeYwnXKS").unwrap(),
            securelp: Pubkey::from_str("BMxQAdqNJE3Zn6iJedc6A6XbsSTmNBQi6UzFdfrNvE21").unwrap(),
        }
    }
}

/// Main simulation configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationConfig {
    /// Total number of transactions to simulate
    pub total_transactions: u32,
    
    /// Probability that the attacker will attempt to sandwich a trade (0.0 - 1.0)
    pub attack_probability: f64,
    
    /// Minimum swap amount in lamports (0.1 SOL = 100_000_000)
    pub min_swap_lamports: u64,
    
    /// Maximum swap amount in lamports (5 SOL = 5_000_000_000)
    pub max_swap_lamports: u64,
    
    /// Initial pool reserve for token A (SOL/wSOL) in lamports
    pub initial_pool_a: u64,
    
    /// Initial pool reserve for token B (secuSOL) in lamports
    pub initial_pool_b: u64,
    
    /// AMM fee in basis points (30 = 0.3%)
    pub fee_bps: u16,
    
    /// Attacker's initial capital in lamports
    pub attacker_capital: u64,
    
    /// Number of victim wallets to create
    pub num_victims: u32,
    
    /// Initial SOL per victim wallet in lamports
    pub victim_sol: u64,
    
    /// Initial secuSOL per victim wallet in lamports  
    pub victim_secusol: u64,
    
    /// RPC endpoint URL
    pub rpc_url: String,
    
    /// Program IDs
    pub programs: ProgramIds,
    
    /// Output directory for logs and reports
    pub output_dir: String,
}

impl Default for SimulationConfig {
    fn default() -> Self {
        Self {
            total_transactions: 1000,
            attack_probability: 0.8,
            min_swap_lamports: 100_000_000,      // 0.1 SOL
            max_swap_lamports: 5_000_000_000,    // 5 SOL
            initial_pool_a: 1000_000_000_000,    // 1000 SOL
            initial_pool_b: 1000_000_000_000,    // 1000 secuSOL
            fee_bps: 30,                          // 0.3%
            attacker_capital: 100_000_000_000,   // 100 SOL
            num_victims: 10,
            victim_sol: 50_000_000_000,          // 50 SOL
            victim_secusol: 50_000_000_000,      // 50 secuSOL
            rpc_url: "http://127.0.0.1:8899".to_string(),
            programs: ProgramIds::default(),
            output_dir: "output".to_string(),
        }
    }
}

impl SimulationConfig {
    /// Create config for localnet testing
    pub fn localnet() -> Self {
        Self {
            rpc_url: "http://127.0.0.1:8899".to_string(),
            ..Default::default()
        }
    }
    
    /// Create config for a quick test run
    pub fn quick_test() -> Self {
        Self {
            total_transactions: 100,
            ..Self::localnet()
        }
    }
}

/// Constants for seeds used in PDA derivation
pub mod seeds {
    pub const POOL_CONFIG_SEED: &[u8] = b"pool_config";
    pub const AMM_POOL_SEED: &[u8] = b"amm_pool";
    pub const AMM_AUTHORITY_SEED: &[u8] = b"amm_authority";
    pub const VAULT_A_SEED: &[u8] = b"vault_a";
    pub const VAULT_B_SEED: &[u8] = b"vault_b";
    pub const COMMITMENT_SEED: &[u8] = b"commit";
}

