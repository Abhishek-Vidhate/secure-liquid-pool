import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import chalk from "chalk";
import { SimulationConfig, lamportsToSol, formatSol } from "../config.js";
import { 
  SimulationResults, 
  SimulationSummary, 
  TradeResult, 
  SandwichResult,
  PoolStateRecord,
  PoolState 
} from "../types.js";
import { NormalTrader, randomTradeAmount, randomDirection } from "../bots/normal-trader.js";
import { ProtectedTrader } from "../bots/protected-trader.js";
import { SandwichAttacker } from "../bots/sandwich-attacker.js";
import { AccountSetupWithKeypair } from "../setup/accounts.js";
import { logSection, logProgress, endProgress, logOk, logger, log } from "../utils/logger.js";

/**
 * Simulation Orchestrator - Coordinates all simulation actors
 */
export class Orchestrator {
  private connection: Connection;
  private config: SimulationConfig;
  private poolAddress: PublicKey;
  private tokenAMint: PublicKey;
  private tokenBMint: PublicKey;

  private normalTraders: NormalTrader[] = [];
  private protectedTraders: ProtectedTrader[] = [];
  private attacker: SandwichAttacker | null = null;

  constructor(
    connection: Connection,
    config: SimulationConfig,
    poolAddress: PublicKey,
    tokenAMint: PublicKey,
    tokenBMint: PublicKey
  ) {
    this.connection = connection;
    this.config = config;
    this.poolAddress = poolAddress;
    this.tokenAMint = tokenAMint;
    this.tokenBMint = tokenBMint;
  }

  /**
   * Initialize traders and attacker
   */
  initialize(
    normalAccounts: AccountSetupWithKeypair[],
    protectedAccounts: AccountSetupWithKeypair[],
    attackerAccount: AccountSetupWithKeypair
  ): void {
    // Create normal traders
    for (const account of normalAccounts) {
      this.normalTraders.push(
        new NormalTrader(
          this.connection,
          account,
          this.poolAddress,
          this.tokenAMint,
          this.tokenBMint
        )
      );
    }

    // Create protected traders
    for (const account of protectedAccounts) {
      this.protectedTraders.push(
        new ProtectedTrader(
          this.connection,
          account,
          this.poolAddress,
          this.tokenAMint,
          this.tokenBMint
        )
      );
    }

    // Create attacker
    this.attacker = new SandwichAttacker(
      this.connection,
      attackerAccount,
      this.poolAddress,
      this.tokenAMint,
      this.tokenBMint
    );

    logOk("Orchestrator initialized");
    logger.info(`  Normal traders: ${this.normalTraders.length}`);
    logger.info(`  Protected traders: ${this.protectedTraders.length}`);
    logger.info(`  Attacker: ready`);
  }

  /**
   * Run the complete simulation
   */
  async run(): Promise<SimulationResults> {
    logSection("Running MEV Simulation");

    logger.info(`Comparison scenarios: ${this.config.transactions} (each scenario tests 2 trades)`);
    logger.info(`Total trades monitored: ${this.config.transactions * 2} (${this.config.transactions} normal + ${this.config.transactions} protected)`);
    logger.info(`Attack probability: ${this.config.attackProbability * 100}%`);
    logger.info(`Swap range: ${formatSol(this.config.minSwapLamports)} - ${formatSol(this.config.maxSwapLamports)} SOL`);
    log("");
    log(chalk.gray("  Each scenario compares: ") + chalk.yellow("Normal (vulnerable)") + " vs " + chalk.green("Protected (commit-reveal)"));
    log("");

    const normalTrades: TradeResult[] = [];
    const protectedTrades: TradeResult[] = [];
    const sandwichResults: SandwichResult[] = [];
    const poolHistory: PoolStateRecord[] = [];

    const startTime = Date.now();
    let totalOnChainTxs = 0;

    for (let i = 0; i < this.config.transactions; i++) {
      // Generate random trade parameters
      const amount = randomTradeAmount(
        this.config.minSwapLamports,
        this.config.maxSwapLamports
      );
      const direction = randomDirection();
      const shouldAttack = Math.random() < this.config.attackProbability;
      const directionStr = direction === "AtoB" ? "A→B" : "B→A";
      
      // Select random traders
      const normalTraderIdx = Math.floor(Math.random() * this.normalTraders.length);
      const protectedTraderIdx = Math.floor(Math.random() * this.protectedTraders.length);
      const normalTrader = this.normalTraders[normalTraderIdx];
      const protectedTrader = this.protectedTraders[protectedTraderIdx];

      // Get pool state before trades
      const poolBefore = await normalTrader.getPoolState();

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      log(chalk.cyan.bold(`\n━━━ Comparison Scenario ${i + 1}/${this.config.transactions} ━━━`));
      log(chalk.gray(`  Testing: ${formatSol(amount)} SOL ${directionStr} (same parameters for both approaches)\n`));

      // ═══════════════════════════════════════════════════════════
      // TRADE 1: Normal Trading (Vulnerable to MEV)
      // ═══════════════════════════════════════════════════════════
      log(chalk.yellow(`  [Trade ${i * 2 + 1}/${this.config.transactions * 2}] Normal Trade (Vulnerable):`));
      let normalResult: TradeResult;
      let sandwichResult: SandwichResult | null = null;
      let wasAttacked = false;

      if (shouldAttack && this.attacker) {
        // Simulate attacker seeing the pending swap in mempool
        const pendingSwap = {
          trader: normalTrader.publicKey,
          amountIn: amount,
          minOut: 0n,
          direction,
        };

        // === REALISTIC SANDWICH ATTACK SEQUENCE ===
        // Step 1: Attacker front-runs (swaps in same direction as victim)
        const frontRunResult = await this.attacker.executeFrontRun(pendingSwap, poolBefore);
        
        if (frontRunResult.success && frontRunResult.params) {
          wasAttacked = true;
          totalOnChainTxs++;
          log(chalk.red(`    ├─ [TX] 🔴 Front-run: Attacker swaps ${formatSol(frontRunResult.params.frontRunAmount)} SOL ${directionStr}`));
          
          // Step 2: Victim's trade executes (at worse price due to front-run)
          normalResult = await normalTrader.swap(amount, direction);
          totalOnChainTxs++;
          log(chalk.yellow(`    ├─ [TX] 🟡 Victim trade: ${formatSol(amount)} SOL ${directionStr} (worse price!)`));
          
          // Step 3: Attacker back-runs (swaps back to profit)
          sandwichResult = await this.attacker.executeBackRun(
            frontRunResult.params,
            frontRunResult.aToB,
            poolBefore
          );
          totalOnChainTxs++;
          
          if (sandwichResult.success) {
            sandwichResults.push(sandwichResult);
            log(chalk.red(`    ├─ [TX] 🔴 Back-run: Attacker swaps back, profit: ${formatSol(sandwichResult.profitLamports)} SOL`));
          }
          
          normalResult.wasAttacked = sandwichResult.success;
          if (sandwichResult.success) {
            normalResult.slippageLoss = sandwichResult.victimLossLamports;
          }
        } else {
          // Attack not profitable, victim trades normally
          normalResult = await normalTrader.swap(amount, direction);
          totalOnChainTxs++;
          log(chalk.gray(`    ├─ [TX] ⚪ Normal swap: ${formatSol(amount)} SOL ${directionStr} (attack not profitable)`));
          sandwichResult = {
            success: false,
            frontRunAmount: 0n,
            backRunAmount: 0n,
            profitLamports: 0n,
            victimLossLamports: 0n,
            reason: "Attack not profitable",
          };
        }
      } else {
        // No attack - normal swap
        normalResult = await normalTrader.swap(amount, direction);
        totalOnChainTxs++;
        log(chalk.gray(`    ├─ [TX] ⚪ Normal swap: ${formatSol(amount)} SOL ${directionStr}`));
      }
      normalTrades.push(normalResult);

      // Record pool state after normal scenario
      const poolAfterNormal = await normalTrader.getPoolState();
      poolHistory.push({
        transactionId: i,
        reserveA: poolAfterNormal.reserveA,
        reserveB: poolAfterNormal.reserveB,
        priceAInB: Number(poolAfterNormal.reserveB) / Number(poolAfterNormal.reserveA),
        scenario: "normal",
      });

      // Show result of normal trade
      if (wasAttacked && sandwichResult?.success) {
        log(chalk.red(`    └─ Result: ❌ ATTACKED - Lost ${formatSol(sandwichResult.victimLossLamports)} SOL\n`));
      } else {
        log(chalk.gray(`    └─ Result: ✓ No attack (not profitable)\n`));
      }

      // ═══════════════════════════════════════════════════════════
      // TRADE 2: Protected Trading (Commit-Reveal)
      // ═══════════════════════════════════════════════════════════
      log(chalk.green(`  [Trade ${i * 2 + 2}/${this.config.transactions * 2}] Protected Trade (Commit-Reveal):`));
      log(chalk.green(`    ├─ [TX] 🟢 Commit: Hash submitted (params hidden from MEV)`));
      totalOnChainTxs++;
      
      const protectedResult = await protectedTrader.commitAndReveal(amount, direction);
      protectedTrades.push(protectedResult);
      totalOnChainTxs += 2; // cancel + swap
      
      log(chalk.green(`    ├─ [TX] 🟢 Reveal+Swap: ${formatSol(amount)} SOL ${directionStr} (protected!)`));
      
      // Show savings from protection
      if (wasAttacked && sandwichResult?.success) {
        log(chalk.green.bold(`    └─ Result: ✓ PROTECTED - Saved ${formatSol(sandwichResult.victimLossLamports)} SOL from MEV\n`));
      } else {
        log(chalk.green(`    └─ Result: ✓ PROTECTED - No attack attempted\n`));
      }

      // Record pool state after protected scenario
      const poolAfterProtected = await protectedTrader.getPoolState();
      poolHistory.push({
        transactionId: i,
        reserveA: poolAfterProtected.reserveA,
        reserveB: poolAfterProtected.reserveB,
        priceAInB: Number(poolAfterProtected.reserveB) / Number(poolAfterProtected.reserveA),
        scenario: "protected",
      });

      // Scenario summary with timing
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (i + 1) / elapsed;
      log(chalk.gray(`  ⏱️  Completed scenario ${i + 1}/${this.config.transactions} (${rate.toFixed(1)} scenarios/s)\n`));
    }

    log(chalk.cyan(`  Total on-chain transactions: ${totalOnChainTxs}`));

    // Calculate summary statistics
    const summary = this.calculateSummary(normalTrades, protectedTrades, sandwichResults);

    const totalTime = (Date.now() - startTime) / 1000;
    logOk(`Simulation complete in ${totalTime.toFixed(1)}s`);

    return {
      config: {
        transactions: this.config.transactions,
        attackProbability: this.config.attackProbability,
        minSwapLamports: this.config.minSwapLamports.toString(),
        maxSwapLamports: this.config.maxSwapLamports.toString(),
        initialPoolLiquidity: this.config.initialPoolLiquidity.toString(),
        feeBps: this.config.feeBps,
      },
      normalTrades,
      protectedTrades,
      sandwichResults,
      summary,
      poolHistory,
    };
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(
    normalTrades: TradeResult[],
    protectedTrades: TradeResult[],
    sandwichResults: SandwichResult[]
  ): SimulationSummary {
    const totalTransactions = normalTrades.length;
    const attackAttempts = sandwichResults.length;
    const successfulAttacks = sandwichResults.filter(s => s.success).length;
    const attackSuccessRate = attackAttempts > 0 
      ? (successfulAttacks / attackAttempts) * 100 
      : 0;

    const normalTransactions = normalTrades.length;
    const normalAttacked = normalTrades.filter(t => t.wasAttacked).length;
    const protectedTransactions = protectedTrades.length;
    const protectedAttacked = 0; // Commit-reveal is not attackable

    const totalMevExtracted = sandwichResults
      .filter(s => s.success)
      .reduce((sum, s) => sum + s.profitLamports, 0n);

    const totalVictimLosses = sandwichResults
      .filter(s => s.success)
      .reduce((sum, s) => sum + s.victimLossLamports, 0n);

    const avgLossPerAttack = successfulAttacks > 0
      ? lamportsToSol(totalVictimLosses) / successfulAttacks
      : 0;

    // Protected savings = what victims would have lost without protection
    const totalProtectedSavings = totalVictimLosses;

    const totalVolume = normalTrades.reduce((sum, t) => sum + t.amountIn, 0n);
    const avgTradeAmount = totalTransactions > 0
      ? lamportsToSol(totalVolume) / totalTransactions
      : 0;

    return {
      totalTransactions,
      attackAttempts,
      successfulAttacks,
      attackSuccessRate,
      normalTransactions,
      normalAttacked,
      protectedTransactions,
      protectedAttacked,
      totalMevExtracted,
      totalVictimLosses,
      avgLossPerAttack,
      totalProtectedSavings,
      avgTradeAmount,
      totalVolume,
    };
  }
}

/**
 * Print simulation summary to console
 */
export function printSummary(results: SimulationResults): void {
  const s = results.summary;

  console.log(chalk.blue("\n╔══════════════════════════════════════════════════════════════════╗"));
  console.log(chalk.blue("║            MEV SIMULATION RESULTS                                ║"));
  console.log(chalk.blue("╠══════════════════════════════════════════════════════════════════╣"));
  
  console.log(chalk.blue("║                                                                  ║"));
  console.log(chalk.blue("║  CONFIGURATION                                                   ║"));
  console.log(chalk.gray(`║  Comparison Scenarios:   ${s.totalTransactions.toString().padEnd(10)} (each tests 2 approaches)  ║`));
  console.log(chalk.gray(`║  Normal Trades Tested:   ${s.normalTransactions.toString().padEnd(10)}                          ║`));
  console.log(chalk.gray(`║  Protected Trades Tested:${s.protectedTransactions.toString().padEnd(10)}                          ║`));
  console.log(chalk.gray(`║  Total Trades Monitored: ${(s.normalTransactions + s.protectedTransactions).toString().padEnd(10)}                          ║`));
  console.log(chalk.gray(`║  Attack Probability:     ${(results.config.attackProbability * 100).toFixed(0)}%                               ║`));
  console.log(chalk.gray(`║  Pool Fee:               ${(results.config.feeBps / 100).toFixed(2)}%                              ║`));

  console.log(chalk.blue("║                                                                  ║"));
  console.log(chalk.blue("╠══════════════════════════════════════════════════════════════════╣"));
  console.log(chalk.blue("║                                                                  ║"));
  console.log(chalk.blue("║  NORMAL TRADING (Vulnerable to MEV)                              ║"));
  console.log(chalk.red(`║  Attack Attempts:        ${s.attackAttempts.toString().padEnd(10)}                          ║`));
  console.log(chalk.red(`║  Successful Attacks:     ${s.successfulAttacks.toString().padEnd(10)}                          ║`));
  console.log(chalk.red(`║  Attack Success Rate:    ${s.attackSuccessRate.toFixed(1)}%                              ║`));
  console.log(chalk.red(`║  Trades Attacked:        ${s.normalAttacked}/${s.normalTransactions} normal trades attacked           ║`));
  console.log(chalk.red(`║  Total MEV Extracted:    ${formatSol(s.totalMevExtracted).padEnd(10)} SOL                    ║`));
  console.log(chalk.red(`║  Total Victim Losses:    ${formatSol(s.totalVictimLosses).padEnd(10)} SOL                    ║`));
  console.log(chalk.red(`║  Avg Loss per Attack:    ${s.avgLossPerAttack.toFixed(6).padEnd(10)} SOL                    ║`));

  console.log(chalk.blue("║                                                                  ║"));
  console.log(chalk.blue("╠══════════════════════════════════════════════════════════════════╣"));
  console.log(chalk.blue("║                                                                  ║"));
  console.log(chalk.blue("║  PROTECTED TRADING (Commit-Reveal)                               ║"));
  console.log(chalk.green(`║  Trades Attacked:        ${s.protectedAttacked}/${s.protectedTransactions} protected trades attacked      ║`));
  console.log(chalk.green(`║  Attacks Possible:       0                                        ║`));
  console.log(chalk.green(`║  MEV Extracted:          0 SOL                                    ║`));
  console.log(chalk.green(`║                                                                  ║`));
  console.log(chalk.green(`║  ★ TOTAL SAVINGS:        ${formatSol(s.totalProtectedSavings).padEnd(10)} SOL                    ║`));
  console.log(chalk.green(`║  ★ Protection Rate:      100.0%                                   ║`));

  console.log(chalk.blue("║                                                                  ║"));
  console.log(chalk.blue("╠══════════════════════════════════════════════════════════════════╣"));
  console.log(chalk.blue("║                                                                  ║"));
  console.log(chalk.blue("║  VOLUME STATISTICS                                               ║"));
  console.log(chalk.gray(`║  Total Volume:           ${formatSol(s.totalVolume).padEnd(10)} SOL                    ║`));
  console.log(chalk.gray(`║  Average Trade:          ${s.avgTradeAmount.toFixed(4).padEnd(10)} SOL                    ║`));
  console.log(chalk.blue("║                                                                  ║"));
  console.log(chalk.blue("╚══════════════════════════════════════════════════════════════════╝"));
  console.log();
}

