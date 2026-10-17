/**
 * Origin / Host validation for the localhost-only attack surface.
 *
 * Rejects:
 *  - Cross-origin browser requests (CSRF from any visited site)
 *  - DNS-rebinding requests where the Host header points elsewhere
 *
 * Allows:
 *  - Requests with no Origin header (CLI tools, native HTTP clients,
 *    top-level navigations like the OAuth callback)
 *  - Requests where Origin and Host both resolve to a loopback name
 */

import type { NextFunction, Request, Response } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/** Strip optional port / IPv6 brackets from a Host or authority string. */
function hostnameOnly(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("[")) {
		const closeIdx = trimmed.indexOf("]");
		if (closeIdx === -1) return null;
		return trimmed.slice(1, closeIdx);
	}
	const colonIdx = trimmed.lastIndexOf(":");
	return colonIdx > 0 ? trimmed.slice(0, colonIdx) : trimmed;
}

/** True if the given Host: or origin host (with optional port) is loopback. */
export function isLoopbackHost(value: string | undefined | null): boolean {
	if (!value) return false;
	const host = hostnameOnly(value);
	return host !== null && LOCAL_HOSTS.has(host.toLowerCase());
}

/** True if the Origin URL points to a loopback host. */
export function isLoopbackOrigin(origin: string | undefined | null): boolean {
	if (!origin) return false;
	try {
		const url = new URL(origin);
		return isLoopbackHost(url.host);
	} catch {
		return false;
	}
}

/**
 * Reject browser-initiated requests whose Referer points outside the allowed request context.
 * The global Origin/Host middleware already blocks XHR/fetch from any other
 * origin, but a top-level navigation (`window.open`, `location.href`) carries
 * no Origin header — only Referer. This guard catches that vector.
 *
 * Native HTTP clients (curl, the MCP bridge) send neither header and pass.
 */
export function requireBrowserContext(trustedOrigins: readonly string[] = []) {
	return (req: Request, res: Response, next: NextFunction): void => {
		const referer = req.headers.referer;
		if (referer) {
			let origin: string;
			try {
				origin = new URL(referer).origin;
			} catch {
				res.status(403).end();
				return;
			}
			if (!isAllowedRequestOrigin(req.headers.host, origin, trustedOrigins)) {
				res.status(403).end();
				return;
			}
		}
		next();
	};
}

/** Explicit external origins only; the built-in loopback policy stays the default. */
export function parseTrustedOrigins(raw: string | undefined): string[] {
	if (!raw) return [];
	const values: unknown = JSON.parse(raw);
	if (!Array.isArray(values))
		throw new Error(
			"MAKET_TRUSTED_ORIGINS must be a JSON array of HTTPS origins",
		);
	for (const value of values) {
		if (typeof value !== "string")
			throw new Error("MAKET_TRUSTED_ORIGINS must contain HTTPS origins");
		const url = new URL(value);
		if (
			url.protocol !== "https:" ||
			url.origin !== value ||
			url.username ||
			url.password ||
			value.includes("*")
		)
			throw new Error(
				"MAKET_TRUSTED_ORIGINS must contain exact canonical HTTPS origins",
			);
	}
	return [...new Set(values as string[])];
}

/** A trusted HTTPS reverse proxy may preserve its authority or forward loopback Host. */
export function isAllowedRequestOrigin(
	host: string | undefined,
	origin: string | undefined,
	trustedOrigins: readonly string[] = [],
): boolean {
	if (isLoopbackHost(host) && (!origin || isLoopbackOrigin(origin)))
		return true;
	return trustedOrigins.some((trusted) => {
		const authority = new URL(trusted).host;
		return origin
			? origin === trusted && (host === authority || isLoopbackHost(host))
			: host === authority;
	});
}
