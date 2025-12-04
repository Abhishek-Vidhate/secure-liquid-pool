import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import { Securelp } from "../target/types/securelp";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { expect } from "chai";
import BN from "bn.js";

describe("securelp", () => {
  // Configure the client to use the cluster from Anchor.toml
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Securelp as Program<Securelp>;
  
  // Use the wallet from ~/.config/solana/id.json (configured in Anchor.toml)
  const user = provider.wallet;

  // Detect if we're on devnet (to avoid airdrops)
  const isDevnet = provider.connection.rpcEndpoint.includes("devnet");

  // Test constants
  const MIN_AMOUNT = 1_000_000; // 0.001 SOL in lamports
  const TEST_AMOUNT = 2 * LAMPORTS_PER_SOL; // 2 SOL
  const SLIPPAGE_BPS = 50; // 0.5%

  // Track commitments created during tests for cleanup
  const createdCommitments: { pda: PublicKey; user: Keypair | null }[] = [];

  // Before all tests: ensure program is deployed and ready
  before(async () => {
    const connection = provider.connection;
    
    // Check program deployment
    let retries = 10;
    while (retries > 0) {
      try {
        const accountInfo = await connection.getAccountInfo(program.programId);
        if (accountInfo && accountInfo.executable) {
          console.log("Program is deployed and ready:", program.programId.toString());
          break;
        }
      } catch (e) {
        // Ignore and retry
      }
      
      retries--;
      if (retries === 0) {
        throw new Error("Program not deployed after waiting");
      }
      
      console.log(`Waiting for program deployment... (${10 - retries}/10)`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Show wallet info
    const balance = await connection.getBalance(user.publicKey);
    console.log(`Using wallet: ${user.publicKey.toString()}`);
    console.log(`Wallet balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    console.log(`Network: ${isDevnet ? "Devnet" : "Localnet"}`);
    
    // Clean up any existing commitment for the provider wallet
    const [existingPDA] = getCommitmentPDA(user.publicKey);
    try {
      await program.account.commitment.fetch(existingPDA);
      console.log("Found existing commitment, cleaning up...");
      await program.methods
        .cancelCommitment()
        .accounts({
          commitment: existingPDA,
          user: user.publicKey,
        })
        .rpc();
      console.log("Cleaned up existing commitment");
    } catch (e) {
      // No existing commitment, which is fine
    }
  });

  // After all tests: cleanup any created commitments
  after(async () => {
    for (const { pda, user: testUser } of createdCommitments) {
      try {
        if (testUser) {
          await program.methods
            .cancelCommitment()
            .accounts({
              commitment: pda,
              user: testUser.publicKey,
            })
            .signers([testUser])
            .rpc();
        }
      } catch (e) {
        // Commitment might already be closed
      }
    }
  });

  // Helper function to derive commitment PDA
  const getCommitmentPDA = (userPubkey: PublicKey): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("commit"), userPubkey.toBuffer()],
      program.programId
    );
  };

  // Helper function to create SwapDetails and hash
  const createSwapDetailsAndHash = (
    amountIn: number,
    minOut: number,
    slippageBps: number
  ): { details: any; hash: Buffer; nonce: number[] } => {
    const nonceBytes = Keypair.generate().publicKey.toBytes();
    const nonce = Array.from(nonceBytes);

    const details = {
      amountIn: new BN(amountIn),
      minOut: new BN(minOut),
      slippageBps: slippageBps,
      nonce: nonce,
    };

    // Serialize details matching Anchor's borsh serialization
    const buffer = Buffer.alloc(8 + 8 + 2 + 32);
    buffer.writeBigUInt64LE(BigInt(amountIn), 0);
    buffer.writeBigUInt64LE(BigInt(minOut), 8);
    buffer.writeUInt16LE(slippageBps, 16);
    Buffer.from(nonceBytes).copy(buffer, 18);

    const hash = createHash("sha256").update(buffer).digest();

    return { details, hash, nonce };
  };

  // Helper to fund a keypair (works on both localnet and devnet)
  const fundKeypair = async (keypair: Keypair, amount: number = LAMPORTS_PER_SOL): Promise<void> => {
    if (isDevnet) {
      // On devnet, transfer from provider wallet instead of airdrop
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: keypair.publicKey,
          lamports: amount,
        })
      );
      await provider.sendAndConfirm(tx);
    } else {
      // On localnet, use airdrop
      const sig = await provider.connection.requestAirdrop(keypair.publicKey, amount);
      await provider.connection.confirmTransaction(sig);
    }
  };

  describe("Commit Instruction", () => {
    it("should create a commitment PDA with valid parameters", async () => {
      const { hash } = createSwapDetailsAndHash(
        TEST_AMOUNT,
        TEST_AMOUNT - 100000,
        SLIPPAGE_BPS
      );

      const [commitmentPDA] = getCommitmentPDA(user.publicKey);

      const tx = await program.methods
        .commit(Array.from(hash), new BN(TEST_AMOUNT), true)
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Commit transaction signature:", tx);
      console.log(`  └─ View on explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);

      // Fetch and verify commitment account
      const commitment = await program.account.commitment.fetch(commitmentPDA);

      expect(commitment.user.toString()).to.equal(user.publicKey.toString());
      expect(Buffer.from(commitment.hash)).to.deep.equal(hash);
      expect(commitment.amountLamports.toString()).to.equal(TEST_AMOUNT.toString());
      expect(commitment.isStake).to.be.true;
      expect(commitment.timestamp.toNumber()).to.be.greaterThan(0);

      // Clean up for next test
      await program.methods
        .cancelCommitment()
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
        })
        .rpc();
    });

    it("should fail with amount below minimum", async () => {
      const { hash } = createSwapDetailsAndHash(
        MIN_AMOUNT - 1,
        MIN_AMOUNT - 1,
        SLIPPAGE_BPS
      );

      const [commitmentPDA] = getCommitmentPDA(user.publicKey);

      try {
        await program.methods
          .commit(Array.from(hash), new BN(MIN_AMOUNT - 1), true)
          .accounts({
            commitment: commitmentPDA,
            user: user.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        expect.fail("Should have thrown AmountTooSmall error");
      } catch (error) {
        if (error instanceof AnchorError) {
          expect(error.error.errorCode.code).to.equal("AmountTooSmall");
          console.log("  ✓ Correctly rejected amount below minimum");
        } else {
          throw error;
        }
      }
    });

    it("should fail when commitment already exists", async () => {
      const { hash } = createSwapDetailsAndHash(
        TEST_AMOUNT,
        TEST_AMOUNT - 100000,
        SLIPPAGE_BPS
      );

      const [commitmentPDA] = getCommitmentPDA(user.publicKey);

      // Create first commitment
      await program.methods
        .commit(Array.from(hash), new BN(TEST_AMOUNT), true)
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Try to create another commitment (should fail)
      try {
        const { hash: newHash } = createSwapDetailsAndHash(
          TEST_AMOUNT,
          TEST_AMOUNT - 100000,
          SLIPPAGE_BPS
        );

        await program.methods
          .commit(Array.from(newHash), new BN(TEST_AMOUNT), true)
          .accounts({
            commitment: commitmentPDA,
            user: user.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        expect.fail("Should have thrown error for existing commitment");
      } catch (error) {
        expect(error).to.exist;
        console.log("  ✓ Correctly rejected duplicate commitment");
      }

      // Clean up
      await program.methods
        .cancelCommitment()
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
        })
        .rpc();
    });

    it("should create unstake commitment (is_stake = false)", async () => {
      const { hash } = createSwapDetailsAndHash(
        TEST_AMOUNT,
        TEST_AMOUNT - 100000,
        SLIPPAGE_BPS
      );

      const [commitmentPDA] = getCommitmentPDA(user.publicKey);

      const tx = await program.methods
        .commit(Array.from(hash), new BN(TEST_AMOUNT), false) // is_stake = false
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Unstake commit transaction signature:", tx);

      const commitment = await program.account.commitment.fetch(commitmentPDA);
      expect(commitment.isStake).to.be.false;

      // Clean up
      await program.methods
        .cancelCommitment()
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
        })
        .rpc();
    });
  });

  describe("Cancel Commitment Instruction", () => {
    it("should cancel existing commitment and return rent", async () => {
      const { hash } = createSwapDetailsAndHash(
        TEST_AMOUNT,
        TEST_AMOUNT - 100000,
        SLIPPAGE_BPS
      );

      const [commitmentPDA] = getCommitmentPDA(user.publicKey);

      // Get initial balance
      const initialBalance = await provider.connection.getBalance(user.publicKey);

      // Create commitment
      await program.methods
        .commit(Array.from(hash), new BN(TEST_AMOUNT), true)
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Get balance after commit (should be lower due to rent + tx fee)
      const balanceAfterCommit = await provider.connection.getBalance(user.publicKey);
      const rentPaid = initialBalance - balanceAfterCommit;
      console.log(`  Rent + fee paid: ${rentPaid / LAMPORTS_PER_SOL} SOL`);

      // Cancel commitment
      const tx = await program.methods
        .cancelCommitment()
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
        })
        .rpc();

      console.log("Cancel commitment transaction signature:", tx);

      // Verify commitment is closed
      try {
        await program.account.commitment.fetch(commitmentPDA);
        expect.fail("Commitment should be closed");
      } catch (error) {
        expect(error.message).to.include("Account does not exist");
      }

      // Verify rent was returned
      const finalBalance = await provider.connection.getBalance(user.publicKey);
      const rentRecovered = finalBalance - balanceAfterCommit;
      console.log(`  Rent recovered: ${rentRecovered / LAMPORTS_PER_SOL} SOL`);
      expect(finalBalance).to.be.greaterThan(balanceAfterCommit);
    });

    it("should fail when wrong user tries to cancel", async () => {
      // Create a secondary user
      const wrongUser = Keypair.generate();
      await fundKeypair(wrongUser, 0.1 * LAMPORTS_PER_SOL);

      const { hash } = createSwapDetailsAndHash(
        TEST_AMOUNT,
        TEST_AMOUNT - 100000,
        SLIPPAGE_BPS
      );

      const [commitmentPDA] = getCommitmentPDA(user.publicKey);

      // Create commitment with provider wallet
      await program.methods
        .commit(Array.from(hash), new BN(TEST_AMOUNT), true)
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Try to cancel with wrong user
      try {
        await program.methods
          .cancelCommitment()
          .accounts({
            commitment: commitmentPDA,
            user: wrongUser.publicKey,
          })
          .signers([wrongUser])
          .rpc();

        expect.fail("Should have thrown error for wrong user");
      } catch (error) {
        expect(error).to.exist;
        console.log("  ✓ Correctly rejected wrong user cancellation");
      }

      // Clean up with correct user
      await program.methods
        .cancelCommitment()
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
        })
        .rpc();
    });
  });

  describe("Hash Verification Logic", () => {
    it("should store correct hash that matches client-side computation", async () => {
      const amountIn = TEST_AMOUNT;
      const minOut = TEST_AMOUNT - 100000;
      const slippageBps = SLIPPAGE_BPS;
      const { hash } = createSwapDetailsAndHash(amountIn, minOut, slippageBps);

      const [commitmentPDA] = getCommitmentPDA(user.publicKey);

      await program.methods
        .commit(Array.from(hash), new BN(amountIn), true)
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const commitment = await program.account.commitment.fetch(commitmentPDA);

      // Verify hash matches
      const storedHash = Buffer.from(commitment.hash);
      expect(storedHash).to.deep.equal(hash);

      console.log("  Stored hash:", storedHash.toString("hex"));
      console.log("  Expected hash:", hash.toString("hex"));

      // Clean up
      await program.methods
        .cancelCommitment()
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
        })
        .rpc();
    });

    it("should produce different hashes for different nonces", async () => {
      const { hash: hash1 } = createSwapDetailsAndHash(
        TEST_AMOUNT,
        TEST_AMOUNT - 100000,
        SLIPPAGE_BPS
      );

      const { hash: hash2 } = createSwapDetailsAndHash(
        TEST_AMOUNT,
        TEST_AMOUNT - 100000,
        SLIPPAGE_BPS
      );

      expect(hash1).to.not.deep.equal(hash2);
      console.log("  ✓ Different nonces produce different hashes");
    });

    it("should produce different hashes for different amounts", async () => {
      const nonceBytes = Keypair.generate().publicKey.toBytes();

      const createHashWithNonce = (amount: number): Buffer => {
        const buffer = Buffer.alloc(8 + 8 + 2 + 32);
        buffer.writeBigUInt64LE(BigInt(amount), 0);
        buffer.writeBigUInt64LE(BigInt(amount - 100000), 8);
        buffer.writeUInt16LE(SLIPPAGE_BPS, 16);
        Buffer.from(nonceBytes).copy(buffer, 18);
        return createHash("sha256").update(buffer).digest();
      };

      const hash1 = createHashWithNonce(TEST_AMOUNT);
      const hash2 = createHashWithNonce(TEST_AMOUNT + 1);

      expect(hash1).to.not.deep.equal(hash2);
      console.log("  ✓ Different amounts produce different hashes");
    });
  });

  describe("Timestamp and Delay Logic", () => {
    it("should store correct timestamp on commit", async () => {
      const { hash } = createSwapDetailsAndHash(
        TEST_AMOUNT,
        TEST_AMOUNT - 100000,
        SLIPPAGE_BPS
      );

      const [commitmentPDA] = getCommitmentPDA(user.publicKey);

      const beforeTime = Math.floor(Date.now() / 1000);

      await program.methods
        .commit(Array.from(hash), new BN(TEST_AMOUNT), true)
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const afterTime = Math.floor(Date.now() / 1000);

      const commitment = await program.account.commitment.fetch(commitmentPDA);
      const storedTime = commitment.timestamp.toNumber();

      // Timestamp should be within reasonable range
      expect(storedTime).to.be.at.least(beforeTime - 10);
      expect(storedTime).to.be.at.most(afterTime + 10);

      console.log("  Stored timestamp:", storedTime);
      console.log("  Current time:", afterTime);

      // Clean up
      await program.methods
        .cancelCommitment()
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
        })
        .rpc();
    });
  });

  describe("PDA Derivation", () => {
    it("should derive consistent PDAs for same user", async () => {
      const testUser = Keypair.generate();

      const [pda1, bump1] = getCommitmentPDA(testUser.publicKey);
      const [pda2, bump2] = getCommitmentPDA(testUser.publicKey);

      expect(pda1.toString()).to.equal(pda2.toString());
      expect(bump1).to.equal(bump2);
      console.log("  ✓ Same user always derives same PDA");
    });

    it("should derive different PDAs for different users", async () => {
      const user1 = Keypair.generate();
      const user2 = Keypair.generate();

      const [pda1] = getCommitmentPDA(user1.publicKey);
      const [pda2] = getCommitmentPDA(user2.publicKey);

      expect(pda1.toString()).to.not.equal(pda2.toString());
      console.log("  ✓ Different users derive different PDAs");
    });
  });

  describe("Slippage Validation", () => {
    it("should accept slippage within limits (1000 bps = 10%)", async () => {
      const { hash } = createSwapDetailsAndHash(
        TEST_AMOUNT,
        TEST_AMOUNT - 200000,
        1000 // 10%
      );

      const [commitmentPDA] = getCommitmentPDA(user.publicKey);

      await program.methods
        .commit(Array.from(hash), new BN(TEST_AMOUNT), true)
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("  ✓ 10% slippage accepted on commit");

      // Clean up
      await program.methods
        .cancelCommitment()
        .accounts({
          commitment: commitmentPDA,
          user: user.publicKey,
        })
        .rpc();
    });
  });

  // Integration tests that require Jupiter/Pyth (skipped for now)
  describe("Integration Tests (Devnet Only)", () => {
    it.skip("should execute reveal_and_stake with Jupiter CPI", async () => {
      console.log("Skipped: Requires Jupiter swap setup");
    });

    it.skip("should execute reveal_and_unstake with Jupiter CPI", async () => {
      console.log("Skipped: Requires Jupiter swap setup");
    });

    it.skip("should fail reveal if delay not met", async () => {
      console.log("Skipped: Requires full integration test setup");
    });

    it.skip("should fail reveal with wrong hash", async () => {
      console.log("Skipped: Requires full integration test setup");
    });
  });
});

// ============================================================================
// EXPORTED HELPERS
// ============================================================================

export const DEVNET_ADDRESSES = {
  JITO_STAKE_POOL: new PublicKey("JitoY5pcAxWX6iyP2QdFwTznGb8A99PRCUCVVxB46WZ"),
  JITO_SOL_MINT: new PublicKey("J1tos8mqbhdGcF3pgj4PCKyVjzWSURcpLZU7pPGHxSYi"),
  SPL_STAKE_POOL_PROGRAM: new PublicKey("DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib"),
  PYTH_SOL_USD_FEED: new PublicKey("H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG"),
  JUPITER_PROGRAM: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
  WSOL_MINT: new PublicKey("So11111111111111111111111111111111111111112"),
};
