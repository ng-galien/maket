#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
RULES="${2:-.code-moniker.toml}"
BIN="${CODE_MONIKER_BIN:-}"

if [[ -z "$BIN" ]]; then
  if command -v code-moniker >/dev/null 2>&1; then
    BIN="$(command -v code-moniker)"
  elif [[ -x "$HOME/.cargo/bin/code-moniker" ]]; then
    BIN="$HOME/.cargo/bin/code-moniker"
  else
    echo "code-moniker binary not found. Set CODE_MONIKER_BIN=/path/to/code-moniker." >&2
    exit 127
  fi
fi

exec "$BIN" check "$ROOT" \
  --rules "$RULES" \
  --default-rules off \
  --report \
  --max-violations "${CODE_MONIKER_MAX_VIOLATIONS:-80}"
