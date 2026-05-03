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
	it.each([
		"offline",
		"localhost-only",
	] satisfies NetworkGuardMode[])("installs request interception (not setOfflineMode) in %s mode", async (mode) => {
		const page = makePage();
		await installNetworkGuard(page as any, mode);
		expect(page.setRequestInterception).toHaveBeenCalledWith(true);
		expect(page.setOfflineMode).not.toHaveBeenCalled();
	});

	it.each([
		["data:text/plain,ok", true],
		["about:blank", true],
		["https://fonts.googleapis.com/css2?family=Inter", true],
		["https://fonts.googleapis.com/css2?family=Inter&display=swap", true],
		["https://fonts.googleapis.com/css?family=Inter", true],
		["https://fonts.googleapis.com/css2?family=Inter&leak=x", false],
		["https://fonts.googleapis.com/admin", false],
		["https://fonts.googleapis.com/?family=Inter", false],
		["https://fonts.gstatic.com/s/inter/v1/font.woff2", true],
		["https://fonts.gstatic.com/s/inter/v1/font.woff2?x=1", false],
		["https://fonts.gstatic.com/?x=1", false],
		["https://fonts.gstatic.com/admin", false],
		["http://localhost:3333/assets/x.png", false],
		["https://127.0.0.1:24842/mcp", false],
		["http://evil.example/steal", false],
		["https://192.168.1.1/admin", false],
		["https://fontsXgstatic.com/font.woff2", false],
		["not a url", false],
	] satisfies [
		string,
		boolean,
	][])("offline mode %s -> %s", async (url, allowed) => {
		const page = makePage();
		await installNetworkGuard(page as any, "offline");
		const req = page.trigger(url);
		if (allowed) {
			expect(req.continue).toHaveBeenCalled();
			expect(req.abort).not.toHaveBeenCalled();
		} else {
			expect(req.abort).toHaveBeenCalledWith("blockedbyclient");
			expect(req.continue).not.toHaveBeenCalled();
		}
	});

	it.each([
		["data:text/plain,ok", true],
		["about:blank", true],
		["http://localhost:3333/assets/x.png", true],
		["https://127.0.0.1:24842/mcp", true],
		["https://fonts.googleapis.com/css2?family=Fraunces", true],
		["https://fonts.googleapis.com/css2?family=Fraunces&leak=x", false],
		["https://fonts.gstatic.com/s/geist/v1/font.woff2", true],
		["https://fonts.gstatic.com/s/geist/v1/font.woff2?leak=x", false],
		["http://evil.example/steal", false],
		["https://192.168.1.1/admin", false],
		["https://fonts.googleapis.com.evil.example/", false],
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
