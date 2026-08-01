// ============================================================
// @maket/shared — wire contract between server and browser.
//
// Only wire types live here. Domain types (Document, Canvas, Page,
// DocSummary) stay per-side — they diverged for a reason and we don't
// recreate the coupling.
// ============================================================

export * from "./charte.js";
export * from "./collection-cursor.js";
export * from "./collections.js";
export * from "./formats.js";
export * from "./http.js";
export * from "./maket-bundle.js";
export * from "./strip-active-policy.js";
export * from "./ws.js";
