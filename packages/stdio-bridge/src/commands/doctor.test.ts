import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkChromium, checkGmail } from "./doctor.ts";

describe("checkChromium", () => {
	it("launches the same headless-shell runtime used by Maket renders", async () => {
		const close = vi.fn(async () => {});
		const launch = vi.fn(async () => ({
			version: async () => "HeadlessChrome/151.0.7922.71",
			close,
		}));

		await expect(checkChromium({ launch })).resolves.toEqual({
			level: "ok",
			line: "Chromium headless — HeadlessChrome/151.0.7922.71",
		});
		expect(launch).toHaveBeenCalledWith(
			expect.objectContaining({ headless: "shell" }),
		);
		expect(close).toHaveBeenCalledOnce();
	});

	it("fails with a repair command for the actual headless-shell browser", async () => {
		const launch = vi.fn(async () => {
			throw new Error("Could not find Chrome Headless Shell (ver. 151)");
		});

		const result = await checkChromium({ launch });

		expect(result.level).toBe("fail");
		expect(result.line).toContain("Could not find Chrome Headless Shell");
		expect(result.line).toContain(
			"npm install -g --allow-scripts=puppeteer @ng-galien/maket",
		);
	});
});

describe("checkGmail", () => {
	it("fails when the stored refresh token is expired or revoked", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "maket-doctor-gmail-"));
		try {
			writeFileSync(
				join(dataDir, "google-credentials.json"),
				JSON.stringify({
					installed: { client_id: "id", client_secret: "secret" },
				}),
			);
			writeFileSync(
				join(dataDir, "google-token.json"),
				JSON.stringify({ refresh_token: "expired", with_read: true }),
			);
			const fetchMock = vi.fn<typeof fetch>(
				async () =>
					new Response(JSON.stringify({ error: "invalid_grant" }), {
						status: 400,
					}),
			);

			await expect(checkGmail(dataDir, {}, fetchMock)).resolves.toEqual({
				level: "fail",
				line: "Gmail — refresh token expired or revoked. Reconnect with: maket_gmail action=connect",
			});
			expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
		} finally {
			rmSync(dataDir, { recursive: true, force: true });
		}
	});
});
