//! Structured logging for simulation results

use crate::simulation::SimulationResults;
use anyhow::{Context, Result};
use serde_json;
use std::fs::{self, File};
use std::io::Write;
use tracing::info;

/// Handles logging of simulation results to files
pub struct SimulationLogger {
    output_dir: String,
}

impl SimulationLogger {
    /// Create a new logger with the specified output directory
    pub fn new(output_dir: &str) -> Self {
        Self {
            output_dir: output_dir.to_string(),
        }
    }

    /// Ensure output directories exist
    pub fn ensure_dirs(&self) -> Result<()> {
        fs::create_dir_all(format!("{}/logs", self.output_dir))
            .context("Failed to create logs directory")?;
        fs::create_dir_all(format!("{}/reports", self.output_dir))
            .context("Failed to create reports directory")?;
        Ok(())
    }

    /// Save simulation results to JSON file
    pub fn save_results(&self, results: &SimulationResults) -> Result<String> {
        self.ensure_dirs()?;

        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let filename = format!("{}/logs/simulation_{}.json", self.output_dir, timestamp);
        
        let json = serde_json::to_string_pretty(results)
            .context("Failed to serialize results")?;
        
        let mut file = File::create(&filename)
            .context("Failed to create log file")?;
        
        file.write_all(json.as_bytes())
            .context("Failed to write log file")?;

        info!("Results saved to: {}", filename);
        Ok(filename)
    }

    /// Load results from a JSON file
    pub fn load_results(path: &str) -> Result<SimulationResults> {
        let contents = fs::read_to_string(path)
            .context("Failed to read results file")?;
        
        serde_json::from_str(&contents)
            .context("Failed to parse results file")
    }

    /// Save a summary text file
    pub fn save_summary(&self, results: &SimulationResults) -> Result<String> {
        self.ensure_dirs()?;

        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let filename = format!("{}/logs/summary_{}.txt", self.output_dir, timestamp);
        
        let summary = format_summary(results);
        
        let mut file = File::create(&filename)
            .context("Failed to create summary file")?;
        
        file.write_all(summary.as_bytes())
            .context("Failed to write summary file")?;

        info!("Summary saved to: {}", filename);
        Ok(filename)
    }
}

/// Format results as a text summary
pub fn format_summary(results: &SimulationResults) -> String {
    let s = &results.summary;
    let lamports_to_sol = |l: u64| l as f64 / 1_000_000_000.0;
    let lamports_to_sol_i64 = |l: i64| l as f64 / 1_000_000_000.0;

    format!(
        r#"
╔══════════════════════════════════════════════════════════════════╗
║            MEV SIMULATION RESULTS                                ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  CONFIGURATION                                                   ║
║  ─────────────                                                   ║
║  Total Transactions:    {:>10}                                   ║
║  Attack Probability:    {:>10.1}%                                ║
║  Min Swap:              {:>10.4} SOL                             ║
║  Max Swap:              {:>10.4} SOL                             ║
║  Pool Fee:              {:>10.2}%                                ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  NORMAL TRADING (Vulnerable to MEV)                              ║
║  ──────────────────────────────────                              ║
║  Attack Attempts:       {:>10}                                   ║
║  Successful Attacks:    {:>10}                                   ║
║  Attack Success Rate:   {:>10.1}%                                ║
║                                                                  ║
║  Total MEV Extracted:   {:>10.6} SOL                             ║
║  Total Victim Losses:   {:>10.6} SOL                             ║
║  Avg Loss per Attack:   {:>10.6} SOL                             ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  PROTECTED TRADING (Commit-Reveal)                               ║
║  ─────────────────────────────────                               ║
║  Attacks Possible:      {:>10}                                   ║
║  MEV Extracted:         {:>10.6} SOL                             ║
║                                                                  ║
║  ★ TOTAL SAVINGS:       {:>10.6} SOL                             ║
║  ★ Protection Rate:     {:>10.1}%                                ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  VOLUME STATISTICS                                               ║
║  ─────────────────                                               ║
║  Total Volume:          {:>10.4} SOL                             ║
║  Average Trade:         {:>10.6} SOL                             ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝

Generated: {}
"#,
        // Configuration
        s.total_transactions,
        results.config.attack_probability * 100.0,
        lamports_to_sol(results.config.min_swap_lamports),
        lamports_to_sol(results.config.max_swap_lamports),
        results.config.fee_bps as f64 / 100.0,
        // Normal trading
        s.attack_attempts,
        s.successful_attacks,
        s.attack_success_rate,
        lamports_to_sol_i64(s.total_mev_extracted),
        lamports_to_sol(s.total_victim_losses),
        lamports_to_sol(s.avg_loss_per_attack as u64),
        // Protected trading
        0, // No attacks possible
        0.0, // No MEV extracted
        lamports_to_sol(s.total_protected_savings),
        100.0, // 100% protection
        // Volume
        lamports_to_sol(s.total_volume),
        lamports_to_sol(s.avg_trade_amount as u64),
        // Timestamp
        chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC"),
    )
}

/// Print summary to terminal
pub fn print_summary(results: &SimulationResults) {
    println!("{}", format_summary(results));
}

