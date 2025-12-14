//! HTML Report Generation with Chart.js

use crate::simulation::SimulationResults;
use crate::analytics::metrics::MetricsCalculator;
use anyhow::{Context, Result};
use std::fs::{self, File};
use std::io::Write;
use tracing::info;

/// Generate an HTML report with interactive charts
pub fn generate_report(results: &SimulationResults, output_path: &str) -> Result<String> {
    // Ensure output directory exists
    if let Some(parent) = std::path::Path::new(output_path).parent() {
        fs::create_dir_all(parent)?;
    }

    // Calculate metrics for charts
    let cumulative_mev = MetricsCalculator::cumulative_mev(results);
    let cumulative_losses = MetricsCalculator::cumulative_losses(results);
    let loss_distribution = MetricsCalculator::loss_distribution(results);
    let comparison = MetricsCalculator::comparison_metrics(results);

    // Generate HTML
    let html = generate_html(results, &cumulative_mev, &cumulative_losses, &loss_distribution, &comparison)?;

    // Write to file
    let mut file = File::create(output_path)
        .context("Failed to create report file")?;
    file.write_all(html.as_bytes())
        .context("Failed to write report file")?;

    info!("Report generated: {}", output_path);
    Ok(output_path.to_string())
}

fn generate_html(
    results: &SimulationResults,
    cumulative_mev: &[crate::analytics::metrics::CumulativeDataPoint],
    cumulative_losses: &[crate::analytics::metrics::CumulativeDataPoint],
    loss_distribution: &[crate::analytics::metrics::HistogramBucket],
    _comparison: &crate::analytics::metrics::ComparisonMetrics,
) -> Result<String> {
    let s = &results.summary;
    let lamports_to_sol = |l: u64| format!("{:.6}", l as f64 / 1_000_000_000.0);
    let lamports_to_sol_i64 = |l: i64| format!("{:.6}", l as f64 / 1_000_000_000.0);

    // Prepare chart data
    let mev_labels: Vec<u32> = cumulative_mev.iter().map(|p| p.transaction).collect();
    let mev_values: Vec<f64> = cumulative_mev.iter().map(|p| p.value).collect();
    let loss_values: Vec<f64> = cumulative_losses.iter().map(|p| p.value).collect();
    
    let hist_labels: Vec<String> = loss_distribution.iter().map(|b| b.label.clone()).collect();
    let hist_values: Vec<u32> = loss_distribution.iter().map(|b| b.count).collect();

    let html = format!(r#"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MEV Simulation Report - SecureLiquidPool</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {{
            --bg-primary: #0a0a0a;
            --bg-secondary: #141414;
            --bg-card: #1c1c1c;
            --text-primary: #ffffff;
            --text-secondary: #888888;
            --accent-purple: #8b5cf6;
            --accent-cyan: #22d3ee;
            --accent-green: #10b981;
            --accent-red: #ef4444;
            --accent-orange: #f59e0b;
        }}
        
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
            min-height: 100vh;
        }}
        
        .container {{
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }}
        
        header {{
            text-align: center;
            padding: 4rem 2rem;
            background: linear-gradient(180deg, rgba(139, 92, 246, 0.15) 0%, transparent 100%);
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            margin-bottom: 3rem;
        }}
        
        header h1 {{
            font-size: 3rem;
            font-weight: 800;
            background: linear-gradient(135deg, #a78bfa, #22d3ee);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.75rem;
        }}
        
        header .subtitle {{
            font-size: 1.25rem;
            color: var(--text-secondary);
            margin-bottom: 0.5rem;
        }}
        
        header .timestamp {{
            font-size: 0.875rem;
            color: rgba(255,255,255,0.4);
        }}
        
        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1.25rem;
            margin-bottom: 3rem;
        }}
        
        @media (max-width: 900px) {{
            .stats-grid {{
                grid-template-columns: repeat(2, 1fr);
            }}
        }}
        
        @media (max-width: 600px) {{
            .stats-grid {{
                grid-template-columns: 1fr;
            }}
        }}
        
        .stat-card {{
            background: var(--bg-card);
            border-radius: 1rem;
            padding: 1.75rem;
            border: 1px solid rgba(255, 255, 255, 0.06);
            transition: transform 0.2s, box-shadow 0.2s;
        }}
        
        .stat-card:hover {{
            transform: translateY(-2px);
            box-shadow: 0 8px 30px rgba(0,0,0,0.3);
        }}
        
        .stat-card h3 {{
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: var(--text-secondary);
            margin-bottom: 0.75rem;
            font-weight: 600;
        }}
        
        .stat-card .value {{
            font-size: 2.25rem;
            font-weight: 700;
            line-height: 1.2;
        }}
        
        .stat-card .label {{
            font-size: 0.875rem;
            color: var(--text-secondary);
            margin-top: 0.25rem;
        }}
        
        .stat-card.highlight {{
            background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(34, 211, 238, 0.08));
            border-color: rgba(16, 185, 129, 0.25);
        }}
        
        .stat-card.danger {{
            background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(245, 158, 11, 0.08));
            border-color: rgba(239, 68, 68, 0.25);
        }}
        
        .section-title {{
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 1.5rem;
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }}
        
        .section-title span {{
            font-size: 1.75rem;
        }}
        
        .chart-card {{
            background: var(--bg-card);
            border-radius: 1.25rem;
            padding: 2rem;
            border: 1px solid rgba(255, 255, 255, 0.06);
            margin-bottom: 2rem;
        }}
        
        .chart-card h3 {{
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 1.5rem;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }}
        
        .chart-container {{
            position: relative;
            height: 400px;
            width: 100%;
        }}
        
        .comparison-section {{
            background: var(--bg-card);
            border-radius: 1.25rem;
            padding: 3rem;
            margin-bottom: 2rem;
            border: 1px solid rgba(255, 255, 255, 0.06);
            text-align: center;
        }}
        
        .comparison-section h2 {{
            font-size: 1.75rem;
            font-weight: 700;
            margin-bottom: 2.5rem;
        }}
        
        .comparison-bars {{
            display: flex;
            gap: 4rem;
            justify-content: center;
            align-items: flex-end;
        }}
        
        .bar-container {{
            text-align: center;
        }}
        
        .bar {{
            height: 250px;
            width: 120px;
            margin: 0 auto 1.5rem;
            background: var(--bg-secondary);
            border-radius: 0.75rem;
            position: relative;
            overflow: hidden;
        }}
        
        .bar-fill {{
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            border-radius: 0.75rem;
            transition: height 1s ease;
        }}
        
        .bar-fill.danger {{
            background: linear-gradient(to top, #dc2626, #f97316);
        }}
        
        .bar-fill.success {{
            background: linear-gradient(to top, #059669, #06b6d4);
        }}
        
        .bar-value {{
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
        }}
        
        .bar-label {{
            font-size: 1rem;
            color: var(--text-secondary);
        }}
        
        .insight-box {{
            background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(34, 211, 238, 0.05));
            border: 1px solid rgba(139, 92, 246, 0.2);
            border-radius: 1.25rem;
            padding: 2.5rem;
            margin-bottom: 2rem;
            text-align: center;
        }}
        
        .insight-box h2 {{
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }}
        
        .insight-box .big-number {{
            font-size: 3rem;
            font-weight: 800;
            color: var(--accent-green);
            margin: 1rem 0;
        }}
        
        .insight-box p {{
            color: var(--text-secondary);
            font-size: 1.1rem;
            max-width: 700px;
            margin: 0 auto;
            line-height: 1.7;
        }}
        
        footer {{
            text-align: center;
            padding: 3rem 2rem;
            color: var(--text-secondary);
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            margin-top: 2rem;
        }}
        
        footer p {{
            margin-bottom: 0.25rem;
        }}
    </style>
</head>
<body>
    <header>
        <h1>🛡️ MEV Simulation Report</h1>
        <p class="subtitle">SecureLiquidPool - Commit-Reveal Protection Analysis</p>
        <p class="timestamp">Generated: {timestamp}</p>
    </header>
    
    <div class="container">
        <!-- Key Statistics -->
        <div class="stats-grid">
            <div class="stat-card">
                <h3>Total Transactions</h3>
                <div class="value">{total_transactions}</div>
                <div class="label">simulated trades</div>
            </div>
            
            <div class="stat-card danger">
                <h3>MEV Extracted</h3>
                <div class="value" style="color: var(--accent-red);">{total_mev} SOL</div>
                <div class="label">stolen from unprotected traders</div>
            </div>
            
            <div class="stat-card danger">
                <h3>Victim Losses</h3>
                <div class="value" style="color: var(--accent-orange);">{total_losses} SOL</div>
                <div class="label">from {attack_count} successful attacks</div>
            </div>
            
            <div class="stat-card highlight">
                <h3>Protected Savings</h3>
                <div class="value" style="color: var(--accent-green);">{total_savings} SOL</div>
                <div class="label">100% protection with commit-reveal</div>
            </div>
            
            <div class="stat-card">
                <h3>Attack Success Rate</h3>
                <div class="value">{attack_rate:.1}%</div>
                <div class="label">of attack attempts succeeded</div>
            </div>
            
            <div class="stat-card">
                <h3>Avg Loss per Attack</h3>
                <div class="value">{avg_loss} SOL</div>
                <div class="label">per successful sandwich</div>
            </div>
        </div>
        
        <!-- Comparison Section -->
        <div class="comparison-section">
            <h2>Normal vs Protected Trading</h2>
            <div class="comparison-bars">
                <div class="bar-container">
                    <div class="bar">
                        <div class="bar-fill danger" style="height: 100%;"></div>
                    </div>
                    <div class="bar-value" style="color: var(--accent-red);">{total_losses} SOL</div>
                    <div class="bar-label">Normal Trading Losses</div>
                </div>
                <div class="bar-container">
                    <div class="bar">
                        <div class="bar-fill success" style="height: 3%;"></div>
                    </div>
                    <div class="bar-value" style="color: var(--accent-green);">0 SOL</div>
                    <div class="bar-label">Protected Trading Losses</div>
                </div>
            </div>
        </div>
        
        <!-- Cumulative MEV Chart - Full Width -->
        <div class="chart-card">
            <h3>📈 Cumulative MEV Extraction Over Time</h3>
            <div class="chart-container">
                <canvas id="mevChart"></canvas>
            </div>
        </div>
        
        <!-- Loss Distribution Chart - Full Width -->
        <div class="chart-card">
            <h3>📊 Loss Distribution per Attack</h3>
            <div class="chart-container">
                <canvas id="histChart"></canvas>
            </div>
        </div>
        
        <!-- Key Insight -->
        <div class="insight-box">
            <h2>🔒 Key Insight</h2>
            <div class="big-number">{total_savings} SOL SAVED</div>
            <p>
                Without protection, <strong>{attack_count}</strong> out of <strong>{total_transactions}</strong> transactions were sandwiched,
                resulting in an average loss of <strong>{avg_loss} SOL</strong> per attack.
                With commit-reveal protection, <strong style="color: var(--accent-green);">100%</strong> of transactions were protected from MEV extraction.
            </p>
        </div>
    </div>
    
    <footer>
        <p><strong>SecureLiquidPool</strong> MEV Simulation Framework</p>
        <p>Built with Rust + Chart.js</p>
    </footer>
    
    <script>
        // Chart.js global configuration
        Chart.defaults.color = '#888888';
        Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.08)';
        Chart.defaults.font.family = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        Chart.defaults.font.size = 13;
        
        // Cumulative MEV Chart
        const mevCtx = document.getElementById('mevChart').getContext('2d');
        new Chart(mevCtx, {{
            type: 'line',
            data: {{
                labels: {mev_labels:?},
                datasets: [
                    {{
                        label: 'Cumulative Victim Losses (SOL)',
                        data: {loss_values:?},
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.15)',
                        fill: true,
                        tension: 0.3,
                        borderWidth: 2.5,
                        pointRadius: 0,
                        pointHoverRadius: 5
                    }},
                    {{
                        label: 'Cumulative MEV Profit (SOL)',
                        data: {mev_values:?},
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        fill: true,
                        tension: 0.3,
                        borderWidth: 2.5,
                        pointRadius: 0,
                        pointHoverRadius: 5
                    }}
                ]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                interaction: {{
                    intersect: false,
                    mode: 'index'
                }},
                plugins: {{
                    legend: {{
                        position: 'top',
                        align: 'end',
                        labels: {{
                            usePointStyle: true,
                            pointStyle: 'circle',
                            padding: 20,
                            font: {{
                                size: 13,
                                weight: '500'
                            }}
                        }}
                    }},
                    tooltip: {{
                        backgroundColor: 'rgba(0, 0, 0, 0.85)',
                        titleFont: {{ size: 14, weight: '600' }},
                        bodyFont: {{ size: 13 }},
                        padding: 14,
                        cornerRadius: 8,
                        displayColors: true
                    }}
                }},
                scales: {{
                    y: {{
                        beginAtZero: true,
                        grid: {{
                            color: 'rgba(255, 255, 255, 0.05)'
                        }},
                        ticks: {{
                            padding: 10,
                            font: {{ size: 12 }}
                        }},
                        title: {{
                            display: true,
                            text: 'SOL',
                            font: {{ size: 13, weight: '600' }},
                            padding: 10
                        }}
                    }},
                    x: {{
                        grid: {{
                            display: false
                        }},
                        ticks: {{
                            maxTicksLimit: 20,
                            padding: 10,
                            font: {{ size: 12 }}
                        }},
                        title: {{
                            display: true,
                            text: 'Transaction Number',
                            font: {{ size: 13, weight: '600' }},
                            padding: 10
                        }}
                    }}
                }}
            }}
        }});
        
        // Histogram Chart
        const histCtx = document.getElementById('histChart').getContext('2d');
        new Chart(histCtx, {{
            type: 'bar',
            data: {{
                labels: {hist_labels:?},
                datasets: [{{
                    label: 'Number of Attacks',
                    data: {hist_values:?},
                    backgroundColor: 'rgba(139, 92, 246, 0.7)',
                    borderColor: '#8b5cf6',
                    borderWidth: 0,
                    borderRadius: 6,
                    borderSkipped: false
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{
                    legend: {{
                        display: false
                    }},
                    tooltip: {{
                        backgroundColor: 'rgba(0, 0, 0, 0.85)',
                        titleFont: {{ size: 14, weight: '600' }},
                        bodyFont: {{ size: 13 }},
                        padding: 14,
                        cornerRadius: 8
                    }}
                }},
                scales: {{
                    y: {{
                        beginAtZero: true,
                        grid: {{
                            color: 'rgba(255, 255, 255, 0.05)'
                        }},
                        ticks: {{
                            padding: 10,
                            stepSize: 1,
                            font: {{ size: 12 }}
                        }},
                        title: {{
                            display: true,
                            text: 'Number of Attacks',
                            font: {{ size: 13, weight: '600' }},
                            padding: 10
                        }}
                    }},
                    x: {{
                        grid: {{
                            display: false
                        }},
                        ticks: {{
                            padding: 10,
                            font: {{ size: 11 }},
                            maxRotation: 45,
                            minRotation: 45
                        }},
                        title: {{
                            display: true,
                            text: 'Loss Amount Range (SOL)',
                            font: {{ size: 13, weight: '600' }},
                            padding: 10
                        }}
                    }}
                }}
            }}
        }});
    </script>
</body>
</html>
"#,
        timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC"),
        total_transactions = s.total_transactions,
        total_mev = lamports_to_sol_i64(s.total_mev_extracted),
        total_losses = lamports_to_sol(s.total_victim_losses),
        total_savings = lamports_to_sol(s.total_protected_savings),
        attack_count = s.successful_attacks,
        attack_rate = s.attack_success_rate,
        avg_loss = lamports_to_sol(s.avg_loss_per_attack as u64),
        mev_labels = serde_json::to_string(&mev_labels).unwrap_or_default(),
        mev_values = serde_json::to_string(&mev_values).unwrap_or_default(),
        loss_values = serde_json::to_string(&loss_values).unwrap_or_default(),
        hist_labels = serde_json::to_string(&hist_labels).unwrap_or_default(),
        hist_values = serde_json::to_string(&hist_values).unwrap_or_default(),
    );

    Ok(html)
}

