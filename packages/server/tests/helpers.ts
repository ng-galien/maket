import { ServerResponse } from "node:http";
import { PassThrough, Readable } from "node:stream";
import type { Express } from "express";

export interface TestApp {
	baseUrl: string;
	close: () => Promise<void>;
}

const apps = new Map<string, Express>();
const nativeFetch = globalThis.fetch.bind(globalThis);
let fetchPatched = false;
let sequence = 0;

export async function startTestApp(app: Express): Promise<TestApp> {
	patchFetch();
	const host = `app-${++sequence}.maket.test`;
	apps.set(host, app);
	return {
		baseUrl: `http://${host}`,
		close: async () => {
			apps.delete(host);
		},
	};
}

function patchFetch(): void {
	if (fetchPatched) return;
	fetchPatched = true;
	globalThis.fetch = async (input, init) => {
		const url = requestUrl(input);
		const app = apps.get(url.hostname);
		if (!app) return nativeFetch(input, init);
		return dispatch(app, url, await requestParts(input, init));
	};
}

function requestUrl(input: RequestInfo | URL): URL {
	if (input instanceof Request) return new URL(input.url);
	return new URL(input.toString());
}

async function requestParts(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
): Promise<{ method: string; headers: Record<string, string>; body: Buffer }> {
	const headers = requestHeaders(input, init);
	const body = await requestBody(input, init);
	if (body.length > 0 && !headers["content-length"]) {
		headers["content-length"] = String(body.length);
	}
	return {
		method: requestMethod(input, init),
		headers,
		body,
	};
}

function requestMethod(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
): string {
	if (init?.method) return init.method;
	if (input instanceof Request) return input.method;
	return "GET";
}

function requestHeaders(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
): Record<string, string> {
	const headers = new Headers(
		input instanceof Request ? input.headers : undefined,
	);
	if (init?.headers) {
		for (const [key, value] of new Headers(init.headers))
			headers.set(key, value);
	}
	return Object.fromEntries(
		[...headers].map(([key, value]) => [key.toLowerCase(), value]),
	);
}

async function requestBody(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
): Promise<Buffer> {
	if (init?.body !== undefined) return bodyBuffer(init.body);
	if (input instanceof Request) {
		const copy = input.clone();
		return Buffer.from(await copy.arrayBuffer());
	}
	return Buffer.alloc(0);
}

function bodyBuffer(body: BodyInit | null): Buffer {
	if (!body) return Buffer.alloc(0);
	if (typeof body === "string") return Buffer.from(body);
	if (body instanceof URLSearchParams) return Buffer.from(body.toString());
	if (body instanceof ArrayBuffer) return Buffer.from(body);
	if (ArrayBuffer.isView(body)) {
		return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
	}
	throw new Error("Unsupported test request body.");
}

async function dispatch(
	app: Express,
	url: URL,
	parts: { method: string; headers: Record<string, string>; body: Buffer },
): Promise<Response> {
	const req = requestStream(url, parts);
	const raw = await rawResponse(app, req);
	return responseFromRaw(raw);
}

function requestStream(
	url: URL,
	parts: { method: string; headers: Record<string, string>; body: Buffer },
): Readable & { method: string; url: string; headers: Record<string, string> } {
	const req = new Readable({
		read() {
			this.push(parts.body);
			this.push(null);
		},
	}) as Readable & {
		method: string;
		url: string;
		headers: Record<string, string>;
	};
	req.method = parts.method;
	req.url = `${url.pathname}${url.search}`;
	req.headers = parts.headers;
	return req;
}

function rawResponse(app: Express, req: Readable): Promise<Buffer> {
	const res = new ServerResponse(req as never);
	const socket = new PassThrough();
	const chunks: Buffer[] = [];
	socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
	return new Promise((resolve, reject) => {
		res.on("finish", () => resolve(Buffer.concat(chunks)));
		res.on("error", reject);
		socket.on("error", reject);
		res.assignSocket(socket as never);
		expressHandle(app, req, res);
	});
}

function expressHandle(app: Express, req: Readable, res: ServerResponse): void {
	(app as unknown as { handle(req: unknown, res: unknown): void }).handle(
		req,
		res,
	);
}

function responseFromRaw(raw: Buffer): Response {
	const split = raw.indexOf("\r\n\r\n");
	const head = raw.slice(0, split).toString("latin1");
	const body = split >= 0 ? raw.slice(split + 4) : Buffer.alloc(0);
	const [statusLine = "", ...headerLines] = head.split("\r\n");
	const match = statusLine.match(/^HTTP\/\d\.\d\s+(\d+)\s*(.*)$/);
	const status = match?.[1] ? Number(match[1]) : 500;
	const statusText = match?.[2] ?? "";
	const headers = new Headers();
	for (const line of headerLines) {
		const index = line.indexOf(":");
		if (index <= 0) continue;
		headers.append(line.slice(0, index), line.slice(index + 1).trim());
	}
	return new Response(body, { status, statusText, headers });
}
