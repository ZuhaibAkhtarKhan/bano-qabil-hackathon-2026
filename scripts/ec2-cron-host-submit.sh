#!/usr/bin/env bash
# Headless form fill + submit — no Chrome extension required. Run every 5 minutes on EC2.
set -euo pipefail

ENV_FILE="${1:-$HOME/bano-qabil-hackathon-2026/apps/web/.env.local}"
LOG_DIR="$HOME/cron-logs"
mkdir -p "$LOG_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$(date -Is) missing env file: $ENV_FILE" >> "$LOG_DIR/host-submit.log"
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "$(date -Is) CRON_SECRET not set in $ENV_FILE" >> "$LOG_DIR/host-submit.log"
  exit 1
fi

curl -sf --max-time 280 -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "http://127.0.0.1:3000/api/cron/host-submit-worker" >> "$LOG_DIR/host-submit.log" 2>&1
echo "" >> "$LOG_DIR/host-submit.log"
