#!/usr/bin/env bash
# Production build for small EC2 instances (2GB RAM + swap recommended).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
export LOW_MEM_BUILD="${LOW_MEM_BUILD:-1}"

echo "NODE_OPTIONS=$NODE_OPTIONS LOW_MEM_BUILD=$LOW_MEM_BUILD"
npm run build -w @1apply/web
