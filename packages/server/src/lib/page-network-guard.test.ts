import { describe, expect, it, vi } from "vitest";
import {
	installNetworkGuard,
	type NetworkGuardMode,
} from "./page-network-guard.js";

function makeRequest(url: string) {
	return {
		url: () => url,
		continue: vi.fn().mockResolvedValue(undefined),
		abort: vi.fn().mockResolvedValue(undefined),
	};
}

function makePage() {
	const handlers = new Map<
		string,
		(req: ReturnType<typeof makeRequest>) => void
	>();
	return {
		setOfflineMode: vi.fn().mockResolvedValue(undefined),
		setRequestInterception: vi.fn().mockResolvedValue(undefined),
		on: vi.fn(
			(
				event: string,
				handler: (req: ReturnType<typeof makeRequest>) => void,
			) => {
				handlers.set(event, handler);
			},
		),
		trigger(url: string) {
			const req = makeRequest(url);
			const handler = handlers.get("request");
			if (!handler) throw new Error("request handler not registered");
			handler(req);
			return req;
		},
	};
}

describe("installNetworkGuard", () => {
	it("switches the page to offline mode when requested", async () => {
		const page = makePage();
		await installNetworkGuard(page as any, "offline");
		expect(page.setOfflineMode).toHaveBeenCalledWith(true);
		expect(page.setRequestInterception).not.toHaveBeenCalled();
	});

	it.each([
		["data:text/plain,ok", true],
		["about:blank", true],
		["http://localhost:3333/assets/x.png", true],
		["https://127.0.0.1:24842/mcp", true],
		["http://evil.example/steal", false],
		["https://192.168.1.1/admin", false],
		["not a url", false],
	] satisfies [
		string,
		boolean,
	][])("localhost-only mode %s -> %s", async (url, allowed) => {
		const page = makePage();
		await installNetworkGuard(
			page as any,
			"localhost-only" satisfies NetworkGuardMode,
		);
		const req = page.trigger(url);
		if (allowed) {
			expect(req.continue).toHaveBeenCalled();
			expect(req.abort).not.toHaveBeenCalled();
		} else {
			expect(req.abort).toHaveBeenCalledWith("blockedbyclient");
			expect(req.continue).not.toHaveBeenCalled();
		}
	});
});
