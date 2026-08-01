/**
 * JSON-RPC proxy: NDJSON stdin ↔ POST /mcp on the Maket HTTP server.
 *
 * Each newline-delimited JSON-RPC message read from stdin is POSTed to the
 * server, and the server's response (JSON or SSE stream) is forwarded back
 * as one line per JSON-RPC message on stdout.
 *
 * Kept as a pure factory so tests can inject streams and a fetch impl.
 */

import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export interface ProxyOpts {
	url: string;
	stdin: Readable;
	stdout: Writable;
	stderr?: Writable;
	fetch?: typeof fetch;
}

export interface ProxyHandle {
	done: Promise<void>;
	stop: () => void;
}

export function createJsonRpcProxy(opts: ProxyOpts): ProxyHandle {
	const f = opts.fetch ?? fetch;
	const err = opts.stderr ?? process.stderr;
	let stopped = false;

	const rl = createInterface({ input: opts.stdin, crlfDelay: Infinity });

	const done = (async () => {
		const inFlight: Promise<void>[] = [];
		for await (const line of rl) {
			if (stopped) break;
			const trimmed = line.trim();
			if (!trimmed) continue;
			inFlight.push(
				forwardOne(trimmed, opts.url, f, opts.stdout, err).catch((e) => {
					err.write(`[stdio-bridge] forward error: ${(e as Error).message}\n`);
				}),
			);
		}
		await Promise.all(inFlight);
	})();

	return {
		done,
		stop: () => {
			stopped = true;
			rl.close();
		},
	};
}

async function forwardOne(
	body: string,
	url: string,
	f: typeof fetch,
	stdout: Writable,
	stderr: Writable,
): Promise<void> {
	let id: unknown = null;
	try {
		const parsed = JSON.parse(body) as { id?: unknown };
		id = parsed.id ?? null;
	} catch {
		stderr.write(`[stdio-bridge] dropping non-JSON line\n`);
		return;
	}

	let res: Response;
	try {
		res = await f(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body,
		});
	} catch (e) {
		writeError(stdout, id, -32000, `transport: ${(e as Error).message}`);
		return;
	}

	const ct = res.headers.get("content-type") ?? "";

	if (ct.includes("text/event-stream") && res.body) {
		await forwardSse(res.body, stdout);
		return;
	}

	const text = await res.text();
	if (!res.ok) {
		writeError(stdout, id, -32000, `http ${res.status}: ${text.slice(0, 200)}`);
		return;
	}
	if (!text.trim()) return;
	writeLine(stdout, text);
}

// code-moniker: ignore[smell-feature-envy-local]
// stdio-bridge `forwardSse`: transport adapter coordinating process I/O and MCP HTTP.
async function forwardSse(
	body: ReadableStream<Uint8Array>,
	stdout: Writable,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		let sep = buf.indexOf("\n\n");
		while (sep !== -1) {
			const chunk = buf.slice(0, sep);
			buf = buf.slice(sep + 2);
			const data = chunk
				.split("\n")
				.filter((l) => l.startsWith("data:"))
				.map((l) => l.slice(5).replace(/^\s/, ""))
				.join("\n");
			if (data) writeLine(stdout, data);
			sep = buf.indexOf("\n\n");
		}
	}
	buf += decoder.decode();
	if (buf.trim()) {
		const data = buf
			.split("\n")
			.filter((l) => l.startsWith("data:"))
			.map((l) => l.slice(5).replace(/^\s/, ""))
			.join("\n");
		if (data) writeLine(stdout, data);
	}
}

function writeLine(stdout: Writable, payload: string): void {
	stdout.write(payload.endsWith("\n") ? payload : `${payload}\n`);
}

function writeError(
	stdout: Writable,
	id: unknown,
	code: number,
	message: string,
): void {
	writeLine(
		stdout,
		JSON.stringify({
			jsonrpc: "2.0",
			id: id ?? null,
			error: { code, message },
		}),
	);
}
