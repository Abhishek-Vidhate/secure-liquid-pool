"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import {
  fetchPoolConfig,
  fetchAmmPool,
  fetchCommitment,
  PoolConfig,
  AmmPool,
  Commitment as CommitmentType,
  calculateExchangeRate,
  calculateSlpForDeposit,
  calculateSolForWithdrawal,
  calculateAmmSwapOutput,
} from "../lib/program";
import { WSOL_MINT, SLP_SOL_DECIMALS } from "../lib/constants";

// ============================================================================
// TYPES
// ============================================================================

interface PoolDataState {
  // Pool Config
  poolConfig: PoolConfig | null;
  poolConfigInitialLoading: boolean;
  poolConfigIsRefreshing: boolean;
  poolConfigError: Error | null;
  poolConfigLastFetch: number | null;

  // AMM Pool
  ammPool: AmmPool | null;
  ammPoolInitialLoading: boolean;
  ammPoolIsRefreshing: boolean;
  ammPoolError: Error | null;
  ammPoolLastFetch: number | null;

  // Balances
  balances: {
    solBalance: number;
    solBalanceLamports: bigint;
    slpSolBalance: number;
    slpSolBalanceLamports: bigint;
    slpSolMint: PublicKey | null;
  };
  balancesInitialLoading: boolean;
  balancesIsRefreshing: boolean;
  balancesError: Error | null;
  balancesLastFetch: number | null;

  // Commitment
  commitment: CommitmentType | null;
  commitmentInitialLoading: boolean;
  commitmentIsRefreshing: boolean;
  commitmentError: Error | null;
  commitmentLastFetch: number | null;
  commitmentExists: boolean;

  // Derived values for pool config
  exchangeRate: number;
  totalStakedSol: number;
  totalSlpSupply: number;
  reserveSol: number;
  apy: number;

  // Derived values for AMM
  reserveA: number;
  reserveB: number;
  totalLpSupply: number;
  priceAinB: number;
  priceBinA: number;
  feeBps: number;
  lpMint: PublicKey | null;

  // Helper functions
  calculateSlpForSol: (solLamports: bigint) => bigint;
  calculateSolForSlp: (slpAmount: bigint) => bigint;
  calculateSwapOutput: (
    amountIn: bigint,
    aToB: boolean
  ) => { amountOut: bigint; fee: bigint };

  // Refresh functions
  refreshPoolConfig: () => Promise<void>;
  refreshAmmPool: () => Promise<void>;
  refreshBalances: (bypassThrottle?: boolean) => Promise<void>;
  refreshCommitment: (bypassThrottle?: boolean) => Promise<void>;
  refreshAll: () => Promise<void>;
}

// ============================================================================
// CONTEXT
// ============================================================================

const PoolDataContext = createContext<PoolDataState | null>(null);

// ============================================================================
// PROVIDER
// ============================================================================

interface PoolDataProviderProps {
  children: ReactNode;
}

const STALE_THRESHOLD_MS = 8000; // 8 seconds
const POLL_INTERVAL_MS = 8000; // 8 seconds (Helius RPC can handle faster polling with better rate limits)
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const RATE_LIMIT_RETRY_DELAY_MS = 5000; // 5 seconds for 429 errors
const POST_TRANSACTION_REFRESH_DELAY_MS = 0; // No delay - Helius indexes transactions immediately, and confirmTransaction already waits for confirmation

export function PoolDataProvider({ children }: PoolDataProviderProps) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  // State
  const [poolConfig, setPoolConfig] = useState<PoolConfig | null>(null);
  const [poolConfigInitialLoading, setPoolConfigInitialLoading] =
    useState(true);
  const [poolConfigIsRefreshing, setPoolConfigIsRefreshing] = useState(false);
  const [poolConfigError, setPoolConfigError] = useState<Error | null>(null);
  const [poolConfigLastFetch, setPoolConfigLastFetch] = useState<number | null>(
    null
  );

  const [ammPool, setAmmPool] = useState<AmmPool | null>(null);
  const [ammPoolInitialLoading, setAmmPoolInitialLoading] = useState(true);
  const [ammPoolIsRefreshing, setAmmPoolIsRefreshing] = useState(false);
  const [ammPoolError, setAmmPoolError] = useState<Error | null>(null);
  const [ammPoolLastFetch, setAmmPoolLastFetch] = useState<number | null>(
    null
  );

  const [balances, setBalances] = useState({
    solBalance: 0,
    solBalanceLamports: BigInt(0),
    slpSolBalance: 0,
    slpSolBalanceLamports: BigInt(0),
    slpSolMint: null as PublicKey | null,
  });
  const [balancesInitialLoading, setBalancesInitialLoading] = useState(true);
  const [balancesIsRefreshing, setBalancesIsRefreshing] = useState(false);
  const [balancesError, setBalancesError] = useState<Error | null>(null);
  const [balancesLastFetch, setBalancesLastFetch] = useState<number | null>(
    null
  );

  const [commitment, setCommitment] = useState<CommitmentType | null>(null);
  const [commitmentInitialLoading, setCommitmentInitialLoading] =
    useState(true);
  const [commitmentIsRefreshing, setCommitmentIsRefreshing] = useState(false);
  const [commitmentError, setCommitmentError] = useState<Error | null>(null);
  const [commitmentLastFetch, setCommitmentLastFetch] = useState<number | null>(
    null
  );
  const [commitmentExists, setCommitmentExists] = useState(false);

  // Request deduplication
  const inFlightRequests = useRef<Set<string>>(new Set());
  const requestPromises = useRef<
    Map<string, Promise<PoolConfig | AmmPool | CommitmentType | void | null>>
  >(new Map());

  // Request throttling - track last request time per resource
  const lastRequestTime = useRef<Map<string, number>>(new Map());
  const MIN_REQUEST_INTERVAL_MS = 2000; // Minimum 2 seconds between requests for same resource

  // Check if error is a rate limit (429) error
  const isRateLimitError = useCallback((error: unknown): boolean => {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes("429") ||
        message.includes("rate limit") ||
        message.includes("too many requests");
    }
    return false;
  }, []);

  // Retry helper with proper 429 handling
  const retryWithBackoff = useCallback(
    async <T,>(
      fn: () => Promise<T>,
      retries: number = MAX_RETRIES
    ): Promise<T> => {
      try {
        return await fn();
      } catch (error) {
        // If it's a rate limit error, use longer backoff and don't retry immediately
        if (isRateLimitError(error)) {
          if (retries > 0) {
            // Exponential backoff for rate limits: 5s, 10s, 20s
            const delay = RATE_LIMIT_RETRY_DELAY_MS * Math.pow(2, MAX_RETRIES - retries);
            console.warn(`Rate limit detected. Waiting ${delay}ms before retry...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            return retryWithBackoff(fn, retries - 1);
          }
          // If we've exhausted retries on rate limit, throw but don't spam
          throw error;
        }

        // For non-rate-limit errors, use normal retry logic
        if (retries > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_DELAY_MS * (MAX_RETRIES - retries + 1))
          );
          return retryWithBackoff(fn, retries - 1);
        }
        throw error;
      }
    },
    [isRateLimitError]
  );

  // Fetch pool config with deduplication
  const fetchPoolConfigWithDedup = useCallback(async (): Promise<PoolConfig | null> => {
    const requestKey = "poolConfig";

    // If request is in-flight, return existing promise
    if (inFlightRequests.current.has(requestKey)) {
      const existingPromise = requestPromises.current.get(requestKey);
      if (existingPromise) {
        return existingPromise as Promise<PoolConfig | null>;
      }
    }

    // Create new request
    inFlightRequests.current.add(requestKey);
    const promise = retryWithBackoff(async () => {
      try {
        const config = await fetchPoolConfig(connection);
        return config;
      } finally {
        inFlightRequests.current.delete(requestKey);
        requestPromises.current.delete(requestKey);
      }
    });

    requestPromises.current.set(requestKey, promise);
    return promise;
  }, [connection, retryWithBackoff]);

  // Refresh pool config with throttling
  // Request deduplication already prevents duplicate simultaneous requests
  const refreshPoolConfig = useCallback(async () => {
    const isInitial = poolConfigLastFetch === null;
    const requestKey = "poolConfig";

    // Throttle: For non-initial requests, check if we've made a request recently
    if (!isInitial) {
      const lastRequest = lastRequestTime.current.get(requestKey);
      const now = Date.now();
      if (lastRequest && (now - lastRequest) < MIN_REQUEST_INTERVAL_MS) {
        // Too soon, skip this refresh
        return;
      }
      lastRequestTime.current.set(requestKey, now);
    }

    if (isInitial) {
      setPoolConfigInitialLoading(true);
    } else {
      setPoolConfigIsRefreshing(true);
    }
    setPoolConfigError(null);

    try {
      const config = await fetchPoolConfigWithDedup();
      if (config !== null) {
        setPoolConfig(config);
        setPoolConfigLastFetch(Date.now());
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error("Unknown error");
      setPoolConfigError(err);
      console.error("Error fetching pool config:", err);
    } finally {
      setPoolConfigInitialLoading(false);
      setPoolConfigIsRefreshing(false);
    }
  }, [connection, poolConfigLastFetch, fetchPoolConfigWithDedup]);

  // Refresh AMM pool with throttling
  const refreshAmmPool = useCallback(async () => {
    if (!poolConfig?.slpMint) {
      setAmmPoolInitialLoading(false);
      setAmmPoolIsRefreshing(false);
      return;
    }

    const requestKey = `ammPool:${poolConfig.slpMint.toString()}`;
    const isInitial = ammPoolLastFetch === null;

    // Throttle: For non-initial requests, check if we've made a request recently
    if (!isInitial) {
      const lastRequest = lastRequestTime.current.get(requestKey);
      const now = Date.now();
      if (lastRequest && (now - lastRequest) < MIN_REQUEST_INTERVAL_MS) {
        // Too soon, skip this refresh
        return;
      }
      lastRequestTime.current.set(requestKey, now);
    }

    if (isInitial) {
      setAmmPoolInitialLoading(true);
    } else {
      setAmmPoolIsRefreshing(true);
    }
    setAmmPoolError(null);

    // Check for in-flight request
    if (inFlightRequests.current.has(requestKey)) {
      const existingPromise = requestPromises.current.get(requestKey);
      if (existingPromise) {
        try {
          await existingPromise;
        } catch (error) {
          // Error already handled by the original request
        } finally {
          setAmmPoolInitialLoading(false);
          setAmmPoolIsRefreshing(false);
        }
        return;
      }
    }

    try {
      inFlightRequests.current.add(requestKey);
      const promise = retryWithBackoff(async () => {
        try {
          const pool = await fetchAmmPool(connection, WSOL_MINT, poolConfig.slpMint);
          return pool;
        } finally {
          inFlightRequests.current.delete(requestKey);
          requestPromises.current.delete(requestKey);
        }
      });

      requestPromises.current.set(requestKey, promise);
      const pool = await promise;
      setAmmPool(pool);
      setAmmPoolLastFetch(Date.now());
    } catch (error) {
      const err = error instanceof Error ? error : new Error("Unknown error");
      setAmmPoolError(err);
      console.error("Error fetching AMM pool:", err);
    } finally {
      setAmmPoolInitialLoading(false);
      setAmmPoolIsRefreshing(false);
    }
  }, [connection, poolConfig?.slpMint, ammPoolLastFetch, retryWithBackoff]);

  // Refresh balances with throttling
  // bypassThrottle: Set to true for post-transaction refreshes to allow immediate updates
  const refreshBalances = useCallback(async (bypassThrottle: boolean = false) => {
    if (!publicKey) {
      setBalances({
        solBalance: 0,
        solBalanceLamports: BigInt(0),
        slpSolBalance: 0,
        slpSolBalanceLamports: BigInt(0),
        slpSolMint: null,
      });
      setBalancesInitialLoading(false);
      setBalancesIsRefreshing(false);
      return;
    }

    const requestKey = `balances:${publicKey.toString()}`;
    const isInitial = balancesLastFetch === null;

    // Throttle: For non-initial requests, check if we've made a request recently
    // But allow bypass for post-transaction refreshes (with a small delay to ensure transaction is confirmed)
    if (!isInitial && !bypassThrottle) {
      const lastRequest = lastRequestTime.current.get(requestKey);
      const now = Date.now();
      if (lastRequest && (now - lastRequest) < MIN_REQUEST_INTERVAL_MS) {
        // Too soon, skip this refresh
        return;
      }
      lastRequestTime.current.set(requestKey, now);
    } else if (bypassThrottle) {
      // For post-transaction refreshes, bypass throttling completely
      // Helius RPC indexes transactions immediately, and confirmTransaction already waits for confirmation
      // No delay needed
    }

    if (isInitial) {
      setBalancesInitialLoading(true);
    } else {
      setBalancesIsRefreshing(true);
    }
    setBalancesError(null);

    // Check for in-flight request
    if (inFlightRequests.current.has(requestKey)) {
      const existingPromise = requestPromises.current.get(requestKey);
      if (existingPromise) {
        try {
          await existingPromise;
        } catch (error) {
          // Error already handled
        } finally {
          setBalancesInitialLoading(false);
          setBalancesIsRefreshing(false);
        }
        return;
      }
    }

    try {
      inFlightRequests.current.add(requestKey);
      const promise = retryWithBackoff(async () => {
        try {
          // Use cached poolConfig if available, otherwise fetch
          let slpSolMint: PublicKey | null = null;
          if (poolConfig?.slpMint) {
            slpSolMint = poolConfig.slpMint;
          } else {
            const config = await fetchPoolConfigWithDedup();
            slpSolMint = config?.slpMint ?? null;
          }

          // Fetch SOL balance
          const solBalanceLamports = await connection.getBalance(publicKey);
          const solBalance = solBalanceLamports / LAMPORTS_PER_SOL;

          // Fetch slpSOL balance
          let slpSolBalanceLamports = BigInt(0);
          let slpSolBalance = 0;

          if (slpSolMint) {
            try {
              const slpSolAta = await getAssociatedTokenAddress(
                slpSolMint,
                publicKey
              );
              const tokenAccount = await getAccount(connection, slpSolAta);
              slpSolBalanceLamports = tokenAccount.amount;
              slpSolBalance =
                Number(slpSolBalanceLamports) / Math.pow(10, SLP_SOL_DECIMALS);
            } catch (e) {
              if (!(e instanceof TokenAccountNotFoundError)) {
                console.error("Error fetching slpSOL balance:", e);
              }
            }
          }

          setBalances({
            solBalance,
            solBalanceLamports: BigInt(solBalanceLamports),
            slpSolBalance,
            slpSolBalanceLamports,
            slpSolMint,
          });
          setBalancesLastFetch(Date.now());
        } finally {
          inFlightRequests.current.delete(requestKey);
          requestPromises.current.delete(requestKey);
        }
      });

      requestPromises.current.set(requestKey, promise);
      await promise;
    } catch (error) {
      const err = error instanceof Error ? error : new Error("Unknown error");
      setBalancesError(err);
      console.error("Error fetching balances:", err);
    } finally {
      setBalancesInitialLoading(false);
      setBalancesIsRefreshing(false);
    }
  }, [
    connection,
    publicKey,
    poolConfig?.slpMint,
    balancesLastFetch,
    fetchPoolConfigWithDedup,
    retryWithBackoff,
  ]);

  // Refresh commitment with throttling
  // bypassThrottle: Set to true for post-transaction refreshes to allow immediate updates
  const refreshCommitment = useCallback(async (bypassThrottle: boolean = false) => {
    if (!publicKey) {
      setCommitment(null);
      setCommitmentExists(false);
      setCommitmentInitialLoading(false);
      setCommitmentIsRefreshing(false);
      return;
    }

    const requestKey = `commitment:${publicKey.toString()}`;
    const isInitial = commitmentLastFetch === null;

    // Throttle: For non-initial requests, check if we've made a request recently
    // But allow bypass for post-transaction refreshes (with a small delay to ensure transaction is confirmed)
    if (!isInitial && !bypassThrottle) {
      const lastRequest = lastRequestTime.current.get(requestKey);
      const now = Date.now();
      if (lastRequest && (now - lastRequest) < MIN_REQUEST_INTERVAL_MS) {
        // Too soon, skip this refresh
        return;
      }
      lastRequestTime.current.set(requestKey, now);
    } else if (bypassThrottle) {
      // For post-transaction refreshes, bypass throttling completely
      // Helius RPC indexes transactions immediately, and confirmTransaction already waits for confirmation
      // No delay needed
    }

    if (isInitial) {
      setCommitmentInitialLoading(true);
    } else {
      setCommitmentIsRefreshing(true);
    }
    setCommitmentError(null);

    // Check for in-flight request
    if (inFlightRequests.current.has(requestKey)) {
      const existingPromise = requestPromises.current.get(requestKey);
      if (existingPromise) {
        try {
          await existingPromise;
        } catch (error) {
          // Error already handled
        } finally {
          setCommitmentInitialLoading(false);
          setCommitmentIsRefreshing(false);
        }
        return;
      }
    }

    try {
      inFlightRequests.current.add(requestKey);
      const promise = retryWithBackoff(async () => {
        try {
          const comm = await fetchCommitment(connection, publicKey);
          return comm;
        } finally {
          inFlightRequests.current.delete(requestKey);
          requestPromises.current.delete(requestKey);
        }
      });

      requestPromises.current.set(requestKey, promise);
      const comm = await promise;
      setCommitment(comm);
      setCommitmentExists(comm !== null);
      setCommitmentLastFetch(Date.now());
    } catch (error) {
      const err = error instanceof Error ? error : new Error("Unknown error");
      setCommitmentError(err);
      console.error("Error fetching commitment:", err);
    } finally {
      setCommitmentInitialLoading(false);
      setCommitmentIsRefreshing(false);
    }
  }, [connection, publicKey, commitmentLastFetch, retryWithBackoff]);

  // Refresh all data
  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshPoolConfig(),
      refreshBalances(),
      refreshCommitment(),
    ]);
    // AMM pool refresh depends on poolConfig, so do it after
    await refreshAmmPool();
  }, [refreshPoolConfig, refreshAmmPool, refreshBalances, refreshCommitment]);

  // Initial fetch
  useEffect(() => {
    refreshPoolConfig();
  }, [refreshPoolConfig]);

  // Fetch AMM pool when poolConfig is available
  useEffect(() => {
    if (poolConfig?.slpMint) {
      refreshAmmPool();
    }
  }, [poolConfig?.slpMint, refreshAmmPool]);

  // Fetch balances when wallet is connected
  useEffect(() => {
    if (publicKey) {
      refreshBalances();
    }
  }, [publicKey, refreshBalances]);

  // Fetch commitment when wallet is connected
  useEffect(() => {
    if (publicKey) {
      refreshCommitment();
    }
  }, [publicKey, refreshCommitment]);

  // Unified polling - pause when tab is hidden to reduce RPC load
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    const startPolling = () => {
      if (interval) clearInterval(interval);
      interval = setInterval(() => {
        refreshAll();
      }, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    // Start polling if tab is visible
    if (!document.hidden) {
      startPolling();
    }

    // Handle visibility changes
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab is hidden - pause polling to reduce RPC load
        stopPolling();
      } else {
        // Tab is visible - resume polling and refresh data immediately
        refreshAll();
        startPolling();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshAll]);

  // Calculate derived values for pool config
  const exchangeRate = poolConfig
    ? calculateExchangeRate(poolConfig)
    : 1.0;
  const totalStakedSol = poolConfig
    ? Number(poolConfig.totalStakedLamports) / LAMPORTS_PER_SOL
    : 0;
  const totalSlpSupply = poolConfig
    ? Number(poolConfig.totalSlpSupply) / LAMPORTS_PER_SOL
    : 0;
  const reserveSol = poolConfig
    ? Number(poolConfig.reserveLamports) / LAMPORTS_PER_SOL
    : 0;
  const apy = 7.0; // Estimated APY

  // Calculate derived values for AMM
  const reserveA = ammPool ? Number(ammPool.reserveA) / LAMPORTS_PER_SOL : 0;
  const reserveB = ammPool ? Number(ammPool.reserveB) / LAMPORTS_PER_SOL : 0;
  const totalLpSupply = ammPool
    ? Number(ammPool.totalLpSupply) / LAMPORTS_PER_SOL
    : 0;
  const priceAinB = reserveA > 0 ? reserveB / reserveA : 0;
  const priceBinA = reserveB > 0 ? reserveA / reserveB : 0;
  const feeBps = ammPool?.feeBps ?? 30;
  const lpMint = ammPool?.lpMint ?? null;

  // Helper functions
  const calculateSlpForSol = useCallback(
    (solLamports: bigint): bigint => {
      if (!poolConfig) return solLamports;
      return calculateSlpForDeposit(poolConfig, solLamports);
    },
    [poolConfig]
  );

  const calculateSolForSlp = useCallback(
    (slpAmount: bigint): bigint => {
      if (!poolConfig) return slpAmount;
      return calculateSolForWithdrawal(poolConfig, slpAmount);
    },
    [poolConfig]
  );

  const calculateSwapOutput = useCallback(
    (
      amountIn: bigint,
      aToB: boolean
    ): { amountOut: bigint; fee: bigint } => {
      if (!ammPool) {
        return { amountOut: BigInt(0), fee: BigInt(0) };
      }
      return calculateAmmSwapOutput(ammPool, amountIn, aToB);
    },
    [ammPool]
  );

  const value: PoolDataState = {
    poolConfig,
    poolConfigInitialLoading,
    poolConfigIsRefreshing,
    poolConfigError,
    poolConfigLastFetch,
    ammPool,
    ammPoolInitialLoading,
    ammPoolIsRefreshing,
    ammPoolError,
    ammPoolLastFetch,
    balances,
    balancesInitialLoading,
    balancesIsRefreshing,
    balancesError,
    balancesLastFetch,
    commitment,
    commitmentInitialLoading,
    commitmentIsRefreshing,
    commitmentError,
    commitmentLastFetch,
    commitmentExists,
    exchangeRate,
    totalStakedSol,
    totalSlpSupply,
    reserveSol,
    apy,
    reserveA,
    reserveB,
    totalLpSupply,
    priceAinB,
    priceBinA,
    feeBps,
    lpMint,
    calculateSlpForSol,
    calculateSolForSlp,
    calculateSwapOutput,
    refreshPoolConfig,
    refreshAmmPool,
    refreshBalances,
    refreshCommitment,
    refreshAll,
  };

  return (
    <PoolDataContext.Provider value={value}>
      {children}
    </PoolDataContext.Provider>
  );
}

// ============================================================================
// HOOK
// ============================================================================

export function usePoolData(): PoolDataState {
  const context = useContext(PoolDataContext);
  if (!context) {
    throw new Error("usePoolData must be used within PoolDataProvider");
  }
  return context;
}
