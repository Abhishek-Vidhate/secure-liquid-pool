"use client";

import { FC, ReactNode, useMemo, createContext, useContext } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { RPC_ENDPOINT } from "../lib/constants";
import { getProgram } from "../lib/program";
import type { Securelp } from "../types/securelp";

// Import wallet adapter CSS
import "@solana/wallet-adapter-react-ui/styles.css";

// ============================================================================
// ANCHOR PROVIDER CONTEXT
// ============================================================================

interface AnchorContextState {
  provider: AnchorProvider | null;
  program: Program<Securelp> | null;
}

const AnchorContext = createContext<AnchorContextState>({
  provider: null,
  program: null,
});

export function useAnchor(): AnchorContextState {
  return useContext(AnchorContext);
}

// ============================================================================
// ANCHOR PROVIDER COMPONENT
// ============================================================================

const AnchorProviderComponent: FC<{ children: ReactNode }> = ({ children }) => {
  const { connection } = useConnection();
  const wallet = useWallet();

  const anchorContext = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
      return { provider: null, program: null };
    }

    const provider = new AnchorProvider(
      connection,
      {
        publicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction,
        signAllTransactions: wallet.signAllTransactions,
      },
      { commitment: "confirmed" }
    );

    const program = getProgram(provider);

    return { provider, program };
  }, [connection, wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions]);

  return (
    <AnchorContext.Provider value={anchorContext}>
      {children}
    </AnchorContext.Provider>
  );
};

// ============================================================================
// MAIN PROVIDERS COMPONENT
// ============================================================================

interface ProvidersProps {
  children: ReactNode;
}

export const Providers: FC<ProvidersProps> = ({ children }) => {
  // RPC endpoint
  const endpoint = useMemo(() => RPC_ENDPOINT, []);

  // Wallet adapters
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AnchorProviderComponent>
            {children}
          </AnchorProviderComponent>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default Providers;

