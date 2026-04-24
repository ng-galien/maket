/**
 * `maket gmail` — manage the Gmail OAuth state on this machine.
 *
 *   status  — report whether the Desktop-app credentials file and the
 *             refresh-token file exist under `$MAKET_DATA_DIR/`.
 *   reset   — remove both files (after a y/N prompt unless `--force`).
 *
 * The server reads the same paths (`google-credentials.json`,
 * `google-token.json`) from `config.DATA_DIR`, so this stays in sync without
 * touching server code.
 */

import { existsSync, statSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline";
import { type MaketEnvOverrides, readEnv } from "./_env.ts";
import { gmailPaths } from "./_gmail-state.ts";

const GMAIL_HELP = `maket gmail — manage Gmail OAuth state on this machine

  status        Show whether credentials and refresh token exist
  reset         Remove both files after confirmation
  reset --force Skip the y/N prompt

Files live under $MAKET_DATA_DIR (default ~/.maket/):
  google-credentials.json   — your Desktop OAuth client (client_id + secret)
  google-token.json         — your refresh token + with_read flag

See docs/gmail-setup.md for the end-to-end setup walkthrough.
`;

interface GmailFileState {
	path: string;
	exists: boolean;
	mode?: string;
}

function inspect(path: string): GmailFileState {
	if (!existsSync(path)) return { path, exists: false };
	const mode = (statSync(path).mode & 0o777).toString(8).padStart(3, "0");
	return { path, exists: true, mode };
}

function prompt(question: string): Promise<boolean> {
	return new Promise((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(question, (answer) => {
			rl.close();
			resolve(/^y(es)?$/i.test(answer.trim()));
		});
	});
}

export interface GmailOpts extends MaketEnvOverrides {
	force?: boolean;
}

export async function runGmail(
	sub: string | undefined,
	opts: GmailOpts = {},
): Promise<void> {
	if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
		process.stdout.write(GMAIL_HELP);
		return;
	}
	switch (sub) {
		case "status":
			runStatus(opts);
			return;
		case "reset":
			await runReset(opts);
			return;
		default:
			process.stderr.write(`maket gmail: unknown subcommand "${sub}"\n\n`);
			process.stdout.write(GMAIL_HELP);
			process.exitCode = 1;
	}
}

function runStatus(overrides: MaketEnvOverrides): void {
	const { dataDir, url } = readEnv(overrides);
	const { credentialsPath, tokenPath } = gmailPaths(dataDir);
	const creds = inspect(credentialsPath);
	const token = inspect(tokenPath);

	const lines: string[] = ["Gmail OAuth state"];
	lines.push(
		creds.exists
			? `  ✓ credentials  ${creds.path} (mode ${creds.mode})`
			: `  ✗ credentials  missing at ${creds.path}\n                 → paste JSON at ${url}/setup/gmail`,
	);
	lines.push(
		token.exists
			? `  ✓ refresh token ${token.path} (mode ${token.mode})`
			: `  ✗ refresh token missing at ${token.path}\n                 → run maket_gmail action=connect`,
	);
	process.stdout.write(`${lines.join("\n")}\n`);
}

async function runReset(opts: GmailOpts): Promise<void> {
	const { dataDir, url } = readEnv(opts);
	const force = opts.force === true;
	const { credentialsPath, tokenPath } = gmailPaths(dataDir);
	const present = [credentialsPath, tokenPath].filter((p) => existsSync(p));

	if (present.length === 0) {
		process.stdout.write("Nothing to reset — no Gmail files found.\n");
		return;
	}

	if (!force) {
		process.stdout.write(
			`About to delete:\n${present.map((p) => `  ${p}`).join("\n")}\n\n`,
		);
		const ok = await prompt("Proceed? [y/N] ");
		if (!ok) {
			process.stdout.write("Aborted.\n");
			return;
		}
	}

	for (const path of present) {
		unlinkSync(path);
		process.stdout.write(`Removed ${path}\n`);
	}
	process.stdout.write(`Done. Re-run ${url}/setup/gmail to reconnect.\n`);
}
