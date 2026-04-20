import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createJsonRpcProxy } from "./proxy.ts";

function collect(stream: PassThrough): Promise<string> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		stream.on("data", (c) => chunks.push(Buffer.from(c)));
		stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
	});
}

describe("createJsonRpcProxy", () => {
	it("forwards one NDJSON message and writes the JSON response", async () => {
		const stdin = new PassThrough();
		const stdout = new PassThrough();
		const seen: { url: string; body: string }[] = [];

		const fakeFetch = (async (url: string, init: RequestInit) => {
			seen.push({ url, body: init.body as string });
			return new Response(
				JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const proxy = createJsonRpcProxy({
			url: "http://test/mcp",
			stdin,
			stdout,
			stderr: new PassThrough(),
			fetch: fakeFetch,
		});

		stdin.write(
			`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`,
		);
		stdin.end();

		await proxy.done;
		stdout.end();
		const out = await collect(stdout);

		expect(seen).toHaveLength(1);
		const first = seen[0];
		if (!first) throw new Error("no fetch call captured");
		expect(first.url).toBe("http://test/mcp");
		expect(JSON.parse(first.body).method).toBe("ping");
		expect(JSON.parse(out.trim())).toEqual({
			jsonrpc: "2.0",
			id: 1,
			result: { ok: true },
		});
	});

	it("emits a JSON-RPC error when the transport throws", async () => {
		const stdin = new PassThrough();
		const stdout = new PassThrough();

		const fakeFetch = (async () => {
			throw new Error("boom");
		}) as unknown as typeof fetch;

		const proxy = createJsonRpcProxy({
			url: "http://test/mcp",
			stdin,
			stdout,
			stderr: new PassThrough(),
			fetch: fakeFetch,
		});

		stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "x" })}\n`);
		stdin.end();
		await proxy.done;
		stdout.end();
		const out = await collect(stdout);
		const parsed = JSON.parse(out.trim());
		expect(parsed.id).toBe(7);
		expect(parsed.error.code).toBe(-32000);
		expect(parsed.error.message).toMatch(/boom/);
	});

	it("parses SSE responses and emits one NDJSON line per data event", async () => {
		const stdin = new PassThrough();
		const stdout = new PassThrough();

		const sseBody = new ReadableStream<Uint8Array>({
			start(controller) {
				const enc = new TextEncoder();
				controller.enqueue(
					enc.encode('data: {"jsonrpc":"2.0","id":2,"result":{"step":1}}\n\n'),
				);
				controller.enqueue(
					enc.encode('data: {"jsonrpc":"2.0","id":2,"result":{"step":2}}\n\n'),
				);
				controller.close();
			},
		});

		const fakeFetch = (async () =>
			new Response(sseBody, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			})) as unknown as typeof fetch;

		const proxy = createJsonRpcProxy({
			url: "http://test/mcp",
			stdin,
			stdout,
			stderr: new PassThrough(),
			fetch: fakeFetch,
		});

		stdin.write(
			`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "stream" })}\n`,
		);
		stdin.end();
		await proxy.done;
		stdout.end();
		const lines = (await collect(stdout)).split("\n").filter((l) => l.trim());
		expect(lines).toHaveLength(2);
		const [l0, l1] = lines;
		if (!l0 || !l1) throw new Error("missing SSE lines");
		expect(JSON.parse(l0).result.step).toBe(1);
		expect(JSON.parse(l1).result.step).toBe(2);
	});
});
