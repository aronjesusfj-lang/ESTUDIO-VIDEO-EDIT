#!/bin/zsh
set -e

PROJECT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$PROJECT_DIR"

if [ ! -d node_modules ]; then
  npm install
fi

export SUBVID_LOCAL_DEV=1
(
  for _ in {1..60}; do
    if curl -fsS http://127.0.0.1:4321/ >/dev/null 2>&1; then
      open http://127.0.0.1:4321/
      exit 0
    fi
    sleep 1
  done
) &

npm run dev -- --host 127.0.0.1
