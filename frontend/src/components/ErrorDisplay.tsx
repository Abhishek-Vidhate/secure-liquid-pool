"use client";

import { FC } from "react";

interface ErrorDisplayProps {
  error: string | null;
  onRetry?: () => void;
  onDismiss?: () => void;
  title?: string;
  className?: string;
}

/**
 * Component for displaying user-friendly error messages
 * Used to show context-level data fetching errors
 */
export const ErrorDisplay: FC<ErrorDisplayProps> = ({
  error,
  onRetry,
  onDismiss,
  title = "Error loading data",
  className = "",
}) => {
  if (!error) return null;

  return (
    <div
      className={`bg-red-500/10 border border-red-500/30 rounded-xl p-4 ${className}`}
    >
      <div className="flex items-start gap-3">
        {/* Error Icon */}
        <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg
            className="w-3 h-3 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        {/* Error Content */}
        <div className="flex-1 min-w-0">
          <h4 className="text-red-400 font-medium text-sm mb-1">{title}</h4>
          <p className="text-red-300/80 text-sm break-words">{error}</p>

          {/* Actions */}
          {(onRetry || onDismiss) && (
            <div className="flex gap-2 mt-3">
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-xs font-medium hover:bg-red-500/30 transition-colors"
                >
                  Retry
                </button>
              )}
              {onDismiss && (
                <button
                  onClick={onDismiss}
                  className="px-3 py-1.5 bg-zinc-700/50 text-zinc-300 rounded-lg text-xs font-medium hover:bg-zinc-700 transition-colors"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ErrorDisplay;
