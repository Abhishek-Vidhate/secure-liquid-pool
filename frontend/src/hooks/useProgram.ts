"use client";

import { useAnchor } from "../app/providers";

/**
 * Hook to get the SecureLiquidPool program instance
 * Returns null if wallet is not connected
 */
export function useProgram() {
  const { program } = useAnchor();
  return program;
}

/**
 * Hook to get the Anchor provider
 * Returns null if wallet is not connected
 */
export function useProvider() {
  const { provider } = useAnchor();
  return provider;
}

