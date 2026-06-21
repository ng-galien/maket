/**
 * Safe URL fetching helpers — block SSRF and runaway downloads.
 *
 * The MCP `maket_image` tool lets an agent (or, via prompt injection, a
 * hostile design brief) hand the server an arbitrary URL to download. Without
 * the guards below, that means the agent can:
 *
 *   - Probe the host's private network (RFC1918, link-local, loopback)
 *   - Hit cloud metadata endpoints (169.254.169.254 → AWS IMDS, etc.)
 *   - Pull a multi-GB file and exhaust disk
 *
 * `assertSafeUrl(url)` rejects non-http(s) schemes and any host whose
 * resolved address falls in a private/loopback/link-local range.
 * `boundedFetch(url, maxBytes)` performs the fetch and aborts if the response
 * exceeds the cap.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Maximum bytes accepted from importFromUrl. ~32 MB is generous for an image. */
export const DEFAULT_MAX_FETCH_BYTES = 32 * 1024 * 1024;

/** True if the dotted-decimal IPv4 string falls in a forbidden range. */
function isPrivateIPv4(ip: string): boolean {
	const parts = ip.split(".").map((p) => Number(p));
	if (
		parts.length !== 4 ||
		parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
	) {
		return true;
	}
	const [a, b] = parts as [number, number, number, number];
	if (a === 10) return true;
	if (a === 127) return true;
	if (a === 0) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	if (a >= 224) return true;
	return false;
}

/** True if the IPv6 string is loopback, link-local, or unique-local. */
function isPrivateIPv6(ip: string): boolean {
	const lower = ip.toLowerCase();
	if (lower === "::1" || lower === "::") return true;
	if (lower.startsWith("fe80:")) return true;
	if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
	if (lower.startsWith("ff")) return true;
	const v4mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (v4mapped?.[1]) return isPrivateIPv4(v4mapped[1]);
	return false;
}

export async function assertSafeUrl(rawUrl: string): Promise<void> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error(`Invalid URL: ${rawUrl}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Refusing non-http(s) URL: ${url.protocol}`);
	}
	const host = url.hostname.replace(/^\[|\]$/g, "");

	const ipFamily = isIP(host);
	if (ipFamily) {
		const bad = ipFamily === 6 ? isPrivateIPv6(host) : isPrivateIPv4(host);
		if (bad) {
			throw new Error(
				`Refusing URL — host ${host} resolves to a private/loopback address (${host}).`,
			);
		}
		return;
	}

	let addrs: { address: string; family: number }[];
	try {
		addrs = await dnsLookup(host, { all: true, verbatim: true });
	} catch (e) {
		throw new Error(`DNS lookup failed for ${host}: ${(e as Error).message}`);
	}
	for (const a of addrs) {
		const bad =
			a.family === 6 ? isPrivateIPv6(a.address) : isPrivateIPv4(a.address);
		if (bad) {
			throw new Error(
				`Refusing URL — host ${host} resolves to a private/loopback address (${a.address}).`,
			);
		}
	}
}

const MAX_REDIRECTS = 5;

/**
 * Fetch with manual redirect handling, SSRF re-validation on every hop, and a
 * hard byte cap. Without manual handling, `fetch()` follows redirects
 * automatically — letting `https://public.example` reply `302
 * http://127.0.0.1/secret` and bypass `assertSafeUrl`'s initial-URL check.
 *
 * The byte cap aborts the response stream as soon as it is exceeded, so a
 * malicious server cannot DoS the host by streaming forever.
 */
export async function boundedFetch(
	url: string,
	maxBytes: number = DEFAULT_MAX_FETCH_BYTES,
): Promise<Buffer> {
	let current = url;
	let response: Response | null = null;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		response = await fetch(current, { redirect: "manual" });
		if (response.status >= 300 && response.status < 400) {
			const next = response.headers.get("location");
			if (!next) {
				throw new Error(
					`Redirect ${response.status} from ${current} without Location header.`,
				);
			}
			const resolved = new URL(next, current).toString();
			await assertSafeUrl(resolved);
			current = resolved;
			continue;
		}
		break;
	}
	if (!response) {
		throw new Error(`No response after ${MAX_REDIRECTS} redirects from ${url}`);
	}
	if (response.status >= 300 && response.status < 400) {
		throw new Error(`Too many redirects (>${MAX_REDIRECTS}) from ${url}`);
	}
	if (!response.ok) {
		throw new Error(
			`Download failed: ${response.status} ${response.statusText}`,
		);
	}
	const contentLength = Number(response.headers.get("content-length") ?? "0");
	if (contentLength > maxBytes) {
		throw new Error(
			`Refusing download — Content-Length ${contentLength} exceeds cap ${maxBytes}.`,
		);
	}
	const body = response.body;
	if (!body) return Buffer.alloc(0);

	const chunks: Buffer[] = [];
	let total = 0;
	const reader = body.getReader();
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		if (value) {
			total += value.byteLength;
			if (total > maxBytes) {
				try {
					await reader.cancel();
				} catch {}
				throw new Error(
					`Refusing download — response exceeds ${maxBytes} bytes.`,
				);
			}
			chunks.push(Buffer.from(value));
		}
	}
	return Buffer.concat(chunks);
}
