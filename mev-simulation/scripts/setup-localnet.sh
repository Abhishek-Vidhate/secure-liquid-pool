#!/bin/bash

# MEV Simulation - Localnet Setup Script
# This script starts a local Solana validator with the required programs pre-loaded.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SECURELP_DIR="$PROJECT_ROOT/../securelp"

echo "=============================================="
echo "  MEV Simulation - Localnet Setup"
echo "=============================================="

# Check if programs are built
if [ ! -f "$SECURELP_DIR/target/deploy/stake_pool.so" ]; then
    echo "Error: stake_pool.so not found. Please build the programs first:"
    echo "  cd $SECURELP_DIR && anchor build"
    exit 1
fi

if [ ! -f "$SECURELP_DIR/target/deploy/amm.so" ]; then
    echo "Error: amm.so not found. Please build the programs first."
    exit 1
fi

if [ ! -f "$SECURELP_DIR/target/deploy/securelp.so" ]; then
    echo "Error: securelp.so not found. Please build the programs first."
    exit 1
fi

# Program IDs
STAKE_POOL_ID="EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7"
AMM_ID="AcaXW2nDrvkpmuZnuiARDRJzmmfT1AZwLm4SMeYwnXKS"
SECURELP_ID="BMxQAdqNJE3Zn6iJedc6A6XbsSTmNBQi6UzFdfrNvE21"

# Token Metadata Program ID
TOKEN_METADATA_ID="metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"

echo ""
echo "Program IDs:"
echo "  Stake Pool: $STAKE_POOL_ID"
echo "  AMM:        $AMM_ID"
echo "  SecureLP:   $SECURELP_ID"
echo ""

# Kill any existing validator
echo "Stopping any existing validator..."
pkill -f solana-test-validator 2>/dev/null || true
sleep 2

# Create output directory for validator
mkdir -p "$PROJECT_ROOT/output/validator"

echo "Starting solana-test-validator..."
echo ""

# Start the validator with programs pre-loaded
solana-test-validator \
    --reset \
    --bpf-program $STAKE_POOL_ID "$SECURELP_DIR/target/deploy/stake_pool.so" \
    --bpf-program $AMM_ID "$SECURELP_DIR/target/deploy/amm.so" \
    --bpf-program $SECURELP_ID "$SECURELP_DIR/target/deploy/securelp.so" \
    --clone $TOKEN_METADATA_ID --url mainnet-beta \
    --ledger "$PROJECT_ROOT/output/validator/ledger" \
    --log "$PROJECT_ROOT/output/validator/validator.log" \
    &

VALIDATOR_PID=$!
echo "Validator started with PID: $VALIDATOR_PID"

# Wait for validator to start
echo "Waiting for validator to be ready..."
sleep 5

# Check if validator is running
if ! kill -0 $VALIDATOR_PID 2>/dev/null; then
    echo "Error: Validator failed to start. Check logs at:"
    echo "  $PROJECT_ROOT/output/validator/validator.log"
    exit 1
fi

# Wait for RPC to be available
for i in {1..30}; do
    if curl -s http://127.0.0.1:8899 -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q "ok"; then
        echo "Validator is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "Error: Validator did not become ready in time."
        exit 1
    fi
    echo "  Waiting... ($i/30)"
    sleep 1
done

echo ""
echo "=============================================="
echo "  Localnet is running!"
echo "=============================================="
echo ""
echo "RPC URL: http://127.0.0.1:8899"
echo "WebSocket: ws://127.0.0.1:8900"
echo ""
echo "To stop the validator:"
echo "  kill $VALIDATOR_PID"
echo ""
echo "To run the simulation:"
echo "  cargo run --release -- run --transactions 1000"
echo ""

# Keep script running to show logs
echo "Tailing validator logs (Ctrl+C to stop)..."
tail -f "$PROJECT_ROOT/output/validator/validator.log"

