import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { 
  PublicKey, 
  SystemProgram, 
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createCreateMetadataAccountV3Instruction } from "@metaplex-foundation/mpl-token-metadata";
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

// Token Metadata
const TOKEN_NAME = "SecuSOL";
const TOKEN_SYMBOL = "secuSOL";
const TOKEN_URI = ""; // Can add a JSON metadata URI later for logo

async function main() {
  console.log("=".repeat(60));
  console.log("SecureLiquidPool - Add Token Metadata Script");
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

  // Get pool config to find the mint
  const [poolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_CONFIG_SEED)],
    STAKE_POOL_PROGRAM_ID
  );

  console.log("\nFetching pool config...");
  const poolData = await stakePoolProgram.account.poolConfig.fetch(poolConfig);
  const slpMint = poolData.slpMint as PublicKey;
  
  console.log("Token Mint:", slpMint.toString());

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
    console.log("To update metadata, you would need to use updateMetadataAccountV2");
    return;
  }

  console.log("\nCreating metadata...");
  console.log("  Name:", TOKEN_NAME);
  console.log("  Symbol:", TOKEN_SYMBOL);

  // The mint authority is the pool authority PDA
  const [poolAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_authority"), poolConfig.toBuffer()],
    STAKE_POOL_PROGRAM_ID
  );

  console.log("Pool Authority (Mint Authority):", poolAuthority.toString());

  // Unfortunately, creating metadata requires the mint authority to sign.
  // Since the mint authority is a PDA (pool_authority), we need to do this via CPI
  // from the stake_pool program.
  
  console.log("\n" + "=".repeat(60));
  console.log("IMPORTANT: Metadata Creation Requires Program Update");
  console.log("=".repeat(60));
  console.log(`
The mint authority for secuSOL is a PDA (${poolAuthority.toString()}).
To add metadata, we need to:

Option 1: Add a new instruction to stake_pool program that calls
          the Token Metadata program via CPI

Option 2: Use a workaround - create metadata at pool initialization time

For now, the token works perfectly fine - it just shows as "Unknown Token"
in wallet UIs. This is purely a display issue.

Your tokens are completely safe and functional!
  `);

  // Let me check if we can use an alternative approach
  console.log("Checking current mint authority...");
  const mintInfo = await provider.connection.getParsedAccountInfo(slpMint);
  
  if (mintInfo.value && 'parsed' in mintInfo.value.data) {
    const parsed = mintInfo.value.data.parsed;
    console.log("Mint Authority:", parsed.info.mintAuthority);
    console.log("Freeze Authority:", parsed.info.freezeAuthority);
    console.log("Decimals:", parsed.info.decimals);
    console.log("Supply:", parsed.info.supply);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

