import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, type Page } from "@playwright/test";

const ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);
const RAW_DIR = path.resolve(
	process.env.E2E_CLIENT_COVERAGE_DIR ??
		path.join(ROOT, ".e2e-coverage/client-raw"),
);

type JsCoverage = Awaited<ReturnType<Page["coverage"]["stopJSCoverage"]>>;

export const test = base.extend<{ clientCoverage: undefined }>({
	clientCoverage: [
		async ({ context, browserName }, use, testInfo) => {
			if (process.env.E2E_COVERAGE !== "1") {
				await use(undefined);
				return;
			}
			if (browserName !== "chromium") {
				throw new Error("E2E client coverage is supported only on Chromium");
			}

			const starts = new Map<Page, Promise<void>>();
			const start = (page: Page) => {
				if (starts.has(page)) return;
				starts.set(
					page,
					page.coverage.startJSCoverage({ resetOnNavigation: false }),
				);
			};
			context.on("page", start);
			for (const page of context.pages()) start(page);

			await use(undefined);
			context.off("page", start);

			const entries: JsCoverage = [];
			for (const [page, started] of starts) {
				await started;
				if (page.isClosed()) {
					throw new Error(
						`Coverage page closed before collection: ${testInfo.title}`,
					);
				}
				entries.push(...(await page.coverage.stopJSCoverage()));
			}

			if (testInfo.status !== testInfo.expectedStatus) return;
			const firstPartyEntries = entries.filter((entry) => {
				try {
					return new URL(entry.url).pathname.startsWith("/assets/");
				} catch {
					return false;
				}
			});
			if (firstPartyEntries.length === 0) {
				throw new Error(`No client coverage collected for ${testInfo.title}`);
			}

			await mkdir(RAW_DIR, { recursive: true });
			const id = createHash("sha256")
				.update(`${testInfo.testId}:${testInfo.retry}`)
				.digest("hex")
				.slice(0, 16);
			await writeFile(
				path.join(RAW_DIR, `${id}.json`),
				JSON.stringify({
					testId: testInfo.testId,
					titlePath: testInfo.titlePath,
					entries: firstPartyEntries,
				}),
			);
		},
		{ auto: true },
	],
});

export { expect };
