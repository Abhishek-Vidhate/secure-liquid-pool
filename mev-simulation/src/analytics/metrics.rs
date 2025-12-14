//! Metrics calculation for simulation analysis

use crate::simulation::SimulationResults;
use serde::{Deserialize, Serialize};

/// Calculator for simulation metrics
pub struct MetricsCalculator;

impl MetricsCalculator {
    /// Calculate cumulative MEV over time
    pub fn cumulative_mev(results: &SimulationResults) -> Vec<CumulativeDataPoint> {
        let mut cumulative = 0i64;
        let mut points = Vec::new();
        
        for (i, sandwich) in results.sandwich_results.iter().enumerate() {
            cumulative += sandwich.profit_lamports;
            points.push(CumulativeDataPoint {
                transaction: i as u32,
                value: cumulative as f64 / 1_000_000_000.0,
            });
        }
        
        points
    }

    /// Calculate cumulative victim losses over time
    pub fn cumulative_losses(results: &SimulationResults) -> Vec<CumulativeDataPoint> {
        let mut cumulative = 0u64;
        let mut points = Vec::new();
        
        for (i, sandwich) in results.sandwich_results.iter().enumerate() {
            cumulative += sandwich.victim_loss_lamports;
            points.push(CumulativeDataPoint {
                transaction: i as u32,
                value: cumulative as f64 / 1_000_000_000.0,
            });
        }
        
        points
    }

    /// Calculate loss distribution (histogram)
    pub fn loss_distribution(results: &SimulationResults) -> Vec<HistogramBucket> {
        let losses: Vec<f64> = results.sandwich_results.iter()
            .filter(|s| s.victim_loss_lamports > 0)
            .map(|s| s.victim_loss_lamports as f64 / 1_000_000_000.0)
            .collect();
        
        if losses.is_empty() {
            return vec![];
        }

        // Create 10 buckets
        let min_loss = losses.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_loss = losses.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let bucket_size = (max_loss - min_loss) / 10.0;
        
        let mut buckets: Vec<HistogramBucket> = (0..10)
            .map(|i| {
                let start = min_loss + (i as f64 * bucket_size);
                let end = start + bucket_size;
                HistogramBucket {
                    range_start: start,
                    range_end: end,
                    count: 0,
                    label: format!("{:.4}-{:.4}", start, end),
                }
            })
            .collect();

        for loss in losses {
            let bucket_idx = ((loss - min_loss) / bucket_size).floor() as usize;
            let bucket_idx = bucket_idx.min(9);
            buckets[bucket_idx].count += 1;
        }

        buckets
    }

    /// Calculate attack profitability distribution
    pub fn profit_distribution(results: &SimulationResults) -> Vec<HistogramBucket> {
        let profits: Vec<f64> = results.sandwich_results.iter()
            .map(|s| s.profit_lamports as f64 / 1_000_000_000.0)
            .collect();
        
        if profits.is_empty() {
            return vec![];
        }

        let min_profit = profits.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_profit = profits.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let bucket_size = (max_profit - min_profit) / 10.0;
        
        if bucket_size == 0.0 {
            return vec![HistogramBucket {
                range_start: min_profit,
                range_end: max_profit,
                count: profits.len() as u32,
                label: format!("{:.6}", min_profit),
            }];
        }

        let mut buckets: Vec<HistogramBucket> = (0..10)
            .map(|i| {
                let start = min_profit + (i as f64 * bucket_size);
                let end = start + bucket_size;
                HistogramBucket {
                    range_start: start,
                    range_end: end,
                    count: 0,
                    label: format!("{:.6}", start),
                }
            })
            .collect();

        for profit in profits {
            let bucket_idx = ((profit - min_profit) / bucket_size).floor() as usize;
            let bucket_idx = bucket_idx.min(9);
            buckets[bucket_idx].count += 1;
        }

        buckets
    }

    /// Calculate price impact over time
    pub fn price_impact_over_time(results: &SimulationResults) -> Vec<PriceDataPoint> {
        results.pool_history.iter()
            .filter(|h| h.scenario == "normal")
            .map(|h| PriceDataPoint {
                transaction: h.transaction_id,
                price: h.price_a_in_b,
            })
            .collect()
    }

    /// Compare normal vs protected outcomes
    pub fn comparison_metrics(results: &SimulationResults) -> ComparisonMetrics {
        let normal_losses: u64 = results.normal_trades.iter()
            .map(|t| t.slippage_loss)
            .sum();
        
        let protected_losses: u64 = results.protected_trades.iter()
            .map(|t| t.slippage_loss)
            .sum();

        let attacked_count = results.normal_trades.iter()
            .filter(|t| t.was_attacked)
            .count() as u32;

        ComparisonMetrics {
            normal_total_loss: normal_losses,
            protected_total_loss: protected_losses,
            savings: normal_losses.saturating_sub(protected_losses),
            savings_percentage: if normal_losses > 0 {
                ((normal_losses - protected_losses) as f64 / normal_losses as f64) * 100.0
            } else {
                0.0
            },
            attacked_transactions: attacked_count,
            protected_transactions: results.protected_trades.len() as u32,
        }
    }
}

/// Data point for cumulative charts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CumulativeDataPoint {
    pub transaction: u32,
    pub value: f64,
}

/// Histogram bucket
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistogramBucket {
    pub range_start: f64,
    pub range_end: f64,
    pub count: u32,
    pub label: String,
}

/// Price data point
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceDataPoint {
    pub transaction: u32,
    pub price: f64,
}

/// Comparison metrics between normal and protected trading
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonMetrics {
    pub normal_total_loss: u64,
    pub protected_total_loss: u64,
    pub savings: u64,
    pub savings_percentage: f64,
    pub attacked_transactions: u32,
    pub protected_transactions: u32,
}

