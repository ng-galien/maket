/**
 * Codex CLI's `~/.codex/config.toml` write/strip helpers, shared between
 * `install` and `uninstall` so they agree on the exact block shape and the
 * stripping rules.
 */

import { resolveMaketRuntime } from "./_runtime-command.ts";

export const PKG = "@ng-galien/maket";

export function codexTomlSnippet(): string {
	const runtime = resolveMaketRuntime();
	return [
		"[mcp_servers.maket]",
		`command = ${JSON.stringify(runtime.command)}`,
		`args = [${runtime.args.map((arg) => JSON.stringify(arg)).join(", ")}]`,
	].join("\n");
}

/**
 * Remove an existing `[mcp_servers.maket]` block from a TOML string. We own
 * the section we wrote, so conservative line-based parsing is safe enough —
 * a full TOML parser would be overkill for a single header match.
 */
export function stripMaketSection(toml: string): string {
	const lines = toml.split("\n");
	const out: string[] = [];
	let inSection = false;
	for (const line of lines) {
		const isHeader = /^\s*\[/.test(line);
		if (isHeader) {
			inSection = /^\s*\[mcp_servers\.maket\]\s*$/.test(line);
			if (inSection) continue;
		}
		if (!inSection) out.push(line);
	}
	return out.join("\n");
}
