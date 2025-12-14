#!/bin/bash

# MEV Localnet Simulation - Quick Run Script
# Usage: ./scripts/run.sh [transactions] [attack-probability]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Default values
TRANSACTIONS=${1:-100}
ATTACK_PROB=${2:-0.8}

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║     MEV Localnet Simulation - Quick Start                        ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "Configuration:"
echo "  Transactions:      $TRANSACTIONS"
echo "  Attack Probability: $ATTACK_PROB"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    bun install
fi

# Run simulation
bun run src/index.ts run \
    --transactions "$TRANSACTIONS" \
    --attack-prob "$ATTACK_PROB" \
    --output output

echo ""
echo "Done! Check output/report.html for the interactive report."

