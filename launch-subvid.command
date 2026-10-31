#!/bin/zsh
set -e

PROJECT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$PROJECT_DIR"

URL="http://127.0.0.1:4321/"

# --- Node runtime guard -----------------------------------------------------
# Node 26 (the vite-plus default) needs a newer libc++ than macOS 12 ships and
# dies with "__libcpp_verbose_abort" before running anything. Fall back to the
# first Node that actually starts.
if ! node -v >/dev/null 2>&1; then
  for candidate in "$HOME/.n/bin" /usr/local/bin /opt/homebrew/bin; do
    if [ -x "$candidate/node" ] && "$candidate/node" -v >/dev/null 2>&1; then
      export PATH="$candidate:$PATH"
      break
    fi
  done
fi

if ! node -v >/dev/null 2>&1; then
  echo "❌ No hay un Node.js compatible. Instala Node 22 o 24 y vuelve a intentar."
  exit 1
fi

echo "▶ Node $(node -v)"
echo "▶ Arrancando SubVid en $URL"

if [ ! -d node_modules ]; then
  echo "▶ Instalando dependencias (puede tardar)..."
  npm install
fi

npm run dev -- --host 127.0.0.1 &
DEV_PID=$!

# Astro 7 daemonizes itself, so the dev command can return before the server is
# listening. Wait for it here, then open the browser — never rely on a detached
# background loop, which dies with this script.
READY=0
for _ in {1..90}; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -eq 1 ]; then
  echo ""
  echo "✅ SubVid listo: $URL"
  open "$URL"
else
  echo "⚠️  El servidor no respondió en 90s. Revisa los mensajes de arriba."
fi

wait "$DEV_PID" 2>/dev/null || true
