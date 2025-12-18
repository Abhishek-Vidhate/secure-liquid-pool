"use client";

import { FC } from "react";
import { CommitRevealPhase } from "../hooks/useCommitReveal";
import { getExplorerTxUrl } from "../lib/constants";

interface TransactionStatusProps {
  phase: CommitRevealPhase;
  error: string | null;
  txSignature: string | null;
  onRetry?: () => void;
  onClose?: () => void;
}

const phaseMessages: Record<CommitRevealPhase, { title: string; description: string }> = {
  idle: { title: "", description: "" },
  calculating: { title: "Calculating", description: "Computing output amount..." },
  committing: { title: "Committing Intent", description: "Hiding your swap intent from MEV bots..." },
  committed: { title: "Intent Committed!", description: "Your swap intent is now hidden on-chain." },
  waiting_delay: { title: "Waiting for Delay", description: "Ensuring MEV protection (1 second delay)..." },
  revealing: { title: "Executing Transaction", description: "Revealing intent and executing stake/unstake..." },
  submitting: { title: "Processing Transaction", description: "Please wait while your transaction is being processed..." },
  completed: { title: "Success!", description: "Your transaction has been completed successfully." },
  error: { title: "Error", description: "Something went wrong." },
};

export const TransactionStatus: FC<TransactionStatusProps> = ({
  phase,
  error,
  txSignature,
  onRetry,
  onClose,
}) => {
  if (phase === "idle") return null;

  const { title, description } = phaseMessages[phase];
  const isLoading = ["calculating", "committing", "waiting_delay", "revealing", "submitting"].includes(phase);
  const isSuccess = phase === "completed";
  const isError = phase === "error";

  return (
    <div className={`
      rounded-2xl p-6 border backdrop-blur-sm
      ${isSuccess ? "bg-emerald-500/10 border-emerald-500/30" : ""}
      ${isError ? "bg-red-500/10 border-red-500/30" : ""}
      ${isLoading ? "bg-violet-500/10 border-violet-500/30" : ""}
      ${phase === "committed" ? "bg-amber-500/10 border-amber-500/30" : ""}
    `}>
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className={`
          w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0
          ${isSuccess ? "bg-emerald-500/20 text-emerald-400" : ""}
          ${isError ? "bg-red-500/20 text-red-400" : ""}
          ${isLoading ? "bg-violet-500/20 text-violet-400" : ""}
          ${phase === "committed" ? "bg-amber-500/20 text-amber-400" : ""}
        `}>
          {isLoading && (
            <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          )}
          {isSuccess && (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {isError && (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          {phase === "committed" && (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className={`
            font-semibold text-lg
            ${isSuccess ? "text-emerald-400" : ""}
            ${isError ? "text-red-400" : ""}
            ${isLoading ? "text-violet-400" : ""}
            ${phase === "committed" ? "text-amber-400" : ""}
          `}>
            {title}
          </h3>
          <p className="text-zinc-400 text-sm mt-1">
            {isError && error ? error : description}
          </p>

          {/* Transaction Signature / Explorer Link */}
          {txSignature && (isSuccess || phase === "committed") && (
            <div className="mt-3">
              <a
                href={getExplorerTxUrl(txSignature)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-violet-400 hover:text-violet-300 transition-colors"
              >
                View on Solana Explorer
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 mt-4">
            {isError && onRetry && (
              <button
                onClick={onRetry}
                className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition-colors"
              >
                Try Again
              </button>
            )}
            {(isSuccess || isError) && onClose && (
              <button
                onClick={onClose}
                className="px-4 py-2 bg-zinc-700/50 text-zinc-300 rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Progress Bar for Loading States */}
      {isLoading && (
        <div className="mt-4 h-1 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full animate-pulse w-3/4" />
        </div>
      )}
    </div>
  );
};

export default TransactionStatus;
