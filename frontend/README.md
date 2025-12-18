# SecureLiquidPool Frontend

The modern, responsive web interface for the SecureLiquidPool protocol. Built with the latest **Next.js 16**, **Tailwind CSS v4**, and **Three.js** for immersive visuals.

## 🛠️ Tech Stack & Prerequisites

- **Next.js 16**: Using the latest React Server Components and App Router.
- **Bun**: This project uses [Bun](https://bun.sh) as the package manager and runtime.
- **Tailwind CSS v4**: For high-performance utility-first styling.
- **Three.js (@react-three/fiber)**: For the 3D "Light Pillar" background.

## 🚀 Getting Started

### 1. Install Dependencies

```bash
bun install
```

### 2. Copy IDL and Types

To ensure the frontend communicates correctly with the Solana program, you must copy the latest IDL and TypeScript definitions from your anchor workspace.

**Run these commands from the `frontend/` directory:**

```bash
# Copy IDL (Interface Definition Language)
cp ../securelp/target/idl/securelp.json ./src/idl/

# Copy TypeScript Types
cp ../securelp/target/types/securelp.ts ./src/types/
```

> **Note**: If you make changes to the Solana program, you must run `anchor build` in the `securelp` directory and re-run these copy commands to keep the frontend in sync.

### 3. Run Development Server

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## 🎨 Key Features & Code Locations

- **Main Dashboard**: [`app/page.tsx`](./app/page.tsx) - Handles Staking, Unstaking, and Liquidity management.
- **Info & Education**: [`app/info/page.tsx`](./app/info/page.tsx) - The educational page explaining Sandwich Attacks with visual aids.
- **Commit-Reveal Logic**: [`src/hooks/useCommitReveal.ts`](./src/hooks/useCommitReveal.ts) - The React hook that manages the 2-step transaction process to protect users.
- **3D Background**: [`src/components/LightPillar.tsx`](./src/components/LightPillar.tsx) - The Three.js component rendering the ethereal light beam.

## 🧪 Testing

This frontend connects to `localnet` by default (defined in `.env.local` or defaults to `http://127.0.0.1:8899`). 

Ensure your local validator is running:
```bash
# In a separate terminal, inside securelp directory
anchor localnet
```
