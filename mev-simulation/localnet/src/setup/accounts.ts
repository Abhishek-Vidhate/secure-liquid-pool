import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { SimulationConfig, lamportsToSol } from "../config.js";
import { AccountSetup } from "../types.js";
import { logSection, logProgress, endProgress, logOk, logger } from "../utils/logger.js";

// Batch size for parallel account creation
const BATCH_SIZE = 5;

/**
 * Create and fund all simulation accounts (parallelized in batches)
 */
export async function createSimulationAccounts(
  connection: Connection,
  payer: Keypair,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey,
  config: SimulationConfig
): Promise<{
  normalTraders: AccountSetup[];
  protectedTraders: AccountSetup[];
  attacker: AccountSetup;
}> {
  logSection("Creating Simulation Accounts");

  // Default balances
  const traderSol = BigInt(100 * LAMPORTS_PER_SOL); // 100 SOL
  const traderTokens = BigInt(100 * LAMPORTS_PER_SOL); // 100 tokens

  // Create normal traders in parallel batches
  logger.info(`Creating ${config.numNormalTraders} normal traders (batch size: ${BATCH_SIZE})...`);
  const normalTraders = await createAccountsInBatches(
    connection,
    payer,
    tokenAMint,
    tokenBMint,
    traderSol,
    traderTokens,
    config.numNormalTraders,
    "Normal Trader"
  );
  logOk(`Created ${normalTraders.length} normal traders`);

  // Create protected traders in parallel batches
  logger.info(`Creating ${config.numProtectedTraders} protected traders (batch size: ${BATCH_SIZE})...`);
  const protectedTraders = await createAccountsInBatches(
    connection,
    payer,
    tokenAMint,
    tokenBMint,
    traderSol,
    traderTokens,
    config.numProtectedTraders,
    "Protected Trader"
  );
  logOk(`Created ${protectedTraders.length} protected traders`);

  // Create attacker with more capital
  logger.info("Creating attacker account...");
  const attacker = await createFundedAccount(
    connection,
    payer,
    tokenAMint,
    tokenBMint,
    config.attackerCapital,
    config.attackerCapital,
    "Attacker"
  );
  logOk(`Created attacker with ${lamportsToSol(config.attackerCapital)} SOL capital`);

  logOk("All simulation accounts created");
  logger.info(`  Total accounts: ${normalTraders.length + protectedTraders.length + 1}`);
  logger.info(`  Total SOL distributed: ${lamportsToSol(
    BigInt(normalTraders.length + protectedTraders.length) * traderSol + config.attackerCapital
  )} SOL`);

  return { normalTraders, protectedTraders, attacker };
}

/**
 * Create accounts in parallel batches for speed
 */
async function createAccountsInBatches(
  connection: Connection,
  payer: Keypair,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey,
  solAmount: bigint,
  tokenAmount: bigint,
  count: number,
  labelPrefix: string
): Promise<AccountSetup[]> {
  const accounts: AccountSetup[] = [];
  
  for (let batchStart = 0; batchStart < count; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, count);
    const batchSize = batchEnd - batchStart;
    
    // Show progress
    logProgress(batchEnd, count, `Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}...`);
    
    // Create batch of accounts in parallel
    const batchPromises = [];
    for (let i = batchStart; i < batchEnd; i++) {
      batchPromises.push(
        createFundedAccount(
          connection,
          payer,
          tokenAMint,
          tokenBMint,
          solAmount,
          tokenAmount,
          `${labelPrefix} ${i + 1}`
        )
      );
    }
    
    const batchResults = await Promise.all(batchPromises);
    accounts.push(...batchResults);
  }
  
  endProgress();
  return accounts;
}

/**
 * Create a single funded account with SOL and tokens
 */
async function createFundedAccount(
  connection: Connection,
  payer: Keypair,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey,
  solAmount: bigint,
  tokenAmount: bigint,
  label: string
): Promise<AccountSetup> {
  // Generate new keypair
  const keypair = Keypair.generate();

  // Airdrop SOL
  const sig = await connection.requestAirdrop(keypair.publicKey, Number(solAmount));
  await connection.confirmTransaction(sig, "confirmed");

  // Create token accounts
  const tokenAAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    tokenAMint,
    keypair.publicKey
  );

  const tokenBAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    tokenBMint,
    keypair.publicKey
  );

  // Mint tokens
  await mintTo(
    connection,
    payer,
    tokenAMint,
    tokenAAccount.address,
    payer,
    tokenAmount
  );

  await mintTo(
    connection,
    payer,
    tokenBMint,
    tokenBAccount.address,
    payer,
    tokenAmount
  );

  return {
    publicKey: keypair.publicKey,
    tokenAAccount: tokenAAccount.address,
    tokenBAccount: tokenBAccount.address,
    solBalance: solAmount,
    tokenABalance: tokenAmount,
    tokenBBalance: tokenAmount,
    // Store keypair for signing (we need to extend the type)
    _keypair: keypair,
  } as AccountSetup & { _keypair: Keypair };
}

/**
 * Get current balances for an account
 */
export async function getAccountBalances(
  connection: Connection,
  account: AccountSetup
): Promise<{ sol: bigint; tokenA: bigint; tokenB: bigint }> {
  const solBalance = await connection.getBalance(account.publicKey);
  
  let tokenABalance = 0n;
  let tokenBBalance = 0n;
  
  try {
    const tokenAInfo = await connection.getTokenAccountBalance(account.tokenAAccount);
    tokenABalance = BigInt(tokenAInfo.value.amount);
  } catch {
    // Account might not exist
  }
  
  try {
    const tokenBInfo = await connection.getTokenAccountBalance(account.tokenBAccount);
    tokenBBalance = BigInt(tokenBInfo.value.amount);
  } catch {
    // Account might not exist
  }

  return {
    sol: BigInt(solBalance),
    tokenA: tokenABalance,
    tokenB: tokenBBalance,
  };
}

/**
 * Fund an existing account with more SOL
 */
export async function fundAccount(
  connection: Connection,
  publicKey: PublicKey,
  lamports: bigint
): Promise<void> {
  const sig = await connection.requestAirdrop(publicKey, Number(lamports));
  await connection.confirmTransaction(sig, "confirmed");
}

/**
 * Transfer SOL from payer to account
 */
export async function transferSol(
  connection: Connection,
  from: Keypair,
  to: PublicKey,
  lamports: bigint
): Promise<string> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports: Number(lamports),
    })
  );
  
  return await sendAndConfirmTransaction(connection, tx, [from]);
}

// Extended type for internal use
export interface AccountSetupWithKeypair extends AccountSetup {
  _keypair: Keypair;
}

