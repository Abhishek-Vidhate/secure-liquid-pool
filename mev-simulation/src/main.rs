//! MEV Simulation CLI
//!
//! Command-line interface for the MEV sandwich attack simulation framework.

use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

use mev_simulation::{
    config::SimulationConfig,
    simulation::Orchestrator,
    analytics::{
        logger::{SimulationLogger, print_summary},
        report::generate_report,
    },
};

#[derive(Parser)]
#[command(name = "mev-sim")]
#[command(author = "SecureLiquidPool Team")]
#[command(version = "0.1.0")]
#[command(about = "MEV Sandwich Attack Simulation Framework", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
    
    /// Enable verbose output
    #[arg(short, long, global = true)]
    verbose: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Run the MEV simulation
    Run {
        /// Number of transactions to simulate
        #[arg(short, long, default_value = "1000")]
        transactions: u32,
        
        /// Probability of attack (0.0 - 1.0)
        #[arg(short, long, default_value = "0.8")]
        attack_probability: f64,
        
        /// Minimum swap amount in SOL
        #[arg(long, default_value = "0.1")]
        min_swap: f64,
        
        /// Maximum swap amount in SOL
        #[arg(long, default_value = "5.0")]
        max_swap: f64,
        
        /// Initial pool liquidity in SOL (for each token)
        #[arg(long, default_value = "1000.0")]
        pool_liquidity: f64,
        
        /// AMM fee in basis points
        #[arg(long, default_value = "30")]
        fee_bps: u16,
        
        /// Output directory for results
        #[arg(short, long, default_value = "output")]
        output: String,
        
        /// Skip HTML report generation
        #[arg(long)]
        no_report: bool,
    },
    
    /// Generate report from existing simulation results
    Report {
        /// Input JSON file with simulation results
        #[arg(short, long)]
        input: PathBuf,
        
        /// Output HTML file path
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    
    /// Show quick simulation stats without full run
    Quick {
        /// Number of transactions for quick test
        #[arg(short, long, default_value = "100")]
        transactions: u32,
    },
    
    /// Print configuration info
    Info,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    
    // Setup logging
    let log_level = if cli.verbose { Level::DEBUG } else { Level::INFO };
    let _subscriber = FmtSubscriber::builder()
        .with_max_level(log_level)
        .with_target(false)
        .with_thread_ids(false)
        .compact()
        .init();
    
    match cli.command {
        Commands::Run {
            transactions,
            attack_probability,
            min_swap,
            max_swap,
            pool_liquidity,
            fee_bps,
            output,
            no_report,
        } => {
            run_simulation(
                transactions,
                attack_probability,
                min_swap,
                max_swap,
                pool_liquidity,
                fee_bps,
                &output,
                !no_report,
            )?;
        }
        
        Commands::Report { input, output } => {
            generate_report_from_file(input.as_path(), output.as_ref().map(|p| p.as_path()))?;
        }
        
        Commands::Quick { transactions } => {
            run_quick_simulation(transactions)?;
        }
        
        Commands::Info => {
            print_info();
        }
    }
    
    Ok(())
}

fn run_simulation(
    transactions: u32,
    attack_probability: f64,
    min_swap: f64,
    max_swap: f64,
    pool_liquidity: f64,
    fee_bps: u16,
    output_dir: &str,
    generate_html: bool,
) -> Result<()> {
    println!();
    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║       MEV Sandwich Attack Simulation                     ║");
    println!("║       SecureLiquidPool Framework                         ║");
    println!("╚══════════════════════════════════════════════════════════╝");
    println!();
    
    // Create configuration
    let sol_to_lamports = |sol: f64| (sol * 1_000_000_000.0) as u64;
    
    let config = SimulationConfig {
        total_transactions: transactions,
        attack_probability,
        min_swap_lamports: sol_to_lamports(min_swap),
        max_swap_lamports: sol_to_lamports(max_swap),
        initial_pool_a: sol_to_lamports(pool_liquidity),
        initial_pool_b: sol_to_lamports(pool_liquidity),
        fee_bps,
        output_dir: output_dir.to_string(),
        ..Default::default()
    };
    
    info!("Configuration:");
    info!("  Transactions:        {}", transactions);
    info!("  Attack Probability:  {:.0}%", attack_probability * 100.0);
    info!("  Swap Range:          {:.2} - {:.2} SOL", min_swap, max_swap);
    info!("  Pool Liquidity:      {:.2} SOL each", pool_liquidity);
    info!("  Fee:                 {:.2}%", fee_bps as f64 / 100.0);
    println!();
    
    // Create orchestrator and run simulation
    let mut orchestrator = Orchestrator::new(config);
    let results = orchestrator.run()?;
    
    // Print summary to terminal
    print_summary(&results);
    
    // Save results
    let logger = SimulationLogger::new(output_dir);
    let json_path = logger.save_results(&results)?;
    logger.save_summary(&results)?;
    
    // Generate HTML report
    if generate_html {
        let report_path = format!("{}/reports/report.html", output_dir);
        generate_report(&results, &report_path)?;
        
        println!();
        println!("📊 Report generated: {}", report_path);
        println!("   Open in browser to view interactive charts");
    }
    
    println!();
    println!("📁 Results saved to: {}", json_path);
    println!();
    
    Ok(())
}

fn generate_report_from_file(input: &std::path::Path, output: Option<&std::path::Path>) -> Result<()> {
    info!("Loading results from: {:?}", input);
    
    let results = SimulationLogger::load_results(input.to_str().unwrap())?;
    
    let output_path = output
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "output/reports/report.html".to_string());
    
    generate_report(&results, &output_path)?;
    
    println!("📊 Report generated: {}", output_path);
    
    Ok(())
}

fn run_quick_simulation(transactions: u32) -> Result<()> {
    println!();
    println!("🚀 Running quick simulation ({} transactions)...", transactions);
    println!();
    
    let config = SimulationConfig {
        total_transactions: transactions,
        ..SimulationConfig::quick_test()
    };
    
    let mut orchestrator = Orchestrator::new(config);
    let results = orchestrator.run()?;
    
    print_summary(&results);
    
    Ok(())
}

fn print_info() {
    println!();
    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║       MEV Simulation Framework - Info                    ║");
    println!("╚══════════════════════════════════════════════════════════╝");
    println!();
    println!("This framework simulates MEV sandwich attacks to demonstrate");
    println!("the effectiveness of commit-reveal protection.");
    println!();
    println!("COMPONENTS:");
    println!("  • Sandwich Attacker Bot  - Executes front-run/back-run attacks");
    println!("  • Normal Trader Bot      - Vulnerable direct AMM swaps");
    println!("  • Protected Trader Bot   - Commit-reveal protected swaps");
    println!("  • Orchestrator           - Runs simulation scenarios");
    println!("  • Analytics              - Generates reports and charts");
    println!();
    println!("USAGE:");
    println!("  mev-sim run --transactions 1000    # Run full simulation");
    println!("  mev-sim quick                       # Quick 100 tx test");
    println!("  mev-sim report -i results.json     # Generate report");
    println!();
    println!("PROGRAM IDs (Devnet):");
    println!("  Stake Pool:  EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7");
    println!("  AMM:         AcaXW2nDrvkpmuZnuiARDRJzmmfT1AZwLm4SMeYwnXKS");
    println!("  SecureLP:    BMxQAdqNJE3Zn6iJedc6A6XbsSTmNBQi6UzFdfrNvE21");
    println!();
}

