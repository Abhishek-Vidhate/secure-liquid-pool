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
import {
  getAmmProgram,
  getAmmPoolPDA,
  getAmmAuthorityPDA,
  getVaultAPDA,
  getVaultBPDA,
} from "../lib/program";
import { sendTransaction, confirmTransaction } from "../lib/transaction";
import TransactionStatus from "./TransactionStatus";
import PoolStats from "./PoolStats";
import ErrorDisplay from "./ErrorDisplay";
import { CommitRevealPhase } from "../hooks/useCommitReveal";

export const LiquidityForm: FC = () => {
  const { connected, publicKey, signTransaction, wallet } = useWallet();
  const { connection } = useConnection();
  const {
    solBalance,
    slpSolBalance,
    slpSolMint,
    isLoading: balancesLoading,
    isRefreshing: balancesRefreshing,
    refetch: refetchBalances,
    error: balancesError
  } = useBalances();
  const {
    ammPool,
    reserveA,
    reserveB,
    totalLpSupply,
    loading: ammLoading,
    isRefreshing: ammRefreshing,
    feeBps,
    refresh: refreshAmm,
    lpMint,
    error: ammError
  } = useAmm();

  const [amount, setAmount] = useState("");
  const [lpAmount, setLpAmount] = useState("");
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [activeInput, setActiveInput] = useState<"sol" | "secusol">("sol");

  const [phase, setPhase] = useState<CommitRevealPhase>("idle");
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userLpBalance, setUserLpBalance] = useState(0);

  // Calculate paired amounts based on pool ratio
  const ratio = reserveA > 0 && reserveB > 0 ? reserveB / reserveA : 1;
  const numAmount = parseFloat(amount) || 0;

  // If user types SOL, calculate secuSOL. If user types secuSOL, calculate SOL.
  const solAmount = activeInput === "sol" ? numAmount : numAmount / ratio;
  const secuSolAmount = activeInput === "sol" ? numAmount * ratio : numAmount;

  // Fetch user's LP token balance
  useEffect(() => {
    const fetchLpBalance = async () => {
      if (!publicKey || !lpMint) return;

      try {
        const userLpAta = await getAssociatedTokenAddress(lpMint, publicKey);

        try {
          const account = await getAccount(connection, userLpAta);
          setUserLpBalance(Number(account.amount) / LAMPORTS_PER_SOL);
        } catch {
          setUserLpBalance(0);
        }
      } catch (err) {
        console.error("Error fetching LP balance:", err);
      }
    };

    fetchLpBalance();
  }, [publicKey, lpMint, connection, phase]);

  // Calculate expected output for remove liquidity
  const numLpAmount = parseFloat(lpAmount) || 0;
  const expectedSolOutput = numLpAmount && totalLpSupply > 0
    ? (numLpAmount / totalLpSupply) * reserveA
    : 0;
  const expectedSecuSolOutput = numLpAmount && totalLpSupply > 0
    ? (numLpAmount / totalLpSupply) * reserveB
    : 0;

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>, input: "sol" | "secusol") => {
    const value = e.target.value;
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setActiveInput(input);
      setAmount(value);
    }
  };

  const handleLpAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setLpAmount(value);
    }
  };

  const handleSwitch = () => {
    // Switch the active input and recalculate
    if (activeInput === "sol") {
      setActiveInput("secusol");
      setAmount(secuSolAmount.toFixed(6));
    } else {
      setActiveInput("sol");
      setAmount(solAmount.toFixed(6));
    }
  };

  const isValidAmount = () => {
    if (mode === "add") {
      if (solAmount <= 0 || secuSolAmount <= 0) return false;
      if (solAmount > solBalance - 0.01) return false;
      if (secuSolAmount > slpSolBalance) return false;
      return true;
    } else {
      return numLpAmount > 0 && numLpAmount <= userLpBalance;
    }
  };

  const handleAddLiquidity = useCallback(async () => {
    if (!publicKey || !signTransaction || !slpSolMint || !lpMint) return;

    if (solAmount <= 0 || secuSolAmount <= 0) return;

    try {
      setPhase("submitting");
      setError(null);
      setTxSignature(null);

      const amountALamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));
      const amountBLamports = BigInt(Math.floor(secuSolAmount * LAMPORTS_PER_SOL));

      const provider = new AnchorProvider(
        connection,
        wallet as any,
        { commitment: "confirmed" }
      );

      const ammProgram = getAmmProgram(provider);

      const [ammPoolPda] = getAmmPoolPDA(NATIVE_MINT, slpSolMint);
      const [ammAuthority] = getAmmAuthorityPDA(ammPoolPda);
      const [vaultA] = getVaultAPDA(ammPoolPda);
      const [vaultB] = getVaultBPDA(ammPoolPda);

      const userWsolAccount = await getAssociatedTokenAddress(NATIVE_MINT, publicKey);
      const userSlpAccount = await getAssociatedTokenAddress(slpSolMint, publicKey);
      const userLpAccount = await getAssociatedTokenAddress(lpMint, publicKey);

      const tx = new Transaction();

      // Check/create wSOL account
      let wsolExists = false;
      try {
        await getAccount(connection, userWsolAccount);
        wsolExists = true;
      } catch { }

      if (!wsolExists) {
        tx.add(createAssociatedTokenAccountInstruction(
          publicKey, userWsolAccount, publicKey, NATIVE_MINT
        ));
      }

      // Transfer SOL to wSOL account and sync
      tx.add(SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: userWsolAccount,
        lamports: Number(amountALamports),
      }));
      tx.add(createSyncNativeInstruction(userWsolAccount));

      // Check/create LP token account
      let lpExists = false;
      try {
        await getAccount(connection, userLpAccount);
        lpExists = true;
      } catch { }

      if (!lpExists) {
        tx.add(createAssociatedTokenAccountInstruction(
          publicKey, userLpAccount, publicKey, lpMint
        ));
      }

      // Add liquidity instruction
      const addLiqIx = await ammProgram.methods
        .addLiquidity(
          new BN(amountALamports.toString()),
          new BN(amountBLamports.toString()),
          new BN(0)
        )
        .accounts({
          user: publicKey,
          pool: ammPoolPda,
          poolAuthority: ammAuthority,
          tokenAVault: vaultA,
          tokenBVault: vaultB,
          lpMint: lpMint,
          userTokenA: userWsolAccount,
          userTokenB: userSlpAccount,
          userLpAccount: userLpAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .instruction();

      tx.add(addLiqIx);

      // Send transaction (non-blocking)
      const signature = await sendTransaction(
        connection,
        tx,
        signTransaction,
        publicKey,
        { simulateFirst: true, priorityFee: 1000 }
      );

      // Optimistic UI update
      setTxSignature(signature);
      setPhase("completed");
      setAmount("");

      // Confirm in background
      // Note: We don't refetch here - polling will handle updates automatically
      confirmTransaction(connection, signature, "confirmed")
        .then(() => {
          // Transaction confirmed successfully
          // Polling will automatically update the data, no need to refetch
        })
        .catch((error) => {
          console.error("Transaction confirmation failed:", error);
          setError(error instanceof Error ? error.message : "Transaction failed");
          setPhase("error");
        });

    } catch (err) {
      console.error("Add liquidity failed:", err);
      setError(err instanceof Error ? err.message : "Failed to add liquidity");
      setPhase("error");
    }
  }, [publicKey, signTransaction, slpSolMint, lpMint, solAmount, secuSolAmount, connection, wallet, refetchBalances, refreshAmm]);

  const handleRemoveLiquidity = useCallback(async () => {
    if (!publicKey || !signTransaction || !slpSolMint || !lpMint) return;

    if (!numLpAmount) return;

    try {
      setPhase("submitting");
      setError(null);
      setTxSignature(null);

      const lpLamports = BigInt(Math.floor(numLpAmount * LAMPORTS_PER_SOL));

      const provider = new AnchorProvider(
        connection,
        wallet as any,
        { commitment: "confirmed" }
      );

      const ammProgram = getAmmProgram(provider);

      const [ammPoolPda] = getAmmPoolPDA(NATIVE_MINT, slpSolMint);
      const [ammAuthority] = getAmmAuthorityPDA(ammPoolPda);
      const [vaultA] = getVaultAPDA(ammPoolPda);
      const [vaultB] = getVaultBPDA(ammPoolPda);

      const userWsolAccount = await getAssociatedTokenAddress(NATIVE_MINT, publicKey);
      const userSlpAccount = await getAssociatedTokenAddress(slpSolMint, publicKey);
      const userLpAccount = await getAssociatedTokenAddress(lpMint, publicKey);

      const tx = new Transaction();

      // Check/create wSOL account
      let wsolExists = false;
      try {
        await getAccount(connection, userWsolAccount);
        wsolExists = true;
      } catch { }

      if (!wsolExists) {
        tx.add(createAssociatedTokenAccountInstruction(
          publicKey, userWsolAccount, publicKey, NATIVE_MINT
        ));
      }

      // Remove liquidity instruction
      const removeLiqIx = await ammProgram.methods
        .removeLiquidity(
          new BN(lpLamports.toString()),
          new BN(0),
          new BN(0)
        )
        .accounts({
          user: publicKey,
          pool: ammPoolPda,
          poolAuthority: ammAuthority,
          tokenAVault: vaultA,
          tokenBVault: vaultB,
          lpMint: lpMint,
          userTokenA: userWsolAccount,
          userTokenB: userSlpAccount,
          userLpAccount: userLpAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .instruction();

      tx.add(removeLiqIx);

      // Unwrap wSOL to native SOL
      tx.add(createCloseAccountInstruction(
        userWsolAccount, publicKey, publicKey, [], TOKEN_PROGRAM_ID
      ));

      // Send transaction (non-blocking)
      const signature = await sendTransaction(
        connection,
        tx,
        signTransaction,
        publicKey,
        { simulateFirst: true, priorityFee: 1000 }
      );

      // Optimistic UI update
      setTxSignature(signature);
      setPhase("completed");
      setLpAmount("");

      // Confirm in background
      // Note: We don't refetch here - polling will handle updates automatically
      confirmTransaction(connection, signature, "confirmed")
        .then(() => {
          // Transaction confirmed successfully
          // Polling will automatically update the data, no need to refetch
        })
        .catch((error) => {
          console.error("Transaction confirmation failed:", error);
          setError(error instanceof Error ? error.message : "Transaction failed");
          setPhase("error");
        });

    } catch (err) {
      console.error("Remove liquidity failed:", err);
      setError(err instanceof Error ? err.message : "Failed to remove liquidity");
      setPhase("error");
    }
  }, [publicKey, signTransaction, slpSolMint, lpMint, numLpAmount, connection, wallet, refetchBalances, refreshAmm]);

  if (!connected) {
    return (
      <div className="text-center py-12">
        <h3 className="text-xl font-semibold text-zinc-300 mb-2">Connect Wallet</h3>
        <p className="text-zinc-500">Connect your wallet to manage liquidity.</p>
      </div>
    );
  }

  if (!ammPool && !ammLoading) {
    return (
      <div className="text-center py-12">
        <h3 className="text-xl font-semibold text-amber-400 mb-2">AMM Pool Not Initialized</h3>
        <p className="text-zinc-500">The AMM pool needs to be initialized first.</p>
      </div>
    );
  }

  // Show transaction status during operations
  if (phase !== "idle") {
    return (
      <TransactionStatus
        phase={phase}
        error={error}
        txSignature={txSignature}
        onRetry={() => {
          setPhase("idle");
          setError(null);
          setTxSignature(null);
        }}
        onClose={() => {
          setPhase("idle");
          setError(null);
          setTxSignature(null);
        }}
      />
    );
  }

  const inputToken = activeInput === "sol" ? "SOL" : "secuSOL";
  const outputToken = activeInput === "sol" ? "secuSOL" : "SOL";
  const inputBalance = activeInput === "sol" ? solBalance : slpSolBalance;
  const outputAmount = activeInput === "sol" ? secuSolAmount : solAmount;

  return (
    <div className="space-y-6">
      {/* Error Displays */}
      {balancesError && (
        <ErrorDisplay
          error={balancesError}
          onRetry={refetchBalances}
          title="Failed to load balances"
        />
      )}
      {ammError && (
        <ErrorDisplay
          error={ammError}
          onRetry={refreshAmm}
          title="Failed to load AMM pool data"
        />
      )}

      {/* Staking Pool Stats */}
      <PoolStats compact />

      {/* Mode Toggle */}
      <div className="flex rounded-lg bg-zinc-800/50 p-1">
        <button
          onClick={() => { setMode("add"); setError(null); setPhase("idle"); }}
          className={`flex-1 py-2.5 rounded-md text-sm font-medium transition-all ${mode === "add"
            ? "bg-emerald-500/20 text-emerald-400"
            : "text-zinc-400 hover:text-zinc-300"
            }`}
        >
          Add Liquidity
        </button>
        <button
          onClick={() => { setMode("remove"); setError(null); setPhase("idle"); }}
          className={`flex-1 py-2.5 rounded-md text-sm font-medium transition-all ${mode === "remove"
            ? "bg-orange-500/20 text-orange-400"
            : "text-zinc-400 hover:text-zinc-300"
            }`}
        >
          Remove Liquidity
        </button>
      </div>

      {/* AMM Pool Info */}
      <div className="bg-zinc-800/30 rounded-xl p-4">
        <h4 className="text-xs text-zinc-500 uppercase tracking-wide mb-2">AMM Trading Pool</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-zinc-500">Reserves:</span>
            <span className="text-zinc-300 ml-2">{formatBalance(reserveA)} SOL + {formatBalance(reserveB)} secuSOL</span>
          </div>
          <div className="text-right">
            <span className="text-zinc-500">Fee:</span>
            <span className="text-zinc-300 ml-2">{feeBps / 100}%</span>
          </div>
          <div>
            <span className="text-zinc-500">Your LP:</span>
            <span className="text-emerald-400 ml-2 font-medium">{formatBalance(userLpBalance)} secuLPT</span>
          </div>
          <div className="text-right">
            <span className="text-zinc-500">Total LP:</span>
            <span className="text-zinc-300 ml-2">{formatBalance(totalLpSupply)} secuLPT</span>
          </div>
        </div>
      </div>

      {/* Error Messages - Only show if not handled by TransactionStatus (which handles phase=error) */}
      {/* Note: In this new design, we might want to keep inline errors for validation, but transaction errors are shown in the status view */}
      {/* For now, we removed the inline error block because phase 'error' switches the view */}

      {mode === "add" ? (
        <>
          {/* Input (You Pay) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm text-zinc-400">You Pay</label>
              <span className="text-sm text-zinc-500 flex items-center gap-1">
                Balance: {balancesLoading ? "..." : formatBalance(inputBalance)} {inputToken}
                {balancesRefreshing && !balancesLoading && (
                  <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
                )}
              </span>
            </div>
            <div className="relative">
              <input
                type="text"
                value={amount}
                onChange={(e) => handleAmountChange(e, activeInput)}
                placeholder="0.0"
                disabled={false} // TransactionStatus view will block input
                className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-4 py-4 text-2xl font-semibold text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button
                  onClick={() => {
                    setActiveInput(activeInput);
                    const maxBal = activeInput === "sol" ? Math.max(0, solBalance - 0.01) : slpSolBalance;
                    setAmount(maxBal.toFixed(6));
                  }}
                  disabled={false}
                  className="px-2 py-1 text-xs font-medium text-emerald-400 bg-emerald-500/20 rounded hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
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
              disabled={false}
              className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>

          {/* Output (Paired Amount) */}
          <div className="space-y-2">
            <label className="text-sm text-zinc-400">Paired Amount</label>
            <div className="bg-zinc-800/30 border border-zinc-700/30 rounded-xl px-4 py-4">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-semibold text-emerald-400">
                  {outputAmount > 0 ? outputAmount.toFixed(6) : "0.0"}
                </span>
                <span className="text-zinc-400 font-medium">{outputToken}</span>
              </div>
            </div>
            <p className="text-xs text-zinc-500">
              Balance: {formatBalance(activeInput === "sol" ? slpSolBalance : solBalance)} {outputToken}
            </p>
          </div>

          {/* Add Button */}
          <button
            onClick={handleAddLiquidity}
            disabled={!isValidAmount() || ammLoading || balancesLoading}
            className={`
              w-full py-4 rounded-xl font-semibold text-lg transition-all relative
              ${isValidAmount() && !ammLoading && !balancesLoading
                ? "bg-gradient-to-r from-emerald-500 to-green-500 text-white hover:from-emerald-400 hover:to-green-400 shadow-lg shadow-emerald-500/25 cursor-pointer"
                : "bg-zinc-700 text-zinc-400 cursor-not-allowed"
              }
            `}
          >
            {ammLoading || balancesLoading ? "Loading..." : "Add Liquidity"}
            {(ammRefreshing || balancesRefreshing) && !ammLoading && !balancesLoading && (
              <div className="absolute top-2 right-2 w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
            )}
          </button>
        </>
      ) : (
        <>
          {/* LP Token Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm text-zinc-400">LP Tokens to Burn</label>
              <span className="text-sm text-zinc-500">
                Balance: {formatBalance(userLpBalance)} secuLPT
              </span>
            </div>
            <div className="relative">
              <input
                type="text"
                value={lpAmount}
                onChange={handleLpAmountChange}
                placeholder="0.0"
                disabled={false}
                className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-4 py-4 text-2xl font-semibold text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 disabled:opacity-50"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button
                  onClick={() => setLpAmount(userLpBalance.toFixed(6))}
                  disabled={userLpBalance <= 0}
                  className="px-2 py-1 text-xs font-medium text-orange-400 bg-orange-500/20 rounded hover:bg-orange-500/30 transition-colors disabled:opacity-50"
                >
                  MAX
                </button>
                <span className="text-zinc-400 font-medium">secuLPT</span>
              </div>
            </div>
          </div>

          {/* You Will Receive */}
          <div className="space-y-2">
            <label className="text-sm text-zinc-400">You Receive</label>
            <div className="bg-zinc-800/30 border border-zinc-700/30 rounded-xl p-4">
              <div className="flex justify-between items-center">
                <div>
                  <span className="text-2xl font-semibold text-emerald-400">{formatBalance(expectedSolOutput)}</span>
                  <span className="text-zinc-400 ml-2">SOL</span>
                </div>
                <span className="text-zinc-500">+</span>
                <div>
                  <span className="text-2xl font-semibold text-emerald-400">{formatBalance(expectedSecuSolOutput)}</span>
                  <span className="text-zinc-400 ml-2">secuSOL</span>
                </div>
              </div>
            </div>
          </div>

          {/* Remove Button */}
          <button
            onClick={handleRemoveLiquidity}
            disabled={!isValidAmount() || ammLoading || balancesLoading}
            className={`
              w-full py-4 rounded-xl font-semibold text-lg transition-all relative
              ${isValidAmount() && !ammLoading && !balancesLoading
                ? "bg-gradient-to-r from-orange-500 to-red-500 text-white hover:from-orange-400 hover:to-red-400 shadow-lg shadow-orange-500/25 cursor-pointer"
                : "bg-zinc-700 text-zinc-400 cursor-not-allowed"
              }
            `}
          >
            {ammLoading || balancesLoading ? "Loading..." : "Remove Liquidity"}
            {(ammRefreshing || balancesRefreshing) && !ammLoading && !balancesLoading && (
              <div className="absolute top-2 right-2 w-2 h-2 bg-orange-400 rounded-full animate-pulse"></div>
            )}
          </button>
        </>
      )}

      {/* Info */}
      <div className="flex items-center gap-2 justify-center text-zinc-500 text-sm">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>LP providers earn {feeBps / 100}% on every swap</span>
      </div>
    </div>
  );
};

export default LiquidityForm;
