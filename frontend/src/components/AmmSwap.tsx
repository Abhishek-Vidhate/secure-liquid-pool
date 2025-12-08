"use client";

import { FC, useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction, 
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  NATIVE_MINT,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { AnchorProvider } from "@coral-xyz/anchor";
import BN from "bn.js";
import { useBalances, formatBalance } from "../hooks/useBalances";
import { useAmm } from "../hooks/useAmm";
import { MIN_AMOUNT_LAMPORTS, DEFAULT_SLIPPAGE_BPS, WSOL_MINT } from "../lib/constants";
import { 
  getAmmProgram, 
  getAmmPoolPDA, 
  getAmmAuthorityPDA, 
  getVaultAPDA, 
  getVaultBPDA 
} from "../lib/program";
import { sendTransaction } from "../lib/transaction";
import TransactionStatus from "./TransactionStatus";
import PoolStats from "./PoolStats";
import type { CommitRevealPhase } from "../hooks/useCommitReveal";

const SLIPPAGE_OPTIONS = [
  { label: "0.3%", value: 30 },
  { label: "0.5%", value: 50 },
  { label: "1%", value: 100 },
];

export const AmmSwap: FC = () => {
  const { connected, publicKey, signTransaction, wallet } = useWallet();
  const { connection } = useConnection();
  const { solBalance, slpSolBalance, slpSolMint, isLoading: balancesLoading, refetch: refetchBalances } = useBalances();
  const { ammPool, reserveA, reserveB, calculateSwapOutput, loading: ammLoading, feeBps, refresh: refreshAmm } = useAmm();

  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [direction, setDirection] = useState<"sol_to_slp" | "slp_to_sol">("sol_to_slp");
  const [outputPreview, setOutputPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<CommitRevealPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  // Calculate output when amount changes
  useEffect(() => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0 || !ammPool) {
      setOutputPreview(null);
      return;
    }

    const lamports = BigInt(Math.floor(numAmount * LAMPORTS_PER_SOL));
    if (lamports < BigInt(MIN_AMOUNT_LAMPORTS)) {
      setOutputPreview(null);
      return;
    }

    const aToB = direction === "sol_to_slp";
    const { amountOut } = calculateSwapOutput(lamports, aToB);
    setOutputPreview((Number(amountOut) / LAMPORTS_PER_SOL).toFixed(6));
  }, [amount, ammPool, calculateSwapOutput, direction]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmount(value);
    }
  };

  const handleMaxClick = () => {
    const balance = direction === "sol_to_slp" ? solBalance - 0.01 : slpSolBalance;
    const maxAmount = Math.max(0, balance);
    setAmount(maxAmount.toFixed(6));
  };

  const handleSwitch = () => {
    setDirection(d => d === "sol_to_slp" ? "slp_to_sol" : "sol_to_slp");
    setAmount("");
    setOutputPreview(null);
  };

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setTxSignature(null);
  }, []);

  const isValidAmount = () => {
    const numAmount = parseFloat(amount);
    if (numAmount <= 0) return false;
    if (numAmount * LAMPORTS_PER_SOL < MIN_AMOUNT_LAMPORTS) return false;
    
    const balance = direction === "sol_to_slp" ? solBalance : slpSolBalance;
    if (numAmount > balance) return false;

    // Check if pool has enough liquidity
    const outputReserve = direction === "sol_to_slp" ? reserveB : reserveA;
    if (outputReserve <= 0) return false;
    
    return true;
  };

  const handleSwap = useCallback(async () => {
    if (!publicKey || !signTransaction || !ammPool || !slpSolMint) {
      setError("Wallet not connected");
      return;
    }

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) return;

    try {
      setPhase("committing");
      setError(null);

      const amountLamports = BigInt(Math.floor(numAmount * LAMPORTS_PER_SOL));
      const aToB = direction === "sol_to_slp";
      
      // Calculate expected output with slippage
      const { amountOut } = calculateSwapOutput(amountLamports, aToB);
      const minOut = amountOut - (amountOut * BigInt(slippageBps) / BigInt(10000));

      // Create provider
      const provider = new AnchorProvider(
        connection,
        wallet as any,
        { commitment: "confirmed" }
      );

      const ammProgram = getAmmProgram(provider);
      
      // Get PDAs
      const [ammPoolPda] = getAmmPoolPDA(NATIVE_MINT, slpSolMint);
      const [ammAuthority] = getAmmAuthorityPDA(ammPoolPda);
      const [vaultA] = getVaultAPDA(ammPoolPda);
      const [vaultB] = getVaultBPDA(ammPoolPda);

      // Get user token accounts
      const userWsolAccount = await getAssociatedTokenAddress(NATIVE_MINT, publicKey);
      const userSlpAccount = await getAssociatedTokenAddress(slpSolMint, publicKey);

      // Build transaction with setup instructions
      const tx = new Transaction();

      // Check if wSOL account exists
      let wsolExists = false;
      try {
        await getAccount(connection, userWsolAccount);
        wsolExists = true;
      } catch {}

      if (aToB) {
        // SOL -> secuSOL: Need to wrap SOL first
        if (!wsolExists) {
          tx.add(createAssociatedTokenAccountInstruction(
            publicKey,
            userWsolAccount,
            publicKey,
            NATIVE_MINT
          ));
        }
        
        // Transfer SOL to wSOL account
        tx.add(SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: userWsolAccount,
          lamports: Number(amountLamports),
        }));
        
        // Sync native
        tx.add(createSyncNativeInstruction(userWsolAccount));
      }

      // Check if secuSOL account exists
      let slpExists = false;
      try {
        await getAccount(connection, userSlpAccount);
        slpExists = true;
      } catch {}

      if (!slpExists && aToB) {
        tx.add(createAssociatedTokenAccountInstruction(
          publicKey,
          userSlpAccount,
          publicKey,
          slpSolMint
        ));
      }

      // For secuSOL -> SOL swap, we need to:
      // 1. Create wSOL account if it doesn't exist (to receive wSOL)
      // 2. Swap secuSOL for wSOL
      // 3. Close wSOL account to unwrap and get native SOL
      
      if (!aToB && !wsolExists) {
        // Need wSOL account to receive the swap output
        tx.add(createAssociatedTokenAccountInstruction(
          publicKey,
          userWsolAccount,
          publicKey,
          NATIVE_MINT
        ));
      }

      // Add swap instruction
      const swapIx = await ammProgram.methods
        .swap(
          new BN(amountLamports.toString()),
          new BN(minOut.toString()),
          aToB
        )
        .accounts({
          user: publicKey,
          pool: ammPoolPda,
          poolAuthority: ammAuthority,
          tokenAVault: vaultA,
          tokenBVault: vaultB,
          userTokenIn: aToB ? userWsolAccount : userSlpAccount,
          userTokenOut: aToB ? userSlpAccount : userWsolAccount,
        } as any)
        .instruction();

      tx.add(swapIx);

      // If swapping secuSOL -> SOL, close the wSOL account to unwrap to native SOL
      if (!aToB) {
        tx.add(createCloseAccountInstruction(
          userWsolAccount,    // wSOL account to close
          publicKey,          // Destination for remaining SOL (the user)
          publicKey,          // Owner of the wSOL account
          [],                 // No multisig
          TOKEN_PROGRAM_ID
        ));
      }

      // Send transaction
      const signature = await sendTransaction(connection, tx, signTransaction, publicKey);
      await connection.confirmTransaction(signature, "confirmed");

      setTxSignature(signature);
      setPhase("completed");
      setAmount("");
      
      // Refresh data
      await refetchBalances();
      await refreshAmm();

    } catch (err) {
      console.error("Swap failed:", err);
      setError(err instanceof Error ? err.message : "Swap failed");
      setPhase("error");
    }
  }, [publicKey, signTransaction, ammPool, slpSolMint, amount, direction, calculateSwapOutput, slippageBps, connection, wallet, refetchBalances, refreshAmm]);

  if (!connected) {
    return (
      <div className="text-center py-12">
        <h3 className="text-xl font-semibold text-zinc-300 mb-2">Connect Wallet to Swap</h3>
        <p className="text-zinc-500">Connect your wallet to swap tokens via the AMM.</p>
      </div>
    );
  }

  if (!ammPool && !ammLoading) {
    return (
      <div className="text-center py-12">
        <h3 className="text-xl font-semibold text-amber-400 mb-2">AMM Pool Not Initialized</h3>
        <p className="text-zinc-500">The AMM pool has not been initialized yet. Add initial liquidity first.</p>
      </div>
    );
  }

  // Show transaction status during operations
  if (phase !== "idle" && phase !== "committed") {
    return (
      <TransactionStatus
        phase={phase}
        error={error}
        txSignature={txSignature}
        onRetry={reset}
        onClose={reset}
      />
    );
  }

  const inputToken = direction === "sol_to_slp" ? "SOL" : "secuSOL";
  const outputToken = direction === "sol_to_slp" ? "secuSOL" : "SOL";
  const inputBalance = direction === "sol_to_slp" ? solBalance : slpSolBalance;

  return (
    <div className="space-y-6">
      {/* Staking Pool Stats */}
      <PoolStats compact />

      {/* AMM Pool Liquidity Info */}
      <div className="bg-zinc-800/30 rounded-xl p-4">
        <h4 className="text-xs text-zinc-500 uppercase tracking-wide mb-2">AMM Trading Pool</h4>
        <div className="flex justify-between text-sm">
          <div>
            <span className="text-zinc-500">Liquidity:</span>
            <span className="text-zinc-300 ml-2">{formatBalance(reserveA)} SOL</span>
            <span className="text-zinc-500 mx-2">+</span>
            <span className="text-zinc-300">{formatBalance(reserveB)} secuSOL</span>
          </div>
          <div className="text-zinc-400">
            Fee: {feeBps / 100}%
          </div>
        </div>
      </div>

      {/* Input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-zinc-400">You Pay</label>
          <span className="text-sm text-zinc-500">
            Balance: {balancesLoading ? "..." : formatBalance(inputBalance)} {inputToken}
          </span>
        </div>
        <div className="relative">
          <input
            type="text"
            value={amount}
            onChange={handleAmountChange}
            placeholder="0.0"
            className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-4 py-4 text-2xl font-semibold text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <button
              onClick={handleMaxClick}
              className="px-2 py-1 text-xs font-medium text-cyan-400 bg-cyan-500/20 rounded hover:bg-cyan-500/30 transition-colors"
            >
              MAX
            </button>
            <span className="text-zinc-400 font-medium">{inputToken}</span>
          </div>
        </div>
      </div>

      {/* Switch Button */}
      <div className="flex justify-center">
        <button
          onClick={handleSwitch}
          className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center hover:bg-zinc-700 transition-colors"
        >
          <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
      </div>

      {/* Output */}
      <div className="space-y-2">
        <label className="text-sm text-zinc-400">You Receive</label>
        <div className="bg-zinc-800/30 border border-zinc-700/30 rounded-xl px-4 py-4">
          <div className="flex items-center justify-between">
            <span className="text-2xl font-semibold text-emerald-400">
              {outputPreview ? `~${outputPreview}` : "0.0"}
            </span>
            <span className="text-zinc-400 font-medium">{outputToken}</span>
          </div>
        </div>
      </div>

      {/* Slippage Selection */}
      <div className="space-y-2">
        <label className="text-sm text-zinc-400">Slippage Tolerance</label>
        <div className="flex gap-2">
          {SLIPPAGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setSlippageBps(option.value)}
              className={`
                flex-1 py-2 rounded-lg text-sm font-medium transition-all
                ${slippageBps === option.value
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/50"
                  : "bg-zinc-800/50 text-zinc-400 border border-zinc-700/50 hover:border-zinc-600"
                }
              `}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Swap Button */}
      <button
        onClick={handleSwap}
        disabled={!isValidAmount() || ammLoading || phase !== "idle"}
        className={`
          w-full py-4 rounded-xl font-semibold text-lg transition-all
          ${isValidAmount() && !ammLoading && phase === "idle"
            ? "bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-400 hover:to-blue-400 shadow-lg shadow-cyan-500/25"
            : "bg-zinc-700 text-zinc-400 cursor-not-allowed"
          }
        `}
      >
        {ammLoading ? "Loading Pool..." : phase !== "idle" ? "Processing..." : `Swap ${inputToken} → ${outputToken}`}
      </button>

      {/* Info */}
      <div className="flex items-center gap-2 justify-center text-zinc-500 text-sm">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Swap uses constant-product AMM (x * y = k)</span>
      </div>
    </div>
  );
};

export default AmmSwap;

