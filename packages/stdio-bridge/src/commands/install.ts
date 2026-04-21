/**
 * `maket install <claude|codex>` — register Maket as an MCP server in a client.
 *
 * Default behaviour is print-only. Pass `--apply` to actually write/run.
 *
 * Claude Code: prefers the `claude mcp add` CLI when available, falls back to
 * editing `~/.claude.json` (user scope) or `<cwd>/.mcp.json` (project scope).
 *
 * Codex (OpenAI Codex CLI): edits `~/.codex/config.toml` and adds/updates a
 * `[mcp_servers.maket]` section.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PKG = "@ng-galien/maket";
const CMD = "npx";
const ARGS = ["-y", PKG];

interface Opts {
	apply: boolean;
	scope: "user" | "project";
}

function parseOpts(args: string[]): Opts {
	const apply = args.includes("--apply");
	const scopeArg = args.find((a) => a.startsWith("--scope="));
	const scope = scopeArg?.split("=")[1] === "project" ? "project" : "user";
	return { apply, scope };
}

function hasBin(bin: string): boolean {
	const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], {
		stdio: "ignore",
	});
	return r.status === 0;
}

function backup(path: string): void {
	if (!existsSync(path)) return;
	const dest = `${path}.bak.${Date.now()}`;
	copyFileSync(path, dest);
	// The original may have been world-readable, but the backup carries auth
	// tokens (~/.claude.json includes them) — pin it owner-only regardless.
	try {
		chmodSync(dest, 0o600);
	} catch {
		/* best-effort — Windows / unusual FS */
	}
	process.stdout.write(`maket: backed up ${path} → ${dest}\n`);
}

/**
 * Refuse to operate on a symlink. Without this, a hostile local actor could
 * pre-create `~/.claude.json` as a symlink to `/etc/passwd` (or any file the
 * current user can write) and our `writeFileSync` would follow it.
 */
function refuseSymlink(path: string): boolean {
	if (!existsSync(path)) return false;
	try {
		if (lstatSync(path).isSymbolicLink()) {
			process.stderr.write(
				`maket: refusing to write — ${path} is a symlink. Resolve it manually first.\n`,
			);
			process.exitCode = 1;
			return true;
		}
	} catch {
		/* lstat may fail on weird FS — fall through */
	}
	return false;
}

// ── Claude Code ───────────────────────────────────────────────────────────────

function installClaude(opts: Opts): void {
	const cliCmd = [
		"claude",
		"mcp",
		"add",
		"maket",
		"--scope",
		opts.scope,
		"--",
		CMD,
		...ARGS,
	];
	const cliLine = cliCmd.join(" ");

	if (!opts.apply) {
		process.stdout.write(
			"maket: Claude Code MCP install (preview)\n\n" +
				`  ${cliLine}\n\n` +
				"Or, if the `claude` CLI is not installed, add this entry manually to\n" +
				`  ${opts.scope === "user" ? "~/.claude.json" : "<your-project>/.mcp.json"}:\n\n` +
				`${claudeJsonSnippet()}\n` +
				"Re-run with --apply to write the config.\n",
		);
		return;
	}

	if (hasBin("claude")) {
		process.stdout.write(`maket: running \`${cliLine}\`\n`);
		try {
			execFileSync("claude", cliCmd.slice(1), { stdio: "inherit" });
			process.stdout.write("maket: Claude Code is configured.\n");
			return;
		} catch (e) {
			process.stderr.write(
				`maket: \`claude mcp add\` failed (${(e as Error).message}). Falling back to file edit.\n`,
			);
		}
	}

	const target =
		opts.scope === "user"
			? join(homedir(), ".claude.json")
			: join(process.cwd(), ".mcp.json");
	writeClaudeConfig(target, opts.scope);
}

function claudeJsonSnippet(): string {
	return JSON.stringify(
		{ mcpServers: { maket: { command: CMD, args: ARGS } } },
		null,
		2,
	);
}

function writeClaudeConfig(path: string, scope: "user" | "project"): void {
	if (refuseSymlink(path)) return;
	let json: Record<string, unknown> = {};
	if (existsSync(path)) {
		try {
			json = JSON.parse(readFileSync(path, "utf-8"));
		} catch {
			process.stderr.write(
				`maket: ${path} is not valid JSON — refusing to overwrite.\n`,
			);
			process.exitCode = 1;
			return;
		}
		backup(path);
	} else {
		mkdirSync(dirname(path), { recursive: true });
	}

	const servers = ((json.mcpServers as Record<string, unknown>) ??
		{}) as Record<string, unknown>;
	servers.maket = { command: CMD, args: ARGS };
	json.mcpServers = servers;
	writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`, {
		encoding: "utf-8",
		mode: 0o600,
	});
	process.stdout.write(`maket: wrote ${scope}-scope config → ${path}\n`);
}

// ── Codex CLI ─────────────────────────────────────────────────────────────────

function codexTomlSnippet(): string {
	return [
		"[mcp_servers.maket]",
		`command = "${CMD}"`,
		`args = [${ARGS.map((a) => `"${a}"`).join(", ")}]`,
	].join("\n");
}

function installCodex(opts: Opts): void {
	const target = join(homedir(), ".codex", "config.toml");

	if (!opts.apply) {
		process.stdout.write(
			"maket: Codex CLI MCP install (preview)\n\n" +
				`Add the following to ${target}:\n\n` +
				`${codexTomlSnippet()}\n\n` +
				"Re-run with --apply to write the config (an existing maket section will be replaced).\n",
		);
		return;
	}

	if (refuseSymlink(target)) return;
	mkdirSync(dirname(target), { recursive: true });
	const existing = existsSync(target) ? readFileSync(target, "utf-8") : "";
	if (existing) backup(target);

	const stripped = stripMaketSection(existing);
	const sep =
		stripped.length === 0 || stripped.endsWith("\n\n")
			? ""
			: stripped.endsWith("\n")
				? "\n"
				: "\n\n";
	const next = `${stripped}${sep}${codexTomlSnippet()}\n`;
	writeFileSync(target, next, { encoding: "utf-8", mode: 0o600 });
	process.stdout.write(`maket: wrote Codex MCP config → ${target}\n`);
}

/**
 * Remove an existing `[mcp_servers.maket]` block from a TOML string. Conservative
 * line-based parsing — we own the section we wrote, so this is safe enough.
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

// ── Entrypoint ────────────────────────────────────────────────────────────────

export function runInstall(args: string[]): void {
	const client = args[0];
	const opts = parseOpts(args.slice(1));
	if (client === "claude") {
		installClaude(opts);
		return;
	}
	if (client === "codex") {
		installCodex(opts);
		return;
	}
	process.stderr.write(
		"maket: usage — maket install <claude|codex> [--apply] [--scope=user|project]\n",
	);
	process.exitCode = 1;
}
