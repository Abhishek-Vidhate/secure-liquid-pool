//! MEV Sandwich Attack Simulation Framework
//!
//! This framework simulates MEV sandwich attacks on an AMM to demonstrate
//! the effectiveness of commit-reveal protection mechanisms.

pub mod bots;
pub mod simulation;
pub mod analytics;
pub mod utils;
pub mod config;

pub use config::SimulationConfig;
pub use simulation::orchestrator::Orchestrator;
pub use analytics::report::generate_report;

