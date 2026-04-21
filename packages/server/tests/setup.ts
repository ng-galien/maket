/**
 * Per-worker vitest setup — warm the Jimp dynamic import once so the first
 * test that touches image processing doesn't pay the wasm/emscripten cold
 * start (≈2–3 s). Under parallel load the cost lands on whichever test
 * happens to hit `await import("jimp")` first and pushes it past the
 * 5 s default testTimeout.
 *
 * Paying the cost here amortises it across every test in the worker. No
 * other global state — keep this file cheap.
 */

await import("jimp");
