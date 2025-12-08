"use client";

import { FC, useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useBalances, formatBalance } from "../hooks/useBalances";
import { useCommitment, canReveal } from "../hooks/useCommitment";
import { useCommitReveal } from "../hooks/useCommitReveal";
import { useStakePool } from "../hooks/useStakePool";
import { MIN_AMOUNT_LAMPORTS, DEFAULT_SLIPPAGE_BPS, MIN_DELAY_SECONDS } from "../lib/constants";
import TransactionStatus from "./TransactionStatus";
import PoolStats from "./PoolStats";

const SLIPPAGE_OPTIONS = [
  { label: "0.1%", value: 10 },
  { label: "0.5%", value: 50 },
  { label: "1%", value: 100 },
];

export const UnstakeForm: FC = () => {
  const { connected } = useWallet();
  const { slpSolBalance, isLoading: balancesLoading } = useBalances();
  const { commitment, exists: hasCommitment } = useCommitment();
  const { poolConfig, calculateSolForSlp, exchangeRate, reserveSol, loading: poolLoading } = useStakePool();
  const {
    phase,
    error,
    txSignature,
    quote,
    initiateUnstake,
    executeUnstakeReveal,
    cancelCommitment,
    reset,
  } = useCommitReveal();

  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [outputPreview, setOutputPreview] = useState<string | null>(null);

  // Calculate output when amount changes
  useEffect(() => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0 || !poolConfig) {
      setOutputPreview(null);
      return;
    }

    const lamports = BigInt(Math.floor(numAmount * LAMPORTS_PER_SOL));
    if (lamports < BigInt(MIN_AMOUNT_LAMPORTS)) {
      setOutputPreview(null);
      return;
    }

    const expectedSol = calculateSolForSlp(lamports);
    setOutputPreview((Number(expectedSol) / LAMPORTS_PER_SOL).toFixed(6));
  }, [amount, poolConfig, calculateSolForSlp]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmount(value);
    }
  };

  const handleMaxClick = () => {
    setAmount(slpSolBalance.toFixed(6));
  };

  const handleUnstake = async () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) return;
    await initiateUnstake(numAmount, slippageBps);
  };

  const handleReveal = async () => {
    await executeUnstakeReveal();
  };

  const isValidAmount = () => {
    const numAmount = parseFloat(amount);
    if (numAmount <= 0) return false;
    if (numAmount * LAMPORTS_PER_SOL < MIN_AMOUNT_LAMPORTS) return false;
    if (numAmount > slpSolBalance) return false;
    // Check if reserve has enough for instant unstake
    const expectedSol = numAmount * exchangeRate;
    if (expectedSol > reserveSol) return false;
    return true;
  };

  // Show reveal button if user has an unstake commitment
  const showRevealButton = hasCommitment && commitment && !commitment.isStake ? true : false;
  const canExecuteReveal = showRevealButton && commitment && canReveal(commitment, MIN_DELAY_SECONDS);

  if (!connected) {
    return (
      <div className="text-center py-12">
        <h3 className="text-xl font-semibold text-zinc-300 mb-2">Connect Wallet to Unstake</h3>
        <p className="text-zinc-500">Connect your wallet to unstake secuSOL for SOL.</p>
      </div>
    );
  }

  if (!poolConfig && !poolLoading) {
    return (
      <div className="text-center py-12">
        <h3 className="text-xl font-semibold text-amber-400 mb-2">Pool Not Initialized</h3>
        <p className="text-zinc-500">The stake pool has not been initialized yet.</p>
      </div>
    );
  }

  if (slpSolBalance === 0 && !showRevealButton) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
          <span className="text-2xl">S</span>
        </div>
        <h3 className="text-xl font-semibold text-zinc-300 mb-2">No secuSOL to Unstake</h3>
        <p className="text-zinc-500">Stake some SOL first to get secuSOL.</p>
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

  // Calculate max that can be unstaked based on reserve
  const maxUnstakeableSlp = reserveSol > 0 ? reserveSol / exchangeRate : 0;
  const effectiveMax = Math.min(slpSolBalance, maxUnstakeableSlp);

  return (
    <div className="space-y-6">
      {/* Pool Stats */}
      <PoolStats compact />

      {/* Reserve Warning */}
      {reserveSol < slpSolBalance * exchangeRate && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
          <p className="text-amber-400 text-sm">
            ⚠️ Only {formatBalance(maxUnstakeableSlp)} secuSOL can be unstaked instantly due to reserve limits.
          </p>
        </div>
      )}

      {/* Amount Input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-zinc-400">Amount to Unstake</label>
          <span className="text-sm text-zinc-500">
            Balance: {balancesLoading ? "..." : formatBalance(slpSolBalance)} secuSOL
          </span>
        </div>
        <div className="relative">
          <input
            type="text"
            value={amount}
            onChange={handleAmountChange}
            placeholder="0.0"
            disabled={showRevealButton}
            className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-4 py-4 text-2xl font-semibold text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 disabled:opacity-50"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <button
              onClick={handleMaxClick}
              disabled={showRevealButton}
              className="px-2 py-1 text-xs font-medium text-orange-400 bg-orange-500/20 rounded hover:bg-orange-500/30 transition-colors disabled:opacity-50"
            >
              MAX
            </button>
            <span className="text-zinc-400 font-medium">secuSOL</span>
          </div>
        </div>
        {parseFloat(amount) > 0 && parseFloat(amount) * LAMPORTS_PER_SOL < MIN_AMOUNT_LAMPORTS && (
          <p className="text-red-400 text-sm">Minimum amount is 0.01 secuSOL</p>
        )}
        {parseFloat(amount) > effectiveMax && (
          <p className="text-red-400 text-sm">Exceeds available reserve for instant unstake</p>
        )}
      </div>

      {/* Slippage Selection */}
      <div className="space-y-2">
        <label className="text-sm text-zinc-400">Slippage Tolerance</label>
        <div className="flex gap-2">
          {SLIPPAGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setSlippageBps(option.value)}
              disabled={showRevealButton}
              className={`
                flex-1 py-2 rounded-lg text-sm font-medium transition-all
                ${slippageBps === option.value
                  ? "bg-orange-500/20 text-orange-400 border border-orange-500/50"
                  : "bg-zinc-800/50 text-zinc-400 border border-zinc-700/50 hover:border-zinc-600"
                }
                disabled:opacity-50
              `}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Output Preview */}
      {outputPreview && !showRevealButton && (
        <div className="bg-zinc-800/30 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-zinc-400 text-sm">You will receive</span>
            <span className="text-lg font-semibold text-emerald-400">
              ~{outputPreview} SOL
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-zinc-400 text-sm">Exchange Rate</span>
            <span className="text-zinc-300 text-sm">1 secuSOL = {exchangeRate.toFixed(6)} SOL</span>
          </div>
        </div>
      )}

      {/* Committed State Message */}
      {showRevealButton && commitment && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-amber-400 text-sm font-medium">
              ⏳ Pending Unstake Commitment
            </p>
            <button
              onClick={cancelCommitment}
              className="text-xs text-zinc-400 hover:text-red-400 transition-colors"
            >
              Cancel
            </button>
          </div>
          <div className="text-zinc-300 text-sm">
            Amount: {(Number(commitment.amountLamports) / LAMPORTS_PER_SOL).toFixed(4)} secuSOL
          </div>
          <p className="text-amber-400/80 text-xs">
            {canExecuteReveal 
              ? "✓ Delay period passed. You can now execute the unstake."
              : "Please wait for the 1-second delay period to pass."}
          </p>
        </div>
      )}

      {/* Action Buttons */}
      {showRevealButton ? (
        <button
          onClick={handleReveal}
          disabled={!canExecuteReveal}
          className={`
            w-full py-4 rounded-xl font-semibold text-lg transition-all
            ${canExecuteReveal
              ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-400 hover:to-teal-400 shadow-lg shadow-emerald-500/25"
              : "bg-zinc-700 text-zinc-400 cursor-not-allowed"
            }
          `}
        >
          {canExecuteReveal ? "Execute Unstake" : "Waiting for Delay..."}
        </button>
      ) : (
        <button
          onClick={handleUnstake}
          disabled={!isValidAmount() || poolLoading}
          className={`
            w-full py-4 rounded-xl font-semibold text-lg transition-all
            ${isValidAmount() && !poolLoading
              ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-400 hover:to-amber-400 shadow-lg shadow-orange-500/25"
              : "bg-zinc-700 text-zinc-400 cursor-not-allowed"
            }
          `}
        >
          {poolLoading ? "Loading Pool..." : "Commit Unstake Intent"}
        </button>
      )}

      {/* MEV Protection Info */}
      <div className="flex items-center gap-2 justify-center text-zinc-500 text-sm">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <span>Protected by commit-reveal MEV protection</span>
      </div>
    </div>
  );
};

export default UnstakeForm;
