#!/usr/bin/env bash
# Call from EC2 crontab every 15 minutes. Requires CRON_SECRET in apps/web/.env.local.
set -euo pipefail

ENV_FILE="${1:-$HOME/bano-qabil-hackathon-2026/apps/web/.env.local}"
LOG_DIR="$HOME/cron-logs"
mkdir -p "$LOG_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$(date -Is) missing env file: $ENV_FILE" >> "$LOG_DIR/sweep.log"
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "$(date -Is) CRON_SECRET not set in $ENV_FILE" >> "$LOG_DIR/sweep.log"
  exit 1
fi

curl -sf --max-time 240 -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "http://127.0.0.1:3000/api/cron/sweep" >> "$LOG_DIR/sweep.log" 2>&1
echo "" >> "$LOG_DIR/sweep.log"
