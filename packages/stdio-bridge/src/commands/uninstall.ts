/**
 * `maket uninstall <claude|codex|gemini>` — symmetric inverse of `install`.
 * Print-only by default, `--apply` to execute.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hasBin } from "./_bin.ts";
import { stripMaketSection } from "./_codex-toml.ts";
import { backup, refuseSymlink } from "./_fs-safety.ts";
import type { ClaudeScope, InstallClient } from "./install.ts";

export interface UninstallOpts {
	client: InstallClient;
	apply: boolean;
	scope: ClaudeScope;
}

function uninstallClaude(opts: UninstallOpts): void {
	const cliCmd = ["claude", "mcp", "remove", "maket", "--scope", opts.scope];
	const cliLine = cliCmd.join(" ");
	const target =
		opts.scope === "user"
			? join(homedir(), ".claude.json")
			: join(process.cwd(), ".mcp.json");

	if (!opts.apply) {
		process.stdout.write(
			"maket: Claude Code MCP uninstall (preview)\n\n" +
				`  ${cliLine}\n\n` +
				`Or, if the \`claude\` CLI is not installed, remove the "maket" entry from\n` +
				`  ${target}\n\n` +
				"Re-run with --apply to execute.\n",
		);
		return;
	}

	if (hasBin("claude")) {
		process.stdout.write(`maket: running \`${cliLine}\`\n`);
		try {
			execFileSync("claude", cliCmd.slice(1), { stdio: "inherit" });
			process.stdout.write("maket: Claude Code entry removed.\n");
			return;
		} catch (e) {
			process.stderr.write(
				`maket: \`claude mcp remove\` failed (${(e as Error).message}). Falling back to file edit.\n`,
			);
		}
	}

	removeClaudeEntry(target, opts.scope);
}

function removeClaudeEntry(path: string, scope: ClaudeScope): void {
	if (!existsSync(path)) {
		process.stdout.write(
			`maket: ${path} does not exist — nothing to remove.\n`,
		);
		return;
	}
	if (refuseSymlink(path)) return;

	let json: Record<string, unknown>;
	try {
		json = JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		process.stderr.write(
			`maket: ${path} is not valid JSON — refusing to edit.\n`,
		);
		process.exitCode = 1;
		return;
	}

	const rawServers = json.mcpServers;
	const servers =
		rawServers !== null &&
		typeof rawServers === "object" &&
		!Array.isArray(rawServers)
			? (rawServers as Record<string, unknown>)
			: undefined;
	if (!servers || !("maket" in servers)) {
		process.stdout.write(`maket: no "maket" entry found in ${path}.\n`);
		return;
	}

	backup(path);
	delete servers.maket;
	if (Object.keys(servers).length === 0) delete json.mcpServers;

	writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`, {
		encoding: "utf-8",
		mode: 0o600,
	});
	process.stdout.write(
		`maket: removed maket from ${scope}-scope config → ${path}\n`,
	);
}

function uninstallCodex(opts: UninstallOpts): void {
	const target = join(homedir(), ".codex", "config.toml");

	if (!opts.apply) {
		process.stdout.write(
			"maket: Codex CLI MCP uninstall (preview)\n\n" +
				`Remove the [mcp_servers.maket] block from ${target}.\n\n` +
				"Re-run with --apply to execute.\n",
		);
		return;
	}

	if (!existsSync(target)) {
		process.stdout.write(
			`maket: ${target} does not exist — nothing to remove.\n`,
		);
		return;
	}
	if (refuseSymlink(target)) return;

	const existing = readFileSync(target, "utf-8");
	const stripped = stripMaketSection(existing);
	if (stripped === existing) {
		process.stdout.write(
			`maket: no [mcp_servers.maket] section found in ${target}.\n`,
		);
		return;
	}

	backup(target);
	const normalized = `${stripped.replace(/\n{3,}$/, "\n\n").replace(/\n+$/, "")}\n`;
	writeFileSync(target, normalized, { encoding: "utf-8", mode: 0o600 });
	process.stdout.write(`maket: removed maket section from ${target}\n`);
}

function uninstallGemini(opts: UninstallOpts): void {
	const target = join(homedir(), ".gemini", "settings.json");

	if (!opts.apply) {
		process.stdout.write(
			"maket: Gemini CLI MCP uninstall (preview)\n\n" +
				`Remove the "maket" entry from ${target}.\n\n` +
				"Re-run with --apply to execute.\n",
		);
		return;
	}

	removeGeminiEntry(target);
}

function removeGeminiEntry(path: string): void {
	if (!existsSync(path)) {
		process.stdout.write(
			`maket: ${path} does not exist — nothing to remove.\n`,
		);
		return;
	}
	if (refuseSymlink(path)) return;

	let json: Record<string, unknown>;
	try {
		json = JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		process.stderr.write(
			`maket: ${path} is not valid JSON — refusing to edit.\n`,
		);
		process.exitCode = 1;
		return;
	}

	const servers = geminiServers(json);
	if (!servers || !("maket" in servers)) {
		process.stdout.write(`maket: no "maket" entry found in ${path}.\n`);
		return;
	}

	backup(path);
	delete servers.maket;
	if (Object.keys(servers).length === 0) delete json.mcpServers;
	writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`, {
		encoding: "utf-8",
		mode: 0o600,
	});
	process.stdout.write(`maket: removed maket from Gemini config → ${path}\n`);
}

function geminiServers(json: Record<string, unknown>) {
	const rawServers = json.mcpServers;
	if (
		rawServers === null ||
		typeof rawServers !== "object" ||
		Array.isArray(rawServers)
	) {
		return undefined;
	}
	return rawServers as Record<string, unknown>;
}

export function runUninstall(opts: UninstallOpts): void {
	if (opts.client === "claude") uninstallClaude(opts);
	else if (opts.client === "codex") uninstallCodex(opts);
	else uninstallGemini(opts);
}
