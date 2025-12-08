/**
 * Harvest Rewards Script
 * 
 * Simulates staking rewards by calling harvest_rewards instruction.
 * This increases the exchange rate (slpSOL becomes worth more SOL).
 * 
 * Usage:
 *   cd securelp
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   bunx ts-node scripts/harvest.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// Load IDL
const stakePoolIdl = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../target/idl/stake_pool.json"), "utf8")
);

// Program IDs
const STAKE_POOL_PROGRAM_ID = new PublicKey("EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7");

// Seeds
const POOL_CONFIG_SEED = Buffer.from("pool_config");

async function main() {
  // Setup connection
  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet"),
    "confirmed"
  );

  // Load wallet
  const walletPath = process.env.ANCHOR_WALLET || 
    `${process.env.HOME}/.config/solana/id.json`;
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );

  console.log("Wallet:", walletKeypair.publicKey.toString());

  // Create provider
  const wallet = {
    publicKey: walletKeypair.publicKey,
    signTransaction: async (tx: any) => {
      tx.sign(walletKeypair);
      return tx;
    },
    signAllTransactions: async (txs: any[]) => {
      txs.forEach(tx => tx.sign(walletKeypair));
      return txs;
    },
  };

  const provider = new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });

  // Create program
  const stakePoolProgram = new Program(stakePoolIdl, provider);

  // Derive PDAs
  const [poolConfigPda] = PublicKey.findProgramAddressSync(
    [POOL_CONFIG_SEED],
    STAKE_POOL_PROGRAM_ID
  );

  console.log("Pool Config PDA:", poolConfigPda.toString());

  // Fetch current pool state
  console.log("\n📊 Current Pool State:");
  const poolConfig = await stakePoolProgram.account.poolConfig.fetch(poolConfigPda);
  
  const totalSol = (poolConfig.totalStakedLamports as any).toNumber() + 
                   (poolConfig.reserveLamports as any).toNumber();
  const slpSupply = (poolConfig.totalSlpSupply as any).toNumber();
  
  const currentRate = slpSupply > 0 
    ? totalSol / slpSupply 
    : 1.0;

  console.log(`  Total Staked: ${(poolConfig.totalStakedLamports as any).toNumber() / 1e9} SOL`);
  console.log(`  Reserve: ${(poolConfig.reserveLamports as any).toNumber() / 1e9} SOL`);
  console.log(`  slpSOL Supply: ${slpSupply / 1e9}`);
  console.log(`  Exchange Rate: ${currentRate.toFixed(6)} SOL per slpSOL`);
  console.log(`  Last Harvest Epoch: ${(poolConfig.lastHarvestEpoch as any).toNumber()}`);
  console.log(`  Fee: ${poolConfig.feeBps} bps`);

  // Get current epoch
  const epochInfo = await connection.getEpochInfo();
  console.log(`\n⏰ Current Epoch: ${epochInfo.epoch}`);

  if ((poolConfig.lastHarvestEpoch as any).toNumber() >= epochInfo.epoch) {
    console.log("\n⚠️  Rewards already harvested for this epoch.");
    console.log("    Wait for next epoch or manually advance epoch in localnet.");
    return;
  }

  // Harvest rewards
  console.log("\n🌾 Harvesting rewards...");
  
  try {
    const tx = await stakePoolProgram.methods
      .harvestRewards()
      .accounts({
        cranker: walletKeypair.publicKey,
        poolConfig: poolConfigPda,
      })
      .rpc();

    console.log(`  ✅ Transaction: ${tx}`);
    console.log(`  🔗 Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);

    // Fetch updated pool state
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const updatedPoolConfig = await stakePoolProgram.account.poolConfig.fetch(poolConfigPda);
    
    const newTotalSol = (updatedPoolConfig.totalStakedLamports as any).toNumber() + 
                        (updatedPoolConfig.reserveLamports as any).toNumber();
    const newSlpSupply = (updatedPoolConfig.totalSlpSupply as any).toNumber();
    
    const newRate = newSlpSupply > 0 
      ? newTotalSol / newSlpSupply 
      : 1.0;

    const rewardsAdded = newTotalSol - totalSol;
    const rateIncrease = ((newRate - currentRate) / currentRate) * 100;

    console.log("\n📈 Updated Pool State:");
    console.log(`  Total SOL: ${newTotalSol / 1e9} SOL (+${rewardsAdded / 1e9} SOL)`);
    console.log(`  slpSOL Supply: ${newSlpSupply / 1e9}`);
    console.log(`  Exchange Rate: ${newRate.toFixed(6)} SOL per slpSOL (+${rateIncrease.toFixed(4)}%)`);

  } catch (error: any) {
    if (error.message?.includes("EpochNotChanged")) {
      console.log("\n⚠️  Cannot harvest: epoch hasn't changed since last harvest.");
      console.log("    The Solana devnet epoch typically lasts ~2 days.");
      console.log("    For testing, you can use localnet with faster epochs.");
    } else {
      console.error("Error:", error);
    }
  }
}

main().catch(console.error);

