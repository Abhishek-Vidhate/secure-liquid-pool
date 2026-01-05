# 🛡️ SecureLiquidPool Protocol

# Pitch (with Project Demo) video : [youtube video link here](https://youtu.be/xxWfVNC1VfY)

> **The First "Sandwich-Proof" Liquid Staking Protocol & AMM on Solana.**
> Use **Commit-Reveal** technology to protect your trades and stakes from MEV bots while earning yield.

![SecureLiquidPool Hero](frontend/public/sandwich-attack-bg.png)

---



---

## 🚨 The Problem: MEV Sandwich Attacks

**Maximal Extractable Value (MEV)** is a hidden tax on crypto users. "Sandwich Bots" monitor the mempool for your pending transactions. When they see you buying, they:
1.  **Front-run**: Buy before you to push the price up.
2.  **Victim Trades**: You buy at the inflated price.
3.  **Back-run**: They sell immediately to profit from your loss.

According to **[Helius Reports](https://www.helius.dev/blog/solana-mev-report)**:
-   A single sandwich bot (Vpe...program) profited **~$13.43 Million** in just 30 days.
-   Users on Solana lose an estimated **$300M - $500M annually** to these predatory bots.

---

## ✅ The Solution: SecureLiquidPool

We solve this by **removing the target**.

SecureLiquidPool implements a **Commit-Reveal** mechanism. Instead of broadcasting your trade details (amount, direction) to the public mempool where bots can see them, you broadcast a **hashed "Commitment"**.

-   **Phase 1 (Commit)**: You hide your intent behind a cryptographic hash. Bots see *something* happened, but they don't know *what*, so they cannot sandwich you.
-   **Phase 2 (Reveal)**: After a safe delay, you reveal and execute atomically. The trade happens instantly, leaving no gap for bots to insert themselves.

> **Simulation Proof**: Check out our [Localnet Simulation](./mev-simulation/README.md) to see a live "Sandwich Bot" fail to attack our protocol while successfully draining a standard AMM.

---

## 💰 How You/User Earn

SecureLiquidPool combines the best of Liquid Staking (LSP) and Decentralized Exchanges (AMMs).

### 1. Liquid Staking (~7% APY)
Deposit `SOL` to mint **`secuSOL`**.
-   **Staking Rewards**: Your `secuSOL` value appreciates over time as the pool accrues validator rewards (approx. 7% APY detailed by Jito/Solana metrics).
-   **Liquid**: Unlike native staking, `secuSOL` is transferrable and usable in DeFi.

### 2. MEV-Free Trading
Swap between `SOL` and `secuSOL` using our custom **zero-slippage-exploitation AMM**.
-   **Fair Pricing**: Since bots can't front-run you, you get the price you see.
-   **Lower Costs**: Stop losing 1-3% slippage to invisible predators.

### 3. Liquidity Provision
Become a Liquidity Provider (LP) by depositing `SOL` + `secuSOL`.
-   **Fees**: Earn a share of every swap that happens in the pool.
-   **LP Tokens**: Receive **`secuLPT`** to track your share of the pool.

---

## 📂 Project Structure

This repository contains the complete ecosystem:

| Component | Directory | Description |
| :--- | :--- | :--- |
| **Frontend** | [`/frontend`](./frontend) | Next.js 16 + Bun + Three.js web application. |
| **Smart Contracts** | [`/securelp`](./securelp) | Anchor workspace containing the 3 core programs (`securelp`, `amm`, `stake_pool`). |
| **MEV Simulation** | [`/mev-simulation`](./mev-simulation) | Verification framework to prove the protection works against live bots. |

---

## 🚀 Getting Started

### Prerequisites
-   **Bun** (Runtime & Package Manager), or can use any JS runtime or package manager
-   **Solana Tool Suite**
-   **Anchor**

### Getting Started

You can run the project in two ways:

#### Option 1: Frontend Only (Connecting to Devnet)
The easiest way to test the UI. Connects to our pre-deployed contracts on Solana Devnet.

1.  **Clone the repo**
2.  **Run Frontend**:
    ```bash
    cd frontend
    bun install && bun dev
    ```

#### Option 2: Complete Local Development Setup
This guide walks you through running the full stack locally. You will need **2 concurrent terminals**.

#### Terminal 1: The Blockchain
Run the local Solana validator. This simulates the Solana blockchain on your machine.
**Keep this terminal running at all times.**

```bash
solana-test-validator --reset
```
*`--reset` is used to ensure you start with a clean state, removing any old data.*

#### Terminal 2: Deployment & Frontend
Use this terminal for all other commands.

**Step 1: Build & Deploy Smart Contracts**
We need to compile the Rust programs and deploy them to your local validator.

```bash
cd securelp

# 1. Install dependencies
bun install

# 2. Build to generate new keypairs
# (This is required because keypairs are gitignored for security)
anchor build

# 3. Sync your new keys to the configuration
# (This updates Anchor.toml and lib.rs with your new local Program IDs)
anchor keys sync

# 4. Build again and Deploy
# (We build again to embed the synced keys into the binary)
anchor build && anchor deploy
```

**Step 2: Initialize Programs**
The programs are deployed but empty. We need to initialize the Stake Pool and AMM state.
Our scripts automatically detect existing Program IDs from `Anchor.toml`.

Initialize Stake Pool (creates the pool config and slpSOL mint):
```bash
ANCHOR_PROVIDER_URL="http://127.0.0.1:8899" ANCHOR_WALLET="$HOME/.config/solana/id.json" bun run scripts/initialize.ts
```

Initialize AMM & Liquidity (creates the AMM pool, LP mint, and adds initial liquidity):
```bash
ANCHOR_PROVIDER_URL="http://127.0.0.1:8899" ANCHOR_WALLET="$HOME/.config/solana/id.json" bun run scripts/init-amm.ts
```

> **⚠️ IMPORTANT**: Look at the output of these scripts! You will need to copy the **Mint Addresses** notated in the logs for the next step.

**Step 3: Configure Frontend**
Now we connect the web UI to your local programs.

1.  **Copy Interface Definitions (IDLs)**:
    This lets the frontend know the structure of your smart contracts.
    ```bash
    cp target/idl/*.json ../frontend/src/idl/
    cp target/types/*.ts ../frontend/src/types/
    ```

2.  **Update Environment Variables**:
    Go to the `frontend/` directory and create `.env.local`.
    ```bash
    cd ../frontend
    touch .env.local
    ```
    
    Update `.env.local` with:
    - **RPC URL**: `http://127.0.0.1:8899`
    - **Program IDs**: Copy from `securelp/Anchor.toml` under the `[programs.localnet]` section.
    - **Mints & Pools**: Paste the values you copied from the **Step 2 script output**.

    *Example `.env.local`:*
    ```env
    NEXT_PUBLIC_RPC_URL="http://127.0.0.1:8899"
    NEXT_PUBLIC_SECURELP_ID="..."
    NEXT_PUBLIC_STAKE_POOL_ID="..."
    NEXT_PUBLIC_AMM_ID="..."
    
    NEXT_PUBLIC_SLP_SOL_MINT="..."
    NEXT_PUBLIC_AMM_POOL="..."
    NEXT_PUBLIC_LP_MINT="..."
    ```

3.  **Run Frontend**:
    ```bash
    bun install
    bun dev
    ```
    Open [http://localhost:3000](http://localhost:3000) and test the Swap!
