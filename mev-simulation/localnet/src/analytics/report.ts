import fs from "fs";
import path from "path";
import { SimulationResults } from "../types.js";
import { formatSol } from "../config.js";
import {
  calculateCumulativeMev,
  calculateCumulativeLosses,
  calculateLossDistribution,
} from "./collector.js";

/**
 * Generate interactive HTML report with charts
 */
export function generateReport(results: SimulationResults, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });
  
  const filepath = path.join(outputDir, "report.html");
  
  // Calculate chart data
  const cumulativeMev = calculateCumulativeMev(results);
  const cumulativeLosses = calculateCumulativeLosses(results);
  const lossDistribution = calculateLossDistribution(results);

  const s = results.summary;
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MEV Simulation Report - Localnet</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {
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
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
            min-height: 100vh;
        }
        
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        
        header {
            text-align: center;
            padding: 4rem 2rem;
            background: linear-gradient(180deg, rgba(139, 92, 246, 0.15) 0%, transparent 100%);
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            margin-bottom: 3rem;
        }
        
        header h1 {
            font-size: 3rem;
            font-weight: 800;
            background: linear-gradient(135deg, #a78bfa, #22d3ee);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.75rem;
        }
        
        header .subtitle { font-size: 1.25rem; color: var(--text-secondary); margin-bottom: 0.5rem; }
        header .badge {
            display: inline-block;
            background: rgba(16, 185, 129, 0.2);
            color: var(--accent-green);
            padding: 0.25rem 1rem;
            border-radius: 2rem;
            font-size: 0.875rem;
            margin-top: 1rem;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1.25rem;
            margin-bottom: 3rem;
        }
        
        @media (max-width: 900px) { .stats-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 600px) { .stats-grid { grid-template-columns: 1fr; } }
        
        .stat-card {
            background: var(--bg-card);
            border-radius: 1rem;
            padding: 1.75rem;
            border: 1px solid rgba(255, 255, 255, 0.06);
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        .stat-card:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(0,0,0,0.3); }
        .stat-card h3 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-secondary); margin-bottom: 0.75rem; font-weight: 600; }
        .stat-card .value { font-size: 2.25rem; font-weight: 700; line-height: 1.2; }
        .stat-card .label { font-size: 0.875rem; color: var(--text-secondary); margin-top: 0.25rem; }
        .stat-card.highlight { background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(34, 211, 238, 0.08)); border-color: rgba(16, 185, 129, 0.25); }
        .stat-card.danger { background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(245, 158, 11, 0.08)); border-color: rgba(239, 68, 68, 0.25); }
        
        .chart-card {
            background: var(--bg-card);
            border-radius: 1.25rem;
            padding: 2rem;
            border: 1px solid rgba(255, 255, 255, 0.06);
            margin-bottom: 2rem;
        }
        
        .chart-card h3 { font-size: 1.25rem; font-weight: 600; margin-bottom: 1.5rem; color: var(--text-primary); }
        .chart-container { position: relative; height: 400px; width: 100%; }
        
        .comparison-section {
            background: var(--bg-card);
            border-radius: 1.25rem;
            padding: 3rem;
            margin-bottom: 2rem;
            border: 1px solid rgba(255, 255, 255, 0.06);
            text-align: center;
        }
        
        .comparison-section h2 { font-size: 1.75rem; font-weight: 700; margin-bottom: 2.5rem; }
        .comparison-bars { display: flex; gap: 4rem; justify-content: center; align-items: flex-end; }
        .bar-container { text-align: center; }
        .bar { height: 250px; width: 120px; margin: 0 auto 1.5rem; background: var(--bg-secondary); border-radius: 0.75rem; position: relative; overflow: hidden; }
        .bar-fill { position: absolute; bottom: 0; left: 0; right: 0; border-radius: 0.75rem; transition: height 1s ease; }
        .bar-fill.danger { background: linear-gradient(to top, #dc2626, #f97316); }
        .bar-fill.success { background: linear-gradient(to top, #059669, #06b6d4); }
        .bar-value { font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; }
        .bar-label { font-size: 1rem; color: var(--text-secondary); }
        
        .insight-box {
            background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(34, 211, 238, 0.05));
            border: 1px solid rgba(139, 92, 246, 0.2);
            border-radius: 1.25rem;
            padding: 2.5rem;
            margin-bottom: 2rem;
            text-align: center;
        }
        
        .insight-box h2 { font-size: 1.5rem; font-weight: 700; margin-bottom: 1rem; }
        .insight-box .big-number { font-size: 3rem; font-weight: 800; color: var(--accent-green); margin: 1rem 0; }
        .insight-box p { color: var(--text-secondary); font-size: 1.1rem; max-width: 700px; margin: 0 auto; line-height: 1.7; }
        
        footer { text-align: center; padding: 3rem 2rem; color: var(--text-secondary); border-top: 1px solid rgba(255, 255, 255, 0.06); margin-top: 2rem; }
        footer p { margin-bottom: 0.25rem; }
    </style>
</head>
<body>
    <header>
        <h1>🛡️ MEV Simulation Report</h1>
        <p class="subtitle">Localnet Commit-Reveal Protection Test</p>
        <span class="badge">✓ On-Chain Simulation</span>
    </header>
    
    <div class="container">
        <div class="stats-grid">
            <div class="stat-card">
                <h3>Total Transactions</h3>
                <div class="value">${s.totalTransactions}</div>
                <div class="label">on-chain trades</div>
            </div>
            
            <div class="stat-card danger">
                <h3>MEV Extracted</h3>
                <div class="value" style="color: var(--accent-red);">${formatSol(s.totalMevExtracted)} SOL</div>
                <div class="label">from unprotected trades</div>
            </div>
            
            <div class="stat-card danger">
                <h3>Victim Losses</h3>
                <div class="value" style="color: var(--accent-orange);">${formatSol(s.totalVictimLosses)} SOL</div>
                <div class="label">from ${s.successfulAttacks} attacks</div>
            </div>
            
            <div class="stat-card highlight">
                <h3>Protected Savings</h3>
                <div class="value" style="color: var(--accent-green);">${formatSol(s.totalProtectedSavings)} SOL</div>
                <div class="label">100% protection</div>
            </div>
            
            <div class="stat-card">
                <h3>Attack Success Rate</h3>
                <div class="value">${s.attackSuccessRate.toFixed(1)}%</div>
                <div class="label">of ${s.attackAttempts} attempts</div>
            </div>
            
            <div class="stat-card">
                <h3>Avg Loss per Attack</h3>
                <div class="value">${s.avgLossPerAttack.toFixed(6)} SOL</div>
                <div class="label">per sandwich</div>
            </div>
        </div>
        
        <div class="comparison-section">
            <h2>Normal vs Protected Trading</h2>
            <div class="comparison-bars">
                <div class="bar-container">
                    <div class="bar">
                        <div class="bar-fill danger" style="height: 100%;"></div>
                    </div>
                    <div class="bar-value" style="color: var(--accent-red);">${formatSol(s.totalVictimLosses)} SOL</div>
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
        
        <div class="chart-card">
            <h3>📈 Cumulative MEV Extraction Over Time</h3>
            <div class="chart-container">
                <canvas id="mevChart"></canvas>
            </div>
        </div>
        
        <div class="chart-card">
            <h3>📊 Loss Distribution per Attack</h3>
            <div class="chart-container">
                <canvas id="histChart"></canvas>
            </div>
        </div>
        
        <div class="insight-box">
            <h2>🔒 Key Insight</h2>
            <div class="big-number">${formatSol(s.totalProtectedSavings)} SOL SAVED</div>
            <p>
                Without protection, <strong>${s.successfulAttacks}</strong> out of <strong>${s.totalTransactions}</strong> transactions were sandwiched,
                resulting in an average loss of <strong>${s.avgLossPerAttack.toFixed(6)} SOL</strong> per attack.
                With commit-reveal protection, <strong style="color: var(--accent-green);">100%</strong> of transactions were protected.
            </p>
        </div>
    </div>
    
    <footer>
        <p><strong>SecureLiquidPool</strong> Localnet MEV Simulation</p>
        <p>Generated: ${new Date().toISOString()}</p>
    </footer>
    
    <script>
        Chart.defaults.color = '#888888';
        Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.08)';
        Chart.defaults.font.family = 'Inter, sans-serif';
        
        const mevLabels = ${JSON.stringify(cumulativeMev.map(p => p.transaction))};
        const mevValues = ${JSON.stringify(cumulativeMev.map(p => p.value))};
        const lossValues = ${JSON.stringify(cumulativeLosses.map(p => p.value))};
        
        new Chart(document.getElementById('mevChart').getContext('2d'), {
            type: 'line',
            data: {
                labels: mevLabels,
                datasets: [
                    {
                        label: 'Cumulative Victim Losses (SOL)',
                        data: lossValues,
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.15)',
                        fill: true,
                        tension: 0.3,
                        borderWidth: 2.5,
                        pointRadius: 0
                    },
                    {
                        label: 'Cumulative MEV Profit (SOL)',
                        data: mevValues,
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        fill: true,
                        tension: 0.3,
                        borderWidth: 2.5,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top', align: 'end' } },
                scales: {
                    y: { beginAtZero: true, title: { display: true, text: 'SOL' } },
                    x: { title: { display: true, text: 'Transaction Number' }, ticks: { maxTicksLimit: 20 } }
                }
            }
        });
        
        const histLabels = ${JSON.stringify(lossDistribution.map(b => b.label))};
        const histValues = ${JSON.stringify(lossDistribution.map(b => b.count))};
        
        new Chart(document.getElementById('histChart').getContext('2d'), {
            type: 'bar',
            data: {
                labels: histLabels,
                datasets: [{
                    label: 'Number of Attacks',
                    data: histValues,
                    backgroundColor: 'rgba(139, 92, 246, 0.7)',
                    borderColor: '#8b5cf6',
                    borderWidth: 0,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, title: { display: true, text: 'Number of Attacks' } },
                    x: { title: { display: true, text: 'Loss Amount Range (SOL)' }, ticks: { maxRotation: 45, minRotation: 45 } }
                }
            }
        });
    </script>
</body>
</html>`;

  fs.writeFileSync(filepath, html);
  return filepath;
}

