import { defineConfig, devices } from "@playwright/test";

// The E2E runner spins up a dedicated server on port 3399 with an isolated
// data dir so it can't clobber the user's local `.maket/` state. The root
// `e2e:server` script wipes `.e2e-maket/` before each run so tests always
// start from an empty workspace.
const BASE_URL = "http://localhost:3399";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: process.env.CI ? [["github"], ["html"]] : "list",
	use: {
		baseURL: BASE_URL,
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		// Built client is served by the Express server, so no Vite dev server.
		command: "npm run e2e:server --prefix ../..",
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
		stdout: "pipe",
		stderr: "pipe",
	},
});
