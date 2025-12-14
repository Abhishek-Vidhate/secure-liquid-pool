import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";
import { PROGRAM_IDS, SEEDS } from "../config.js";
import { TradeResult, SwapDirection, PoolState } from "../types.js";
import { AccountSetupWithKeypair } from "../setup/accounts.js";

// Load IDL
const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../../..");
const IDL_PATH = path.join(PROJECT_ROOT, "securelp/target/idl/amm.json");

/**
 * Normal Trader Bot - Executes direct AMM swaps (VULNERABLE to MEV)
 */
export class NormalTrader {
  private connection: Connection;
  private keypair: Keypair;
  private tokenAAccount: PublicKey;
  private tokenBAccount: PublicKey;
  private program: Program;
  private poolAddress: PublicKey;
  private poolAuthority: PublicKey;
  private tokenAVault: PublicKey;
  private tokenBVault: PublicKey;

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
   * Execute a direct AMM swap
   * VULNERABLE: This transaction is visible in mempool before execution
   */
  async swap(
    amountIn: bigint,
    direction: SwapDirection,
    minOut: bigint = 0n
  ): Promise<TradeResult> {
    const aToB = direction === "AtoB";
    const userTokenIn = aToB ? this.tokenAAccount : this.tokenBAccount;
    const userTokenOut = aToB ? this.tokenBAccount : this.tokenAAccount;

    // Calculate expected output before swap
    const poolState = await this.getPoolState();
    const expectedOut = this.calculateExpectedOutput(amountIn, aToB, poolState);

    const startTime = Date.now();

    try {
      const signature = await this.program.methods
        .swap(new BN(amountIn.toString()), new BN(minOut.toString()), aToB)
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

      // Get actual output from transaction result
      const poolStateAfter = await this.getPoolState();
      const actualOut = this.calculateActualOutput(poolState, poolStateAfter, aToB);

      return {
        signature,
        trader: this.keypair.publicKey.toString(),
        amountIn,
        expectedOut,
        actualOut,
        slippageLoss: expectedOut > actualOut ? expectedOut - actualOut : 0n,
        direction,
        wasAttacked: false, // Will be updated by orchestrator
        feePaid: this.calculateFee(amountIn, poolState.feeBps),
        timestamp: startTime,
      };
    } catch (error: any) {
      // Return failed trade result
      return {
        signature: "",
        trader: this.keypair.publicKey.toString(),
        amountIn,
        expectedOut,
        actualOut: 0n,
        slippageLoss: expectedOut,
        direction,
        wasAttacked: false,
        feePaid: 0n,
        timestamp: startTime,
      };
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
   * Calculate expected output using constant product formula
   */
  calculateExpectedOutput(amountIn: bigint, aToB: boolean, pool: PoolState): bigint {
    const amountAfterFee = (amountIn * BigInt(10000 - pool.feeBps)) / 10000n;
    
    const reserveIn = aToB ? pool.reserveA : pool.reserveB;
    const reserveOut = aToB ? pool.reserveB : pool.reserveA;

    // x * y = k formula
    const amountOut = (reserveOut * amountAfterFee) / (reserveIn + amountAfterFee);
    return amountOut;
  }

  /**
   * Calculate actual output from pool state change
   */
  private calculateActualOutput(
    before: PoolState,
    after: PoolState,
    aToB: boolean
  ): bigint {
    if (aToB) {
      return before.reserveB - after.reserveB;
    } else {
      return before.reserveA - after.reserveA;
    }
  }

  /**
   * Calculate fee amount
   */
  private calculateFee(amountIn: bigint, feeBps: number): bigint {
    return (amountIn * BigInt(feeBps)) / 10000n;
  }

  /**
   * Check if trader has sufficient balance
   */
  async canTrade(amount: bigint, direction: SwapDirection): Promise<boolean> {
    try {
      const tokenAccount = direction === "AtoB" ? this.tokenAAccount : this.tokenBAccount;
      const balance = await this.connection.getTokenAccountBalance(tokenAccount);
      return BigInt(balance.value.amount) >= amount;
    } catch {
      return false;
    }
  }
}

/**
 * Generate random trade amount between min and max
 */
export function randomTradeAmount(min: bigint, max: bigint): bigint {
  const range = max - min;
  const random = BigInt(Math.floor(Math.random() * Number(range)));
  return min + random;
}

/**
 * Generate random trade direction
 */
export function randomDirection(): SwapDirection {
  return Math.random() > 0.5 ? "AtoB" : "BtoA";
}

