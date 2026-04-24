/**
 * `maket logs` — tail server / bridge logs from MAKET_DATA_DIR.
 *
 * Defaults to the spawned-server stdout (server-spawn.log). Pass --bridge to
 * watch the stdio-bridge log instead. Pure-Node tail so the command works
 * identically on macOS, Linux, and Windows.
 */

import {
	createReadStream,
	existsSync,
	readFileSync,
	statSync,
	watchFile,
} from "node:fs";
import { type MaketEnvOverrides, readEnv } from "./_env.ts";

const SNAPSHOT_LINES = 200;
const FOLLOW_INITIAL_LINES = 10;
const POLL_MS = 500;

function printLastLines(text: string, count: number): void {
	const lines = text.split("\n");
	// `split` leaves a trailing empty when the file ends with \n — drop it
	// before slicing so `count` corresponds to actual content lines.
	const trailingEmpty = lines.at(-1) === "" ? 1 : 0;
	const slice = lines.slice(Math.max(0, lines.length - count - trailingEmpty));
	process.stdout.write(slice.join("\n"));
}

function streamFrom(path: string, start: number, end: number): Promise<void> {
	return new Promise((resolve, reject) => {
		// `end` is inclusive in createReadStream; subtract 1 because our `end`
		// is the exclusive byte length.
		const stream = createReadStream(path, { start, end: end - 1 });
		stream.on("end", resolve);
		stream.on("error", reject);
		stream.pipe(process.stdout, { end: false });
	});
}

export interface LogsOpts extends MaketEnvOverrides {
	bridge?: boolean;
	follow?: boolean;
}

export function runLogs(opts: LogsOpts = {}): void {
	const env = readEnv(opts);
	const wantBridge = opts.bridge === true;
	const follow = opts.follow !== false;
	const path = wantBridge ? env.bridgeLog : env.serverSpawnLog;

	if (!existsSync(path)) {
		process.stderr.write(`maket: no log at ${path}\n`);
		process.exitCode = 1;
		return;
	}

	const text = readFileSync(path, "utf-8");

	if (!follow) {
		printLastLines(text, SNAPSHOT_LINES);
		return;
	}

	// Follow mode — print the last few lines, then poll for changes.
	printLastLines(text, FOLLOW_INITIAL_LINES);
	let position = statSync(path).size;
	let busy = false;

	watchFile(path, { interval: POLL_MS }, async (curr, prev) => {
		if (busy) return;
		// Truncation / rotation — reset position and continue from start.
		if (curr.size < position) position = 0;
		if (curr.size === prev.size && curr.size === position) return;
		busy = true;
		try {
			if (curr.size > position) {
				await streamFrom(path, position, curr.size);
				position = curr.size;
			}
		} catch (e) {
			process.stderr.write(
				`maket: tail read failed: ${(e as Error).message}\n`,
			);
		} finally {
			busy = false;
		}
	});

	const stop = () => process.exit(0);
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
}
