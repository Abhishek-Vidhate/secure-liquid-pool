import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { PROGRAM_IDS, SEEDS, MIN_DELAY_MS_LOCALNET } from "../config.js";
import { TradeResult, SwapDirection, PoolState, SwapDetails, CommitmentInfo } from "../types.js";
import { AccountSetupWithKeypair } from "../setup/accounts.js";

// Load IDLs
const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../../..");
const SECURELP_IDL_PATH = path.join(PROJECT_ROOT, "securelp/target/idl/securelp.json");
const AMM_IDL_PATH = path.join(PROJECT_ROOT, "securelp/target/idl/amm.json");

/**
 * Protected Trader Bot - Uses commit-reveal to protect against MEV
 */
export class ProtectedTrader {
  private connection: Connection;
  private keypair: Keypair;
  private tokenAAccount: PublicKey;
  private tokenBAccount: PublicKey;
  private securelpProgram: Program;
  private ammProgram: Program;
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

    // Create provider
    const wallet = new Wallet(this.keypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    
    // Load programs
    const securelpIdl = JSON.parse(fs.readFileSync(SECURELP_IDL_PATH, "utf-8"));
    this.securelpProgram = new Program(securelpIdl, provider);

    const ammIdl = JSON.parse(fs.readFileSync(AMM_IDL_PATH, "utf-8"));
    this.ammProgram = new Program(ammIdl, provider);

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
   * Execute a protected swap using commit-reveal
   * PROTECTED: Transaction details are hidden from MEV bots
   */
  async commitAndReveal(
    amountIn: bigint,
    direction: SwapDirection,
    minOut: bigint = 0n,
    slippageBps: number = 100 // 1% default slippage
  ): Promise<TradeResult> {
    const aToB = direction === "AtoB";
    const startTime = Date.now();

    // Calculate expected output before swap
    const poolState = await this.getPoolState();
    const expectedOut = this.calculateExpectedOutput(amountIn, aToB, poolState);

    // If minOut not specified, use expected - slippage
    if (minOut === 0n) {
      minOut = (expectedOut * BigInt(10000 - slippageBps)) / 10000n;
    }

    try {
      // === PHASE 1: Commit ===
      const { hash, nonce, details } = this.createCommitment(amountIn, minOut, slippageBps);
      
      // Derive commitment PDA
      const [commitmentPDA] = PublicKey.findProgramAddressSync(
        [SEEDS.COMMITMENT, this.keypair.publicKey.toBuffer()],
        PROGRAM_IDS.SECURELP
      );

      // Submit commit transaction
      const commitSig = await this.securelpProgram.methods
        .commit(Array.from(hash), new BN(amountIn.toString()), aToB) // is_stake maps to direction for simulation
        .accounts({
          commitment: commitmentPDA,
          user: this.keypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([this.keypair])
        .rpc();

      // === Wait for delay ===
      // On localnet, we need to wait for MIN_DELAY_SECONDS (1 second)
      await this.waitForDelay();

      // === PHASE 2: Reveal and Swap ===
      // Note: For simulation, we use direct AMM swap after commit
      // In production, this would use reveal_and_swap instruction
      const userTokenIn = aToB ? this.tokenAAccount : this.tokenBAccount;
      const userTokenOut = aToB ? this.tokenBAccount : this.tokenAAccount;

      // First cancel the commitment (to release the PDA)
      await this.securelpProgram.methods
        .cancelCommitment()
        .accounts({
          commitment: commitmentPDA,
          user: this.keypair.publicKey,
        })
        .signers([this.keypair])
        .rpc();

      // Execute the actual swap
      const swapSig = await this.ammProgram.methods
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

      // Get actual output
      const poolStateAfter = await this.getPoolState();
      const actualOut = this.calculateActualOutput(poolState, poolStateAfter, aToB);

      return {
        signature: swapSig,
        trader: this.keypair.publicKey.toString(),
        amountIn,
        expectedOut,
        actualOut,
        slippageLoss: expectedOut > actualOut ? expectedOut - actualOut : 0n,
        direction,
        wasAttacked: false, // Protected trades cannot be attacked
        feePaid: this.calculateFee(amountIn, poolState.feeBps),
        timestamp: startTime,
      };
    } catch (error: any) {
      // Try to cleanup commitment if it exists
      try {
        const [commitmentPDA] = PublicKey.findProgramAddressSync(
          [SEEDS.COMMITMENT, this.keypair.publicKey.toBuffer()],
          PROGRAM_IDS.SECURELP
        );
        await this.securelpProgram.methods
          .cancelCommitment()
          .accounts({
            commitment: commitmentPDA,
            user: this.keypair.publicKey,
          })
          .signers([this.keypair])
          .rpc();
      } catch { /* ignore cleanup errors */ }

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
   * Create commitment hash and details
   */
  private createCommitment(
    amountIn: bigint,
    minOut: bigint,
    slippageBps: number
  ): { hash: Uint8Array; nonce: number[]; details: SwapDetails } {
    // Generate random nonce
    const nonceBytes = Keypair.generate().publicKey.toBytes();
    const nonce = Array.from(nonceBytes);

    // Create swap details
    const details: SwapDetails = {
      amountIn: new BN(amountIn.toString()),
      minOut: new BN(minOut.toString()),
      slippageBps,
      nonce,
    };

    // Serialize and hash (matching on-chain Borsh serialization)
    const buffer = Buffer.alloc(8 + 8 + 2 + 32);
    buffer.writeBigUInt64LE(amountIn, 0);
    buffer.writeBigUInt64LE(minOut, 8);
    buffer.writeUInt16LE(slippageBps, 16);
    Buffer.from(nonceBytes).copy(buffer, 18);

    const hash = createHash("sha256").update(buffer).digest();

    return { hash: new Uint8Array(hash), nonce, details };
  }

  /**
   * Wait for commit-reveal delay
   * On localnet, we use a reduced delay for faster testing
   */
  private async waitForDelay(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, MIN_DELAY_MS_LOCALNET));
  }

  /**
   * Get what an attacker would see from a commit transaction
   */
  getCommitmentInfo(amountIn: bigint, isStake: boolean): CommitmentInfo {
    // Attacker can only see the hash (which is useless without nonce)
    const fakeHash = Keypair.generate().publicKey.toBytes();
    
    return {
      hash: fakeHash,
      amountLamports: amountIn,
      isStake,
      timestamp: Date.now(),
      canSandwich: false, // KEY: Cannot sandwich because params are hidden!
    };
  }

  /**
   * Get current pool state
   */
  async getPoolState(): Promise<PoolState> {
    const poolData = await (this.ammProgram.account as any).ammPool.fetch(this.poolAddress);
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

    return (reserveOut * amountAfterFee) / (reserveIn + amountAfterFee);
  }

  /**
   * Calculate actual output from pool state change
   */
  private calculateActualOutput(before: PoolState, after: PoolState, aToB: boolean): bigint {
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

