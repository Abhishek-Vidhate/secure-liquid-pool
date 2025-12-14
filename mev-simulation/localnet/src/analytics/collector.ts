import fs from "fs";
import path from "path";
import { SimulationResults } from "../types.js";
import { formatSol } from "../config.js";

/**
 * Save simulation results to JSON file
 */
export function saveResults(results: SimulationResults, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `simulation_${timestamp}.json`;
  const filepath = path.join(outputDir, filename);

  // Convert BigInt to string for JSON serialization
  const serializable = JSON.parse(JSON.stringify(results, (key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));

  fs.writeFileSync(filepath, JSON.stringify(serializable, null, 2));
  
  return filepath;
}

/**
 * Load results from JSON file
 */
export function loadResults(filepath: string): SimulationResults {
  const content = fs.readFileSync(filepath, "utf-8");
  const data = JSON.parse(content);
  
  // Convert string back to BigInt where needed
  const convertBigInts = (obj: any): any => {
    if (typeof obj === "string" && /^\d+$/.test(obj) && obj.length > 15) {
      return BigInt(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map(convertBigInts);
    }
    if (obj && typeof obj === "object") {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = convertBigInts(value);
      }
      return result;
    }
    return obj;
  };
  
  return convertBigInts(data);
}

/**
 * Save summary to text file
 */
export function saveSummary(results: SimulationResults, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `summary_${timestamp}.txt`;
  const filepath = path.join(outputDir, filename);

  const s = results.summary;
  
  const content = `
MEV SIMULATION SUMMARY
======================
Generated: ${new Date().toISOString()}

CONFIGURATION
-------------
Total Transactions:    ${s.totalTransactions}
Attack Probability:    ${results.config.attackProbability * 100}%
Swap Range:            ${formatSol(BigInt(results.config.minSwapLamports))} - ${formatSol(BigInt(results.config.maxSwapLamports))} SOL
Pool Fee:              ${results.config.feeBps / 100}%

NORMAL TRADING (Vulnerable to MEV)
----------------------------------
Attack Attempts:       ${s.attackAttempts}
Successful Attacks:    ${s.successfulAttacks}
Attack Success Rate:   ${s.attackSuccessRate.toFixed(1)}%
Total MEV Extracted:   ${formatSol(s.totalMevExtracted)} SOL
Total Victim Losses:   ${formatSol(s.totalVictimLosses)} SOL
Avg Loss per Attack:   ${s.avgLossPerAttack.toFixed(6)} SOL

PROTECTED TRADING (Commit-Reveal)
---------------------------------
Attacks Possible:      0
MEV Extracted:         0 SOL
TOTAL SAVINGS:         ${formatSol(s.totalProtectedSavings)} SOL
Protection Rate:       100%

VOLUME STATISTICS
-----------------
Total Volume:          ${formatSol(s.totalVolume)} SOL
Average Trade:         ${s.avgTradeAmount.toFixed(4)} SOL
`;

  fs.writeFileSync(filepath, content);
  return filepath;
}

/**
 * Calculate cumulative metrics for charts
 */
export interface CumulativeDataPoint {
  transaction: number;
  value: number;
}

export function calculateCumulativeMev(results: SimulationResults): CumulativeDataPoint[] {
  const points: CumulativeDataPoint[] = [];
  let cumulative = 0;
  let sandwichIdx = 0;

  for (let i = 0; i < results.normalTrades.length; i++) {
    const trade = results.normalTrades[i];
    if (trade.wasAttacked && sandwichIdx < results.sandwichResults.length) {
      const sandwich = results.sandwichResults[sandwichIdx];
      if (sandwich.success) {
        cumulative += Number(sandwich.profitLamports) / 1e9;
      }
      sandwichIdx++;
    }
    points.push({ transaction: i + 1, value: cumulative });
  }

  return points;
}

export function calculateCumulativeLosses(results: SimulationResults): CumulativeDataPoint[] {
  const points: CumulativeDataPoint[] = [];
  let cumulative = 0;
  let sandwichIdx = 0;

  for (let i = 0; i < results.normalTrades.length; i++) {
    const trade = results.normalTrades[i];
    if (trade.wasAttacked && sandwichIdx < results.sandwichResults.length) {
      const sandwich = results.sandwichResults[sandwichIdx];
      if (sandwich.success) {
        cumulative += Number(sandwich.victimLossLamports) / 1e9;
      }
      sandwichIdx++;
    }
    points.push({ transaction: i + 1, value: cumulative });
  }

  return points;
}

export interface HistogramBucket {
  label: string;
  count: number;
}

export function calculateLossDistribution(results: SimulationResults): HistogramBucket[] {
  const successfulSandwiches = results.sandwichResults.filter(s => s.success);
  
  // Define buckets
  const buckets = [
    { min: 0, max: 0.001, label: "0-0.001" },
    { min: 0.001, max: 0.005, label: "0.001-0.005" },
    { min: 0.005, max: 0.01, label: "0.005-0.01" },
    { min: 0.01, max: 0.02, label: "0.01-0.02" },
    { min: 0.02, max: 0.05, label: "0.02-0.05" },
    { min: 0.05, max: 0.1, label: "0.05-0.1" },
    { min: 0.1, max: 0.2, label: "0.1-0.2" },
    { min: 0.2, max: Infinity, label: "0.2+" },
  ];

  const counts = new Map<string, number>();
  buckets.forEach(b => counts.set(b.label, 0));

  for (const sandwich of successfulSandwiches) {
    const lossSol = Number(sandwich.victimLossLamports) / 1e9;
    for (const bucket of buckets) {
      if (lossSol >= bucket.min && lossSol < bucket.max) {
        counts.set(bucket.label, (counts.get(bucket.label) || 0) + 1);
        break;
      }
    }
  }

  return buckets.map(b => ({
    label: b.label,
    count: counts.get(b.label) || 0,
  }));
}

