"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * React Error Boundary component to catch and handle React component errors
 * 
 * This component catches errors during rendering, in lifecycle methods, and in
 * constructors of the whole tree below them. It does NOT catch errors in:
 * - Event handlers
 * - Asynchronous code (setTimeout, promises, etc.)
 * - Errors thrown in the error boundary itself
 * - Server-side rendering
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to console
    console.error("ErrorBoundary caught an error:", error, errorInfo);

    // Update state with error info
    this.setState({
      error,
      errorInfo,
    });

    // Call optional error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // TODO: In production, you might want to log to an error reporting service
    // Example: logErrorToService(error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
          <div className="max-w-2xl w-full bg-zinc-900 rounded-2xl border border-red-500/30 p-8">
            <div className="flex items-start gap-4">
              {/* Error Icon */}
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <svg
                  className="w-6 h-6 text-red-400"
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
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-red-400 mb-2">
                  Something went wrong
                </h2>
                <p className="text-zinc-400 mb-4">
                  An unexpected error occurred. Please try refreshing the page or contact support if the problem persists.
                </p>

                {/* Error Details (only in development) */}
                {process.env.NODE_ENV === "development" && this.state.error && (
                  <div className="mt-6 p-4 bg-zinc-800/50 rounded-lg border border-zinc-700">
                    <p className="text-sm font-mono text-red-300 mb-2">
                      {this.state.error.toString()}
                    </p>
                    {this.state.errorInfo && (
                      <details className="mt-2">
                        <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400">
                          Component Stack
                        </summary>
                        <pre className="mt-2 text-xs text-zinc-400 overflow-auto max-h-48">
                          {this.state.errorInfo.componentStack}
                        </pre>
                      </details>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={this.handleReset}
                    className="px-4 py-2 bg-violet-500/20 text-violet-400 rounded-lg text-sm font-medium hover:bg-violet-500/30 transition-colors"
                  >
                    Try Again
                  </button>
                  <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 bg-zinc-700/50 text-zinc-300 rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors"
                  >
                    Refresh Page
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
