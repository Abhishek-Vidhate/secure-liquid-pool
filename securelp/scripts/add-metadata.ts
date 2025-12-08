import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Program IDs
const STAKE_POOL_PROGRAM_ID = new PublicKey("EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7");
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

// PDA Seeds
const POOL_CONFIG_SEED = "pool_config";
const POOL_AUTHORITY_SEED = "pool_authority";

// Token Metadata - Change these to customize your token!
const TOKEN_NAME = "SecuSOL";
const TOKEN_SYMBOL = "secuSOL";
const TOKEN_URI = ""; // Optional: Add a JSON metadata URL for logo

async function main() {
  console.log("=".repeat(60));
  console.log("SecureLiquidPool - Create Token Metadata");
  console.log("=".repeat(60));
  console.log(`\nToken Name: ${TOKEN_NAME}`);
  console.log(`Token Symbol: ${TOKEN_SYMBOL}`);
  console.log("=".repeat(60));

  // Setup provider
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  
  console.log("\nWallet:", provider.wallet.publicKey.toString());
  console.log("Cluster:", provider.connection.rpcEndpoint);

  // Load Stake Pool IDL
  const stakePoolIdl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../target/idl/stake_pool.json"), "utf8")
  );
  const stakePoolProgram = new Program(stakePoolIdl, provider);

  // Derive PDAs
  const [poolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_CONFIG_SEED)],
    STAKE_POOL_PROGRAM_ID
  );

  console.log("\nFetching pool config...");
  const poolData = await stakePoolProgram.account.poolConfig.fetch(poolConfig);
  const slpMint = poolData.slpMint as PublicKey;
  
  console.log("Pool Config:", poolConfig.toString());
  console.log("Token Mint:", slpMint.toString());

  // Derive pool authority
  const [poolAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_AUTHORITY_SEED), poolConfig.toBuffer()],
    STAKE_POOL_PROGRAM_ID
  );
  console.log("Pool Authority:", poolAuthority.toString());

  // Derive metadata PDA
  const [metadataPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      slpMint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  console.log("Metadata PDA:", metadataPDA.toString());

  // Check if metadata already exists
  const metadataAccount = await provider.connection.getAccountInfo(metadataPDA);
  
  if (metadataAccount) {
    console.log("\n⚠️ Metadata already exists for this token!");
    console.log("The token should already display its name in wallets.");
    return;
  }

  console.log("\nCreating token metadata...");

  try {
    const tx = await stakePoolProgram.methods
      .createTokenMetadata(TOKEN_NAME, TOKEN_SYMBOL, TOKEN_URI)
      .accounts({
        admin: provider.wallet.publicKey,
        poolConfig: poolConfig,
        poolAuthority: poolAuthority,
        slpMint: slpMint,
        metadata: metadataPDA,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log("\n✅ Token metadata created successfully!");
    console.log("Transaction:", tx);
    console.log(`\nYour token will now display as "${TOKEN_NAME}" (${TOKEN_SYMBOL}) in wallets!`);
    console.log("\nNote: It may take a few minutes for wallets to refresh and show the new name.");
    
  } catch (error) {
    console.error("\n❌ Error creating metadata:", error);
    throw error;
  }

  console.log("\n" + "=".repeat(60));
  console.log("Done!");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

