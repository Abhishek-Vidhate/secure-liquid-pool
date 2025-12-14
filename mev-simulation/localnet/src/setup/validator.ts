import { spawn, ChildProcess, execSync } from "child_process";
import { Connection } from "@solana/web3.js";
import path from "path";
import fs from "fs";
import chalk from "chalk";
import { RPC_URL, PROGRAM_IDS } from "../config.js";

// Paths
const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../../..");
const SECURELP_DIR = path.resolve(PROJECT_ROOT, "securelp");
const OUTPUT_DIR = path.resolve(import.meta.dirname, "../../output/validator");

export interface ValidatorInstance {
  process: ChildProcess;
  pid: number;
  logPath: string;
  ledgerPath: string;
}

/**
 * Check if required program binaries exist
 */
function checkProgramBinaries(): void {
  const programs = [
    { name: "stake_pool", path: path.join(SECURELP_DIR, "target/deploy/stake_pool.so") },
    { name: "amm", path: path.join(SECURELP_DIR, "target/deploy/amm.so") },
    { name: "securelp", path: path.join(SECURELP_DIR, "target/deploy/securelp.so") },
  ];

  for (const prog of programs) {
    if (!fs.existsSync(prog.path)) {
      throw new Error(
        `${prog.name}.so not found at ${prog.path}\n` +
        `Please build the programs first: cd ${SECURELP_DIR} && anchor build`
      );
    }
  }
  console.log(chalk.green("✓ All program binaries found"));
}

/**
 * Kill any existing solana-test-validator processes
 */
export function killExistingValidator(): void {
  try {
    execSync("pkill -f solana-test-validator 2>/dev/null || true", { stdio: "ignore" });
    // Give it time to clean up
    execSync("sleep 2");
    console.log(chalk.yellow("⚠ Killed existing validator processes"));
  } catch {
    // Ignore errors - no validator running
  }
}

/**
 * Start solana-test-validator with programs pre-loaded
 */
export async function startValidator(): Promise<ValidatorInstance> {
  console.log(chalk.blue("\n══════════════════════════════════════════════"));
  console.log(chalk.blue("  Starting Solana Test Validator"));
  console.log(chalk.blue("══════════════════════════════════════════════\n"));

  // Check binaries
  checkProgramBinaries();

  // Kill existing
  killExistingValidator();

  // Create output directories
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ledgerPath = path.join(OUTPUT_DIR, "ledger");
  const logPath = path.join(OUTPUT_DIR, "validator.log");

  // Clean old ledger
  if (fs.existsSync(ledgerPath)) {
    fs.rmSync(ledgerPath, { recursive: true });
  }

  console.log(chalk.gray("Program IDs:"));
  console.log(chalk.gray(`  Stake Pool: ${PROGRAM_IDS.STAKE_POOL.toString()}`));
  console.log(chalk.gray(`  AMM:        ${PROGRAM_IDS.AMM.toString()}`));
  console.log(chalk.gray(`  SecureLP:   ${PROGRAM_IDS.SECURELP.toString()}`));
  console.log();

  // Build command arguments
  const args = [
    "--reset",
    "--bpf-program", PROGRAM_IDS.STAKE_POOL.toString(), path.join(SECURELP_DIR, "target/deploy/stake_pool.so"),
    "--bpf-program", PROGRAM_IDS.AMM.toString(), path.join(SECURELP_DIR, "target/deploy/amm.so"),
    "--bpf-program", PROGRAM_IDS.SECURELP.toString(), path.join(SECURELP_DIR, "target/deploy/securelp.so"),
    "--clone", PROGRAM_IDS.TOKEN_METADATA.toString(), "--url", "mainnet-beta",
    "--ledger", ledgerPath,
    "--log",
  ];

  // Start validator with redirect to log file
  const logFd = fs.openSync(logPath, "w");
  const validatorProcess = spawn("solana-test-validator", args, {
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });

  if (!validatorProcess.pid) {
    fs.closeSync(logFd);
    throw new Error("Failed to start validator process");
  }
  
  // Unref to allow parent to exit
  validatorProcess.unref();

  console.log(chalk.green(`✓ Validator started with PID: ${validatorProcess.pid}`));
  console.log(chalk.gray(`  Log file: ${logPath}`));

  // Wait for validator to be ready
  await waitForValidator(30000);

  return {
    process: validatorProcess,
    pid: validatorProcess.pid,
    logPath,
    ledgerPath,
  };
}

/**
 * Wait for validator to be healthy
 */
export async function waitForValidator(maxWaitMs: number = 30000): Promise<void> {
  console.log(chalk.gray("Waiting for validator to be ready..."));
  
  const connection = new Connection(RPC_URL, "confirmed");
  const startTime = Date.now();
  let attempts = 0;

  while (Date.now() - startTime < maxWaitMs) {
    attempts++;
    try {
      // Use getSlot to check if validator is responding
      await connection.getSlot();
      console.log(chalk.green(`✓ Validator is healthy (${attempts} attempts)`));
      
      // Verify programs are loaded
      await verifyPrograms(connection);
      return;
    } catch {
      // Still starting up
    }

    if (attempts % 5 === 0) {
      console.log(chalk.gray(`  Attempt ${attempts}... (${Math.round((Date.now() - startTime) / 1000)}s)`));
    }
    await sleep(500);
  }

  throw new Error(`Validator did not become ready within ${maxWaitMs}ms`);
}

/**
 * Verify all required programs are deployed
 */
async function verifyPrograms(connection: Connection): Promise<void> {
  const programs = [
    { name: "Stake Pool", id: PROGRAM_IDS.STAKE_POOL },
    { name: "AMM", id: PROGRAM_IDS.AMM },
    { name: "SecureLP", id: PROGRAM_IDS.SECURELP },
  ];

  for (const prog of programs) {
    const accountInfo = await connection.getAccountInfo(prog.id);
    if (!accountInfo || !accountInfo.executable) {
      throw new Error(`${prog.name} program not loaded at ${prog.id.toString()}`);
    }
  }
  console.log(chalk.green("✓ All programs verified"));
}

/**
 * Stop the validator
 */
export async function stopValidator(instance: ValidatorInstance): Promise<void> {
  console.log(chalk.yellow(`\nStopping validator (PID: ${instance.pid})...`));
  
  try {
    process.kill(instance.pid, "SIGTERM");
    await sleep(2000);
    
    // Force kill if still running
    try {
      process.kill(instance.pid, 0); // Check if still alive
      process.kill(instance.pid, "SIGKILL");
    } catch {
      // Process already dead
    }
    
    console.log(chalk.green("✓ Validator stopped"));
  } catch (error) {
    console.log(chalk.red(`Failed to stop validator: ${error}`));
  }
}

/**
 * Check if validator is running
 */
export async function isValidatorRunning(): Promise<boolean> {
  try {
    const connection = new Connection(RPC_URL, "confirmed");
    await connection.getSlot();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get connection to localnet
 */
export function getConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

// Helper
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

