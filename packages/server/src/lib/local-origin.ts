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

/** True if the Referer URL points to a loopback host. Empty / absent referer
 *  is treated as "no claim" (caller decides whether to allow). */
export function isLoopbackReferer(referer: string | undefined | null): boolean {
	if (!referer) return false;
	try {
		const url = new URL(referer);
		return isLoopbackHost(url.host);
	} catch {
		return false;
	}
}

/**
 * Reject browser-initiated requests whose Referer points outside loopback.
 * The global Origin/Host middleware already blocks XHR/fetch from any other
 * origin, but a top-level navigation (`window.open`, `location.href`) carries
 * no Origin header — only Referer. This guard catches that vector.
 *
 * Native HTTP clients (curl, the MCP bridge) send neither header and pass.
 */
export function requireBrowserContextLoopback(
	req: Request,
	res: Response,
	next: NextFunction,
): void {
	const referer = req.headers.referer;
	if (referer && !isLoopbackReferer(referer)) {
		res.status(403).end();
		return;
	}
	next();
}
