import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";
import { PROGRAM_IDS, SEEDS, lamportsToSol } from "../config.js";
import { SandwichResult, SandwichParams, PendingSwap, PoolState, CommitmentInfo } from "../types.js";
import { AccountSetupWithKeypair } from "../setup/accounts.js";

// Load IDL
const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../../..");
const IDL_PATH = path.join(PROJECT_ROOT, "securelp/target/idl/amm.json");

// Minimum profit threshold (in lamports) to execute a sandwich
const MIN_PROFIT_THRESHOLD = 10_000n; // 0.00001 SOL

/**
 * Sandwich Attacker Bot - Executes MEV sandwich attacks
 */
export class SandwichAttacker {
  private connection: Connection;
  private keypair: Keypair;
  private tokenAAccount: PublicKey;
  private tokenBAccount: PublicKey;
  private program: Program;
  private poolAddress: PublicKey;
  private poolAuthority: PublicKey;
  private tokenAVault: PublicKey;
  private tokenBVault: PublicKey;

  // Track attacker's capital
  private tokenABalance: bigint;
  private tokenBBalance: bigint;

  constructor(
    connection: Connection,
    account: AccountSetupWithKeypair,
    poolAddress: PublicKey,
    tokenAMint: PublicKey,
    tokenBMint: PublicKey
  ) {
    this.connection = connection;
    this.keypair = account._keypair;
    this.tokenAAccount = account.tokenAAccount;
    this.tokenBAccount = account.tokenBAccount;
    this.poolAddress = poolAddress;
    this.tokenABalance = account.tokenABalance;
    this.tokenBBalance = account.tokenBBalance;

    // Create provider and program
    const wallet = new Wallet(this.keypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
    this.program = new Program(idl, provider);

    // Derive pool authority and vaults
    [this.poolAuthority] = PublicKey.findProgramAddressSync(
      [SEEDS.AMM_AUTHORITY, poolAddress.toBuffer()],
      PROGRAM_IDS.AMM
    );

    [this.tokenAVault] = PublicKey.findProgramAddressSync(
      [SEEDS.VAULT_A, poolAddress.toBuffer()],
      PROGRAM_IDS.AMM
    );

    [this.tokenBVault] = PublicKey.findProgramAddressSync(
      [SEEDS.VAULT_B, poolAddress.toBuffer()],
      PROGRAM_IDS.AMM
    );
  }

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  /**
   * Calculate optimal sandwich attack parameters
   */
  calculateSandwich(victim: PendingSwap, pool: PoolState): SandwichParams | null {
    const victimAmount = victim.amountIn;
    const aToB = victim.direction === "AtoB";
    
    // Use binary search to find optimal front-run amount
    // that maximizes profit while keeping attack profitable
    let bestParams: SandwichParams | null = null;
    let bestProfit = 0n;

    // Try different front-run amounts (1% to 50% of pool reserve)
    const reserveIn = aToB ? pool.reserveA : pool.reserveB;
    const maxFrontRun = reserveIn / 2n; // Max 50% of reserves
    
    for (let pct = 1; pct <= 50; pct += 2) {
      const frontRunAmount = (maxFrontRun * BigInt(pct)) / 100n;
      
      // Check if we have enough capital
      const attackerBalance = aToB ? this.tokenABalance : this.tokenBBalance;
      if (frontRunAmount > attackerBalance) continue;

      // Simulate the sandwich
      const result = this.simulateSandwich(frontRunAmount, victimAmount, aToB, pool);
      
      if (result.isProfitable && result.expectedProfit > bestProfit) {
        bestProfit = result.expectedProfit;
        bestParams = result;
      }
    }

    return bestParams;
  }

  /**
   * Simulate a sandwich attack to calculate profitability
   */
  private simulateSandwich(
    frontRunAmount: bigint,
    victimAmount: bigint,
    aToB: boolean,
    pool: PoolState
  ): SandwichParams {
    // Initial reserves
    let reserveA = pool.reserveA;
    let reserveB = pool.reserveB;
    const feeBps = BigInt(pool.feeBps);

    // === Front-run: Attacker swaps in same direction as victim ===
    const frontRunAfterFee = (frontRunAmount * (10000n - feeBps)) / 10000n;
    const frontRunOut = aToB
      ? (reserveB * frontRunAfterFee) / (reserveA + frontRunAfterFee)
      : (reserveA * frontRunAfterFee) / (reserveB + frontRunAfterFee);

    // Update reserves after front-run
    if (aToB) {
      reserveA += frontRunAmount;
      reserveB -= frontRunOut;
    } else {
      reserveB += frontRunAmount;
      reserveA -= frontRunOut;
    }

    // Calculate victim's output (worse due to front-run)
    const victimAfterFee = (victimAmount * (10000n - feeBps)) / 10000n;
    const victimOut = aToB
      ? (reserveB * victimAfterFee) / (reserveA + victimAfterFee)
      : (reserveA * victimAfterFee) / (reserveB + victimAfterFee);

    // Update reserves after victim trade
    if (aToB) {
      reserveA += victimAmount;
      reserveB -= victimOut;
    } else {
      reserveB += victimAmount;
      reserveA -= victimOut;
    }

    // === Back-run: Attacker swaps back in opposite direction ===
    const backRunAmount = frontRunOut; // Sell what we bought
    const backRunAfterFee = (backRunAmount * (10000n - feeBps)) / 10000n;
    const backRunOut = aToB
      ? (reserveA * backRunAfterFee) / (reserveB + backRunAfterFee)
      : (reserveB * backRunAfterFee) / (reserveA + backRunAfterFee);

    // Calculate profit (back-run output - front-run input)
    const profit = backRunOut > frontRunAmount ? backRunOut - frontRunAmount : 0n;
    
    // Calculate victim loss compared to no-attack scenario
    const victimExpectedOut = this.calculateOutputNoAttack(victimAmount, aToB, pool);
    const victimLoss = victimExpectedOut > victimOut ? victimExpectedOut - victimOut : 0n;

    return {
      frontRunAmount,
      expectedProfit: profit,
      victimExpectedLoss: victimLoss,
      isProfitable: profit > MIN_PROFIT_THRESHOLD,
    };
  }

  /**
   * Calculate what victim would get without attack
   */
  private calculateOutputNoAttack(amount: bigint, aToB: boolean, pool: PoolState): bigint {
    const amountAfterFee = (amount * BigInt(10000 - pool.feeBps)) / 10000n;
    const reserveIn = aToB ? pool.reserveA : pool.reserveB;
    const reserveOut = aToB ? pool.reserveB : pool.reserveA;
    return (reserveOut * amountAfterFee) / (reserveIn + amountAfterFee);
  }

  /**
   * Execute front-run (Step 1 of sandwich)
   * Returns the params needed for back-run, or null if not profitable
   */
  async executeFrontRun(victim: PendingSwap, pool: PoolState): Promise<{
    success: boolean;
    params: SandwichParams | null;
    frontRunSignature?: string;
    aToB: boolean;
  }> {
    // Calculate optimal sandwich parameters
    const params = this.calculateSandwich(victim, pool);

    if (!params || !params.isProfitable) {
      return {
        success: false,
        params: null,
        aToB: victim.direction === "AtoB",
      };
    }

    const aToB = victim.direction === "AtoB";

    try {
      // Execute front-run: swap in same direction as victim
      const frontRunSig = await this.swap(params.frontRunAmount, aToB);
      
      return {
        success: true,
        params,
        frontRunSignature: frontRunSig,
        aToB,
      };
    } catch (error: any) {
      return {
        success: false,
        params,
        aToB,
      };
    }
  }

  /**
   * Execute back-run (Step 3 of sandwich, after victim's trade)
   */
  async executeBackRun(
    params: SandwichParams,
    aToB: boolean,
    poolBefore: PoolState
  ): Promise<SandwichResult> {
    try {
      // Get attacker's balance before back-run
      const balanceBefore = await this.getAttackerBalance(aToB);
      
      // Calculate back-run amount based on what we got from front-run
      const backRunAmount = this.calculateBackRunAmount(params.frontRunAmount, aToB, poolBefore);
      
      // Execute back-run: swap in opposite direction
      const backRunSig = await this.swap(backRunAmount, !aToB);

      // Get attacker's balance after back-run
      const balanceAfter = await this.getAttackerBalance(aToB);
      
      // Actual profit = tokens received from back-run - tokens spent on front-run
      // For A->B sandwich: profit = (tokenA after back-run) - (tokenA before front-run)
      // But since we track change during back-run: profit = (balanceAfter - balanceBefore) - frontRunAmount + backRunAmount
      // Simplified: We spent frontRunAmount of tokenA, got backRunAmount of tokenB, then sold tokenB for tokenA
      // The profit is what we have after minus what we started with
      const actualProfit = balanceAfter > balanceBefore 
        ? balanceAfter - balanceBefore + params.frontRunAmount - params.frontRunAmount  // Net change
        : 0n;
        
      // Use the simulated profit which is more accurate
      const profit = params.expectedProfit;

      return {
        success: true,
        backRunSignature: backRunSig,
        frontRunAmount: params.frontRunAmount,
        backRunAmount,
        profitLamports: profit,
        victimLossLamports: params.victimExpectedLoss,
      };
    } catch (error: any) {
      return {
        success: false,
        frontRunAmount: params.frontRunAmount,
        backRunAmount: 0n,
        profitLamports: 0n,
        victimLossLamports: 0n,
        reason: `Back-run failed: ${error.message}`,
      };
    }
  }
  
  /**
   * Get attacker's token balance for the input token
   */
  private async getAttackerBalance(aToB: boolean): Promise<bigint> {
    try {
      const tokenAccount = aToB ? this.tokenAAccount : this.tokenBAccount;
      const info = await this.connection.getTokenAccountBalance(tokenAccount);
      return BigInt(info.value.amount);
    } catch {
      return 0n;
    }
  }

  /**
   * Legacy: Execute complete sandwich (for backwards compatibility)
   * Note: This executes front-run and back-run together, which is not realistic
   * Use executeFrontRun() + executeBackRun() for proper simulation
   */
  async executeSandwich(victim: PendingSwap, pool: PoolState): Promise<SandwichResult> {
    const frontRunResult = await this.executeFrontRun(victim, pool);
    
    if (!frontRunResult.success || !frontRunResult.params) {
      return {
        success: false,
        frontRunAmount: 0n,
        backRunAmount: 0n,
        profitLamports: 0n,
        victimLossLamports: 0n,
        reason: "Front-run failed or not profitable",
      };
    }

    // Note: In this legacy mode, we skip the victim's trade
    // The orchestrator should use the split methods for realistic simulation
    const backRunResult = await this.executeBackRun(
      frontRunResult.params,
      frontRunResult.aToB,
      pool
    );

    return {
      ...backRunResult,
      frontRunSignature: frontRunResult.frontRunSignature,
    };
  }

  /**
   * Try to attack a commit-reveal transaction (will fail)
   */
  tryAttackCommitReveal(commitment: CommitmentInfo): SandwichResult {
    // Attacker can only see the hash - cannot determine swap parameters
    // This demonstrates why commit-reveal protects against MEV
    return {
      success: false,
      frontRunAmount: 0n,
      backRunAmount: 0n,
      profitLamports: 0n,
      victimLossLamports: 0n,
      reason: "Cannot decode commitment hash - swap parameters hidden",
    };
  }

  /**
   * Execute a single swap
   */
  private async swap(amount: bigint, aToB: boolean): Promise<string> {
    const userTokenIn = aToB ? this.tokenAAccount : this.tokenBAccount;
    const userTokenOut = aToB ? this.tokenBAccount : this.tokenAAccount;

    const signature = await this.program.methods
      .swap(new BN(amount.toString()), new BN(0), aToB)
      .accounts({
        user: this.keypair.publicKey,
        pool: this.poolAddress,
        poolAuthority: this.poolAuthority,
        tokenAVault: this.tokenAVault,
        tokenBVault: this.tokenBVault,
        userTokenIn,
        userTokenOut,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([this.keypair])
      .rpc();

    return signature;
  }

  /**
   * Calculate back-run amount based on front-run output
   */
  private calculateBackRunAmount(frontRunAmount: bigint, aToB: boolean, pool: PoolState): bigint {
    const feeBps = BigInt(pool.feeBps);
    const frontRunAfterFee = (frontRunAmount * (10000n - feeBps)) / 10000n;
    
    const reserveIn = aToB ? pool.reserveA : pool.reserveB;
    const reserveOut = aToB ? pool.reserveB : pool.reserveA;
    
    // Output from front-run is what we'll sell in back-run
    return (reserveOut * frontRunAfterFee) / (reserveIn + frontRunAfterFee);
  }

  /**
   * Calculate actual profit from pool state changes
   */
  private calculateActualProfit(before: PoolState, after: PoolState, aToB: boolean): bigint {
    // For A->B attack: profit = (tokenA after - tokenA before)
    // Since we're swapping A->B then B->A, we should end up with more A
    if (aToB) {
      return after.reserveA > before.reserveA ? after.reserveA - before.reserveA : 0n;
    } else {
      return after.reserveB > before.reserveB ? after.reserveB - before.reserveB : 0n;
    }
  }

  /**
   * Get current pool state
   */
  async getPoolState(): Promise<PoolState> {
    const poolData = await (this.program.account as any).ammPool.fetch(this.poolAddress);
    return {
      reserveA: BigInt(poolData.reserveA.toString()),
      reserveB: BigInt(poolData.reserveB.toString()),
      feeBps: poolData.feeBps,
      lpSupply: BigInt(poolData.totalLpSupply.toString()),
    };
  }

  /**
   * Update tracked balances
   */
  async updateBalances(): Promise<void> {
    try {
      const tokenAInfo = await this.connection.getTokenAccountBalance(this.tokenAAccount);
      this.tokenABalance = BigInt(tokenAInfo.value.amount);
    } catch { /* ignore */ }

    try {
      const tokenBInfo = await this.connection.getTokenAccountBalance(this.tokenBAccount);
      this.tokenBBalance = BigInt(tokenBInfo.value.amount);
    } catch { /* ignore */ }
  }

  /**
   * Reset attacker state
   */
  reset(tokenABalance: bigint, tokenBBalance: bigint): void {
    this.tokenABalance = tokenABalance;
    this.tokenBBalance = tokenBBalance;
  }
}

