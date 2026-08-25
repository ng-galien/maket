// ============================================================
// @maket/shared — wire contract between server and browser.
//
// Only wire types live here. Domain types (Document, Canvas, Page,
// DocSummary) stay per-side — they diverged for a reason and we don't
// recreate the coupling.
// ============================================================

export * from "./activity.js";
export * from "./category-path.js";
export * from "./charte.js";
export * from "./collection-cursor.js";
export * from "./collections.js";
export * from "./desktop.js";
export * from "./document-state.js";
export * from "./formats.js";
export * from "./http.js";
export * from "./json-patch.js";
export * from "./maket-bundle.js";
export * from "./messages.js";
export * from "./settings.js";
export * from "./strip-active-policy.js";
export * from "./toast.js";
export * from "./ws.js";
