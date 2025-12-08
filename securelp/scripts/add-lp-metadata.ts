import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Program IDs
const STAKE_POOL_PROGRAM_ID = new PublicKey("EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7");
const AMM_PROGRAM_ID = new PublicKey("AcaXW2nDrvkpmuZnuiARDRJzmmfT1AZwLm4SMeYwnXKS");
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

// PDA Seeds
const POOL_CONFIG_SEED = "pool_config";
const AMM_POOL_SEED = "amm_pool";
const AMM_AUTHORITY_SEED = "amm_authority";

// LP Token Metadata
const LP_TOKEN_NAME = "SecuSOL LP Token";
const LP_TOKEN_SYMBOL = "secuLPT";
const LP_TOKEN_URI = "";

async function main() {
  console.log("=".repeat(60));
  console.log("SecureLiquidPool - Create LP Token Metadata");
  console.log("=".repeat(60));
  console.log(`\nLP Token Name: ${LP_TOKEN_NAME}`);
  console.log(`LP Token Symbol: ${LP_TOKEN_SYMBOL}`);
  console.log("=".repeat(60));

  // Setup provider
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  
  console.log("\nWallet:", provider.wallet.publicKey.toString());
  console.log("Cluster:", provider.connection.rpcEndpoint);

  // Load IDLs
  const stakePoolIdl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../target/idl/stake_pool.json"), "utf8")
  );
  const ammIdl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../target/idl/amm.json"), "utf8")
  );
  
  const stakePoolProgram = new Program(stakePoolIdl, provider);
  const ammProgram = new Program(ammIdl, provider);

  // Get stake pool to find slpSOL mint
  const [poolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_CONFIG_SEED)],
    STAKE_POOL_PROGRAM_ID
  );

  console.log("\nFetching stake pool config...");
  const stakePoolData = await stakePoolProgram.account.poolConfig.fetch(poolConfig);
  const slpMint = stakePoolData.slpMint as PublicKey;
  console.log("secuSOL Mint:", slpMint.toString());

  // Derive AMM pool PDA
  const [ammPool] = PublicKey.findProgramAddressSync(
    [Buffer.from(AMM_POOL_SEED), NATIVE_MINT.toBuffer(), slpMint.toBuffer()],
    AMM_PROGRAM_ID
  );

  console.log("AMM Pool:", ammPool.toString());

  // Fetch AMM pool to get LP mint
  const ammPoolData = await ammProgram.account.ammPool.fetch(ammPool);
  const lpMint = ammPoolData.lpMint as PublicKey;
  console.log("LP Token Mint:", lpMint.toString());

  // Derive AMM authority
  const [ammAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from(AMM_AUTHORITY_SEED), ammPool.toBuffer()],
    AMM_PROGRAM_ID
  );
  console.log("AMM Authority:", ammAuthority.toString());

  // Derive metadata PDA
  const [metadataPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      lpMint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  console.log("Metadata PDA:", metadataPDA.toString());

  // Check if metadata already exists
  const metadataAccount = await provider.connection.getAccountInfo(metadataPDA);
  
  if (metadataAccount) {
    console.log("\n⚠️ LP token metadata already exists!");
    return;
  }

  console.log("\nCreating LP token metadata...");

  try {
    const tx = await ammProgram.methods
      .createLpMetadata(LP_TOKEN_NAME, LP_TOKEN_SYMBOL, LP_TOKEN_URI)
      .accounts({
        admin: provider.wallet.publicKey,
        pool: ammPool,
        poolAuthority: ammAuthority,
        lpMint: lpMint,
        metadata: metadataPDA,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log("\n✅ LP token metadata created successfully!");
    console.log("Transaction:", tx);
    console.log(`\nYour LP token will now display as "${LP_TOKEN_NAME}" (${LP_TOKEN_SYMBOL}) in wallets!`);
    
  } catch (error) {
    console.error("\n❌ Error creating LP metadata:", error);
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

