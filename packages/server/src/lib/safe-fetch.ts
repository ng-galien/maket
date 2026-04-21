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
		return true; // unparseable → treat as hostile
	}
	const [a, b] = parts as [number, number, number, number];
	if (a === 10) return true; // 10.0.0.0/8
	if (a === 127) return true; // 127.0.0.0/8 loopback
	if (a === 0) return true; // 0.0.0.0/8
	if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + AWS IMDS
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
	if (a === 192 && b === 168) return true; // 192.168.0.0/16
	if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
	if (a >= 224) return true; // 224+ multicast & reserved
	return false;
}

/** True if the IPv6 string is loopback, link-local, or unique-local. */
function isPrivateIPv6(ip: string): boolean {
	const lower = ip.toLowerCase();
	if (lower === "::1" || lower === "::") return true;
	if (lower.startsWith("fe80:")) return true; // link-local
	if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7
	if (lower.startsWith("ff")) return true; // multicast
	// IPv4-mapped IPv6 → check the embedded IPv4
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
	// `url.hostname` carries IPv6 with surrounding brackets — strip for IP / DNS.
	const host = url.hostname.replace(/^\[|\]$/g, "");

	// IP literals: skip DNS, check directly. IPv4 returns 4, IPv6 returns 6.
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

	// Hostname: resolve all addresses (could be IPv4 + IPv6); reject if any
	// resolves to a private/loopback address (DNS-rebinding-resistant).
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

/**
 * Fetch with a hard byte cap. Aborts the response stream as soon as the cap
 * is exceeded, so a malicious server can't DoS the host by streaming forever.
 * The caller still has to handle Content-Length-less responses sensibly.
 */
export async function boundedFetch(
	url: string,
	maxBytes: number = DEFAULT_MAX_FETCH_BYTES,
): Promise<Buffer> {
	const response = await fetch(url);
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
