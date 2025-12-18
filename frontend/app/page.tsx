"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import WalletButton from "../src/components/WalletButton";
import StakeForm from "../src/components/StakeForm";
import UnstakeForm from "../src/components/UnstakeForm";
import Dashboard from "../src/components/Dashboard";
import AmmSwap from "../src/components/AmmSwap";
import LiquidityForm from "../src/components/LiquidityForm";

type Tab = "stake" | "unstake" | "swap" | "liquidity" | "dashboard";

export default function Home() {
  const { connected } = useWallet();
  const [activeTab, setActiveTab] = useState<Tab>("stake");

  return (
    <div className="min-h-screen">
      {/* Background gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-violet-950/30 via-zinc-950 to-indigo-950/30 -z-10" />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-violet-900/20 via-transparent to-transparent -z-10" />

      {/* Grid pattern overlay */}
      <div
        className="fixed inset-0 -z-10 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), 
                           linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: "50px 50px",
        }}
      />

      {/* Header */}
      <header className="border-b border-zinc-800/50 backdrop-blur-md bg-zinc-950/80 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <h1 className="font-bold text-lg text-white">SecureLiquidPool</h1>
                <p className="text-xs text-zinc-500">MEV-Protected Liquid Staking</p>
              </div>
            </div>

            {/* Network Badge + Wallet */}
            <div className="flex items-center gap-4">
              <a
                href="/info"
                className="text-sm font-medium text-zinc-400 hover:text-white transition-colors hidden sm:block"
              >
                How It Works
              </a>
              <span className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-full text-amber-400 text-xs font-medium">
                <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                Devnet
              </span>
              <WalletButton />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h2 className="text-4xl sm:text-5xl font-bold mb-4">
            <span className="bg-gradient-to-r from-violet-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
              Stake SOL. Earn Rewards.
            </span>
          </h2>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            Stake SOL to receive secuSOL and earn ~7% APY from Solana validator staking rewards.
            Protected by our commit-reveal scheme against sandwich attacks.
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex justify-center mb-8 overflow-x-auto">
          <div className="bg-zinc-900/50 p-1 rounded-xl border border-zinc-800/50 inline-flex">
            {[
              { id: "stake" as Tab, label: "Stake", icon: "↑" },
              { id: "unstake" as Tab, label: "Unstake", icon: "↓" },
              { id: "swap" as Tab, label: "Swap", icon: "⇄" },
              { id: "liquidity" as Tab, label: "Liquidity", icon: "◆" },
              { id: "dashboard" as Tab, label: "Dashboard", icon: "◉" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  px-4 sm:px-6 py-3 rounded-lg font-medium text-sm transition-all flex items-center gap-2 whitespace-nowrap
                  ${activeTab === tab.id
                    ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
                  }
                `}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content Card */}
        <div className="max-w-lg mx-auto">
          <div className="bg-zinc-900/50 rounded-2xl border border-zinc-800/50 p-6 sm:p-8 backdrop-blur-sm shadow-xl">
            <div className={activeTab === "stake" ? "" : "hidden"}>
              <StakeForm />
            </div>
            <div className={activeTab === "unstake" ? "" : "hidden"}>
              <UnstakeForm />
            </div>
            <div className={activeTab === "swap" ? "" : "hidden"}>
              <AmmSwap />
            </div>
            <div className={activeTab === "liquidity" ? "" : "hidden"}>
              <LiquidityForm />
            </div>
            <div className={activeTab === "dashboard" ? "" : "hidden"}>
              <Dashboard />
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
          {[
            {
              icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              ),
              title: "MEV Protected",
              description: "Commit-reveal scheme hides your intent from sandwich bots, protecting your transactions.",
            },
            {
              icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              ),
              title: "~7% APY",
              description: "Earn Solana staking rewards from validator delegation. Exchange rate increases over time.",
            },
            {
              icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              ),
              title: "Built-in AMM",
              description: "Trade secuSOL instantly via our constant-product AMM without waiting for unstake cooldown.",
            },
          ].map((feature, index) => (
            <div
              key={index}
              className="bg-zinc-900/30 rounded-xl border border-zinc-800/30 p-6 hover:border-violet-500/30 transition-colors"
            >
              <div className="w-12 h-12 rounded-lg bg-violet-500/10 text-violet-400 flex items-center justify-center mb-4">
                {feature.icon}
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
              <p className="text-zinc-400 text-sm">{feature.description}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50 mt-16 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-zinc-500 text-sm">
              SecureLiquidPool - MEV-Resistant Liquid Staking on Solana
            </p>
            <div className="flex items-center gap-4">
              <a
                href="https://explorer.solana.com/address/BMxQAdqNJE3Zn6iJedc6A6XbsSTmNBQi6UzFdfrNvE21?cluster=devnet"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-violet-400 text-sm transition-colors"
              >
                Program ↗
              </a>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-violet-400 text-sm transition-colors"
              >
                GitHub ↗
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
