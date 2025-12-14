#!/usr/bin/env node

import { Command } from "commander";
import { Keypair, Connection } from "@solana/web3.js";
import chalk from "chalk";
import fs from "fs";
import path from "path";

import { DEFAULT_CONFIG, SimulationConfig, solToLamports, RPC_URL, WS_URL } from "./config.js";
import { startValidator, stopValidator, isValidatorRunning, ValidatorInstance } from "./setup/validator.js";
import { deployPools } from "./setup/deploy.js";
import { createSimulationAccounts, AccountSetupWithKeypair } from "./setup/accounts.js";
import { Orchestrator, printSummary } from "./simulation/orchestrator.js";
import { saveResults, saveSummary } from "./analytics/collector.js";
import { generateReport } from "./analytics/report.js";
import { SimulatedMempool } from "./simulation/mempool-monitor.js";

const program = new Command();

program
  .name("mev-localnet-sim")
  .description("Solana Localnet MEV Simulation - Test commit-reveal protection on-chain")
  .version("1.0.0");

program
  .command("run")
  .description("Run the MEV simulation on localnet")
  .option("-t, --transactions <number>", "Number of transactions to simulate", "100")
  .option("-a, --attack-prob <number>", "Attack probability (0-1)", "0.8")
  .option("--min-swap <number>", "Minimum swap amount in SOL", "0.1")
  .option("--max-swap <number>", "Maximum swap amount in SOL", "5.0")
  .option("--liquidity <number>", "Initial pool liquidity in SOL", "1000")
  .option("-o, --output <dir>", "Output directory", "output")
  .option("--no-report", "Skip HTML report generation")
  .option("--keep-validator", "Keep validator running after simulation")
  .option("--use-existing", "Use existing validator if running")
  .action(async (options) => {
    console.log(chalk.cyan(`
╔══════════════════════════════════════════════════════════════════╗
║     SecureLiquidPool - Localnet MEV Simulation                   ║
║     Testing Commit-Reveal Protection On-Chain                    ║
╚══════════════════════════════════════════════════════════════════╝
`));

    // Build configuration
    const config: SimulationConfig = {
      ...DEFAULT_CONFIG,
      transactions: parseInt(options.transactions),
      attackProbability: parseFloat(options.attackProb),
      minSwapLamports: solToLamports(parseFloat(options.minSwap)),
      maxSwapLamports: solToLamports(parseFloat(options.maxSwap)),
      initialPoolLiquidity: solToLamports(parseFloat(options.liquidity)),
      outputDir: options.output,
      generateReport: options.report !== false,
    };

    let validatorInstance: ValidatorInstance | null = null;
    let connection: Connection | null = null;
    
    try {
      // Check if validator is already running
      if (options.useExisting && await isValidatorRunning()) {
        console.log(chalk.yellow("Using existing validator..."));
      } else {
        // Start fresh validator
        validatorInstance = await startValidator();
      }

      // Create connection with explicit WebSocket endpoint
      connection = new Connection(RPC_URL, {
        commitment: "confirmed",
        wsEndpoint: WS_URL,
      });

      // Load or create payer keypair
      const payerPath = path.join(process.env.HOME || "", ".config/solana/id.json");
      let payer: Keypair;
      
      if (fs.existsSync(payerPath)) {
        const payerData = JSON.parse(fs.readFileSync(payerPath, "utf-8"));
        payer = Keypair.fromSecretKey(Uint8Array.from(payerData));
        console.log(chalk.gray(`Using wallet: ${payer.publicKey.toString()}`));
      } else {
        payer = Keypair.generate();
        console.log(chalk.yellow(`Generated new wallet: ${payer.publicKey.toString()}`));
      }

      // Airdrop SOL to payer
      console.log(chalk.gray("Funding payer wallet..."));
      const sig = await connection.requestAirdrop(payer.publicKey, 10000 * 1e9); // 10000 SOL
      await connection.confirmTransaction(sig, "confirmed");
      console.log(chalk.green("✓ Payer funded with 10000 SOL"));

      // Deploy AMM pool
      const { ammPoolSetup, tokenAMint, tokenBMint } = await deployPools(connection, payer, config);

      // Create simulation accounts
      const { normalTraders, protectedTraders, attacker } = await createSimulationAccounts(
        connection,
        payer,
        tokenAMint,
        tokenBMint,
        config
      );

      // Initialize orchestrator
      const orchestrator = new Orchestrator(
        connection,
        config,
        ammPoolSetup.poolAddress,
        tokenAMint,
        tokenBMint
      );

      orchestrator.initialize(
        normalTraders as AccountSetupWithKeypair[],
        protectedTraders as AccountSetupWithKeypair[],
        attacker as AccountSetupWithKeypair
      );

      // Run simulation
      const results = await orchestrator.run();

      // Print summary
      printSummary(results);

      // Save results
      const outputDir = path.resolve(config.outputDir);
      fs.mkdirSync(outputDir, { recursive: true });

      const resultsPath = saveResults(results, outputDir);
      console.log(chalk.gray(`📁 Results saved: ${resultsPath}`));

      const summaryPath = saveSummary(results, outputDir);
      console.log(chalk.gray(`📄 Summary saved: ${summaryPath}`));

      // Generate report
      if (config.generateReport) {
        const reportPath = generateReport(results, outputDir);
        console.log(chalk.cyan(`\n📊 Report generated: ${reportPath}`));
        console.log(chalk.gray("   Open in browser to view interactive charts"));
      }

      // Explain the protection
      console.log(SimulatedMempool.explainProtection());

    } catch (error: any) {
      console.error(chalk.red(`\nError: ${error.message}`));
      console.error(error.stack);
      process.exit(1);
    } finally {
      // Cleanup: Close WebSocket connection first to prevent reconnect spam
      if (connection) {
        try {
          // Access the internal RPC WebSocket and close it
          const ws = (connection as any)._rpcWebSocket;
          if (ws && typeof ws.close === "function") {
            ws.close();
          }
        } catch {
          // Ignore cleanup errors
        }
      }
      
      // Stop validator
      if (validatorInstance && !options.keepValidator) {
        await stopValidator(validatorInstance);
      } else if (validatorInstance) {
        console.log(chalk.yellow(`\nValidator still running (PID: ${validatorInstance.pid})`));
        console.log(chalk.gray(`To stop: kill ${validatorInstance.pid}`));
      }
    }
  });

program
  .command("explain")
  .description("Explain how commit-reveal protects against MEV")
  .action(() => {
    console.log(SimulatedMempool.explainProtection());
  });

program
  .command("report")
  .description("Generate report from existing results")
  .argument("<input>", "Path to results JSON file")
  .option("-o, --output <dir>", "Output directory", "output")
  .action(async (input, options) => {
    const { loadResults } = await import("./analytics/collector.js");
    
    console.log(chalk.gray(`Loading results from: ${input}`));
    const results = loadResults(input);
    
    const reportPath = generateReport(results, options.output);
    console.log(chalk.cyan(`📊 Report generated: ${reportPath}`));
  });

program.parse();

