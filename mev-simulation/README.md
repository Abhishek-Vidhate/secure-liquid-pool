# MEV Sandwich Attack Simulation Framework

A Rust-based framework for simulating MEV (Maximal Extractable Value) sandwich attacks on AMM swaps, demonstrating the effectiveness of commit-reveal protection.

## Overview

This framework simulates:
1. **Normal Trading (Vulnerable)** - Direct AMM swaps that can be sandwiched
2. **Protected Trading (Commit-Reveal)** - Trades using commit-reveal scheme

By running both scenarios with identical parameters, we can measure exactly how much value is protected by the commit-reveal mechanism.

## Architecture

```
mev-simulation/
├── src/
│   ├── main.rs              # CLI entry point
│   ├── lib.rs               # Library exports
│   ├── config.rs            # Simulation configuration
│   ├── bots/
│   │   ├── sandwich_attacker.rs  # MEV sandwich bot
│   │   ├── normal_trader.rs      # Vulnerable trader
│   │   └── protected_trader.rs   # Protected trader (commit-reveal)
│   ├── simulation/
│   │   ├── orchestrator.rs   # Main simulation controller
│   │   └── pool_state.rs     # AMM pool state tracking
│   ├── analytics/
│   │   ├── logger.rs         # JSON logging
│   │   ├── metrics.rs        # Statistics calculation
│   │   └── report.rs         # HTML report generation
│   └── utils/
│       ├── amm_math.rs       # Constant-product AMM math
│       ├── wallet.rs         # Keypair management
│       └── hash.rs           # SHA256 for commit-reveal
├── scripts/
│   └── setup-localnet.sh     # Start local validator
└── output/
    ├── logs/                 # JSON simulation results
    └── reports/              # HTML reports with charts
```

## Building

```bash
cd mev-simulation
cargo build --release
```

## Usage

### Run Full Simulation

```bash
# Default: 1000 transactions, 80% attack probability
./target/release/mev-sim run

# Custom parameters
./target/release/mev-sim run \
  --transactions 1000 \
  --attack-probability 0.8 \
  --min-swap 0.1 \
  --max-swap 5.0 \
  --pool-liquidity 1000.0
```

### Quick Test

```bash
# Run 100 transactions quickly
./target/release/mev-sim quick
```

### Generate Report from Existing Results

```bash
./target/release/mev-sim report --input output/logs/simulation_*.json
```

### View Help

```bash
./target/release/mev-sim --help
./target/release/mev-sim run --help
```

## How It Works

### Sandwich Attack Mechanics

1. **Attacker monitors** pending swap transactions
2. **Front-run**: Attacker swaps in the same direction before victim (pushes price against victim)
3. **Victim transaction executes** at worse price
4. **Back-run**: Attacker swaps in opposite direction (captures profit)

### Commit-Reveal Protection

1. **Commit Phase**: User submits hash of trade details (amount, direction, nonce)
2. **Wait**: Minimum 1 slot delay
3. **Reveal Phase**: User reveals details and executes atomically

The attacker cannot sandwich because:
- During commit: Trade details are hidden (only hash visible)
- During reveal: Execution is atomic, no room to insert transactions

### Simulation Flow

For each transaction:
1. Generate random swap parameters
2. **Scenario A (Normal)**: Execute with potential sandwich attack
3. **Scenario B (Protected)**: Execute with commit-reveal (same parameters)
4. Compare outcomes

## Output

### Terminal Summary

```
╔══════════════════════════════════════════════════════════════════╗
║            MEV SIMULATION RESULTS                                ║
╠══════════════════════════════════════════════════════════════════╣
║  NORMAL TRADING (Vulnerable to MEV)                              ║
║  Attack Attempts:       800                                      ║
║  Successful Attacks:    720                                      ║
║  Total MEV Extracted:   12.847 SOL                               ║
║  Total Victim Losses:   15.234 SOL                               ║
║                                                                  ║
║  PROTECTED TRADING (Commit-Reveal)                               ║
║  Attacks Possible:      0                                        ║
║  MEV Extracted:         0 SOL                                    ║
║  ★ TOTAL SAVINGS:       15.234 SOL (100% protection)             ║
╚══════════════════════════════════════════════════════════════════╝
```

### HTML Report

- Interactive charts with Chart.js
- Cumulative MEV extraction over time
- Loss distribution histogram
- Side-by-side comparison

### JSON Logs

Full detailed data for further analysis:
- Every trade result
- Every sandwich attack result
- Pool state history

## Key Metrics

| Metric | Description |
|--------|-------------|
| Total MEV Extracted | Attacker's profit from sandwiches |
| Total Victim Losses | What users lost due to attacks |
| Protected Savings | 100% of losses saved with commit-reveal |
| Attack Success Rate | % of attempted sandwiches that were profitable |
| Average Loss per Attack | Mean victim loss per successful sandwich |

## Dependencies

- `solana-sdk` / `solana-client` - Solana blockchain interaction
- `anchor-client` / `anchor-lang` - Anchor program framework
- `tokio` - Async runtime
- `clap` - CLI argument parsing
- `serde` / `serde_json` - Serialization
- `sha2` - SHA256 hashing
- `minijinja` - HTML templating
- `tracing` - Structured logging
- `chrono` - Timestamps

## License

MIT

