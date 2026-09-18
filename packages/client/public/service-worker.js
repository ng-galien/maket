// Maket requires its local server for document and agent operations. The
// service worker deliberately owns no offline cache: caching the workspace
// shell while its server is unavailable would present a misleading, unusable
// application and risks stale release assets.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});
