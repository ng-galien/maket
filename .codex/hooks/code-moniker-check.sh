#!/usr/bin/env sh
set -eu

root="${CODEX_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"
cd "$root"

input_file=$(mktemp "${TMPDIR:-/tmp}/code-moniker-hook.XXXXXX")
trap 'rm -f "$input_file"' EXIT HUP INT TERM
cat > "$input_file"
files=$("$HOME/.cargo/bin/code-moniker" harness tool-files codex "$input_file" 2>/dev/null) || {
	printf '%s\n' 'code-moniker hook could not inspect tool input' >&2
	exit 2
}

set -- '.'
while IFS= read -r file; do
	[ -n "$file" ] || continue
	set -- "$@" --file "$file"
done <<CODE_MONIKER_FILES
$files
CODE_MONIKER_FILES

if [ "$#" -eq 1 ]; then
	exit 0
fi

exec "$HOME/.cargo/bin/code-moniker" check --rules '.code-moniker.toml' --format codex-hook --max-violations 10 "$@"
