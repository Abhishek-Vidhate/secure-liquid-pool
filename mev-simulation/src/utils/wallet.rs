//! Wallet Management Utilities
//!
//! Handles creation and funding of test keypairs for the simulation.

use anyhow::{Context, Result};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    native_token::LAMPORTS_PER_SOL,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction,
    transaction::Transaction,
};
use std::collections::HashMap;
use tracing::{info, warn};

/// Manages test wallets for the simulation
pub struct WalletManager {
    /// RPC client for interacting with the cluster
    rpc_client: RpcClient,
    /// Funding keypair (must have SOL)
    funder: Keypair,
    /// Created wallets
    wallets: HashMap<String, Keypair>,
}

impl WalletManager {
    /// Create a new wallet manager
    pub fn new(rpc_url: &str, funder: Keypair) -> Self {
        let rpc_client = RpcClient::new_with_commitment(
            rpc_url.to_string(),
            CommitmentConfig::confirmed(),
        );
        
        Self {
            rpc_client,
            funder,
            wallets: HashMap::new(),
        }
    }

    /// Get the funder's public key
    pub fn funder_pubkey(&self) -> Pubkey {
        self.funder.pubkey()
    }

    /// Check balance of an account
    pub fn get_balance(&self, pubkey: &Pubkey) -> Result<u64> {
        self.rpc_client
            .get_balance(pubkey)
            .context("Failed to get balance")
    }

    /// Request airdrop (for localnet/devnet)
    pub fn request_airdrop(&self, pubkey: &Pubkey, lamports: u64) -> Result<()> {
        info!("Requesting airdrop of {} SOL to {}", 
              lamports as f64 / LAMPORTS_PER_SOL as f64, 
              pubkey);
        
        let sig = self.rpc_client
            .request_airdrop(pubkey, lamports)
            .context("Airdrop request failed")?;
        
        // Wait for confirmation
        loop {
            let confirmed = self.rpc_client.confirm_transaction(&sig)?;
            if confirmed {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        
        info!("Airdrop confirmed");
        Ok(())
    }

    /// Create a new keypair and store it
    pub fn create_wallet(&mut self, name: &str) -> &Keypair {
        let keypair = Keypair::new();
        info!("Created wallet '{}': {}", name, keypair.pubkey());
        self.wallets.insert(name.to_string(), keypair);
        self.wallets.get(name).unwrap()
    }

    /// Get a wallet by name
    pub fn get_wallet(&self, name: &str) -> Option<&Keypair> {
        self.wallets.get(name)
    }

    /// Fund a wallet with SOL from the funder
    pub fn fund_wallet(&self, recipient: &Pubkey, lamports: u64) -> Result<()> {
        info!("Funding {} with {} SOL", 
              recipient, 
              lamports as f64 / LAMPORTS_PER_SOL as f64);
        
        let ix = system_instruction::transfer(
            &self.funder.pubkey(),
            recipient,
            lamports,
        );
        
        let recent_blockhash = self.rpc_client.get_latest_blockhash()?;
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&self.funder.pubkey()),
            &[&self.funder],
            recent_blockhash,
        );
        
        self.rpc_client
            .send_and_confirm_transaction(&tx)
            .context("Failed to fund wallet")?;
        
        Ok(())
    }

    /// Create and fund multiple victim wallets
    pub fn create_victims(&mut self, count: u32, sol_each: u64) -> Result<Vec<Pubkey>> {
        let mut pubkeys = Vec::new();
        
        for i in 0..count {
            let name = format!("victim_{}", i);
            let wallet = self.create_wallet(&name);
            let pubkey = wallet.pubkey();
            pubkeys.push(pubkey);
            
            // Fund the wallet
            if let Err(e) = self.fund_wallet(&pubkey, sol_each) {
                warn!("Failed to fund victim {}: {}", i, e);
            }
        }
        
        Ok(pubkeys)
    }

    /// Create the attacker wallet
    pub fn create_attacker(&mut self, capital: u64) -> Result<Pubkey> {
        let wallet = self.create_wallet("attacker");
        let pubkey = wallet.pubkey();
        
        self.fund_wallet(&pubkey, capital)?;
        
        Ok(pubkey)
    }

    /// Get all wallets
    pub fn all_wallets(&self) -> &HashMap<String, Keypair> {
        &self.wallets
    }

    /// Setup initial wallets for simulation
    pub fn setup_simulation_wallets(
        &mut self,
        attacker_capital: u64,
        num_victims: u32,
        victim_sol: u64,
    ) -> Result<SimulationWallets> {
        // First, ensure funder has enough SOL
        let funder_balance = self.get_balance(&self.funder.pubkey())?;
        let required = attacker_capital + (num_victims as u64 * victim_sol) + LAMPORTS_PER_SOL;
        
        if funder_balance < required {
            let needed = required - funder_balance;
            info!("Funder needs {} more SOL, requesting airdrop...", 
                  needed as f64 / LAMPORTS_PER_SOL as f64);
            
            // Request in chunks (localnet has limits)
            let chunk_size = 10 * LAMPORTS_PER_SOL;
            let mut remaining = needed;
            while remaining > 0 {
                let amount = remaining.min(chunk_size);
                self.request_airdrop(&self.funder.pubkey(), amount)?;
                remaining = remaining.saturating_sub(amount);
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
        
        // Create attacker
        let attacker = self.create_attacker(attacker_capital)?;
        
        // Create victims
        let victims = self.create_victims(num_victims, victim_sol)?;
        
        Ok(SimulationWallets {
            attacker,
            victims,
        })
    }
}

/// Wallets created for the simulation
pub struct SimulationWallets {
    pub attacker: Pubkey,
    pub victims: Vec<Pubkey>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_wallet() {
        let funder = Keypair::new();
        let mut manager = WalletManager::new("http://127.0.0.1:8899", funder);
        
        let wallet = manager.create_wallet("test");
        assert!(!wallet.pubkey().to_string().is_empty());
        
        let retrieved = manager.get_wallet("test");
        assert!(retrieved.is_some());
    }
}

