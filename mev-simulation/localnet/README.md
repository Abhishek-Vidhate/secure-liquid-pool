# Solana Localnet MEV Simulation

This simulation tests the **commit-reveal protection** mechanism against MEV sandwich attacks on a real Solana localnet.

## Overview

The simulation runs two scenarios side-by-side:
1. **Normal Trading** - Direct AMM swaps (vulnerable to MEV)
2. **Protected Trading** - Commit-reveal swaps (protected from MEV)

## Prerequisites

- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) installed
- [Bun](https://bun.sh/) runtime
- Built programs in `securelp/target/deploy/`

Build the programs first if needed:
```bash
cd ../securelp && anchor build
```

## Quick Start

```bash
# Install dependencies
bun install

# Run simulation with 100 transactions
bun run sim

# Run quick simulation (50 transactions)
bun run sim:quick

# Run full simulation (500 transactions)
bun run sim:full
```

## CLI Options

```bash
bun run src/index.ts run [options]

Options:
  -t, --transactions <n>   Number of transactions (default: 100)
  -a, --attack-prob <n>    Attack probability 0-1 (default: 0.8)
  --min-swap <n>           Minimum swap in SOL (default: 0.1)
  --max-swap <n>           Maximum swap in SOL (default: 5.0)
  --liquidity <n>          Initial pool liquidity in SOL (default: 1000)
  -o, --output <dir>       Output directory (default: output)
  --no-report              Skip HTML report generation
  --keep-validator         Keep validator running after simulation
  --use-existing           Use existing validator if running
```

## Output

Results are saved to `output/`:
- `simulation_*.json` - Raw simulation data
- `summary_*.txt` - Text summary
- `report.html` - Interactive HTML report with charts

## How It Works

### Normal Trading (Vulnerable)
```
[Trader] → amm::swap(amount: 5 SOL, min_out: 4.8, A→B)
           ↓ (visible in mempool)
[Attacker] sees: amount=5, direction=A→B, slippage=4%
           ↓
[Attacker] executes sandwich: front-run → victim → back-run
           ↓
[Victim] receives less than expected due to sandwich
```

### Protected Trading (Commit-Reveal)
```
[Trader] → securelp::commit(hash: 0x7a3b9c..., amount: 5 SOL)
           ↓ (only hash visible in mempool)
[Attacker] sees: hash (useless), approximate amount
           ↓
[Attacker] CANNOT calculate sandwich - params are hidden
           ↓
[Trader] → securelp::reveal(details: {amount, minOut, nonce})
           ↓
[Trader] receives expected output - no sandwich possible
```

## Architecture

```
src/
├── index.ts                  # CLI entry point
├── config.ts                 # Configuration
├── types.ts                  # TypeScript types
├── setup/
│   ├── validator.ts          # Start/stop solana-test-validator
│   ├── deploy.ts             # Deploy pools and initialize
│   └── accounts.ts           # Create trader/attacker accounts
├── bots/
│   ├── normal-trader.ts      # Direct AMM swap (vulnerable)
│   ├── protected-trader.ts   # Commit-reveal swap (protected)
│   └── sandwich-attacker.ts  # MEV sandwich bot
├── simulation/
│   ├── orchestrator.ts       # Main simulation loop
│   └── mempool-monitor.ts    # Simulated mempool visibility
└── analytics/
    ├── collector.ts          # Results collection
    └── report.ts             # HTML report generation
```

## Expected Results

| Metric | Normal Trading | Protected Trading |
|--------|---------------|-------------------|
| Attack Success Rate | ~40-60% | 0% |
| Avg Loss per Trade | ~0.5-2% | 0% |
| Total MEV Extracted | ~5 SOL per 1000 trades | 0 SOL |

This proves the on-chain commit-reveal mechanism works as designed.

