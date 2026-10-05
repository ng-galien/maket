# Mobile document links

Maket exposes a document-only reading route for another application's mobile UI. Call `maket_doc action=link doc=<name>` over MCP. It returns JSON with a stable `documentId` and a relative `path`, for example:

```json
{"documentId":"<uuid>","path":"/mobile/apps/maket/documents/<uuid>/read"}
```

For the TRUST gateway, build the client and start Maket with:

```bash
npm run build:client
MAKET_BASE_PATH=/mobile/apps/maket npm start
```

Maket remains bound to `127.0.0.1:24842` by default. TRUST maps `/mobile/apps/maket/*` to `http://127.0.0.1:24842/*`, stripping `/mobile/apps/maket` for HTTP and WebSocket requests. The gateway must forward `Host` and any browser `Origin` as loopback values accepted by Maket's existing guard; a public or Tailnet Host/Origin forwarded unchanged receives HTTP/WS 403. The gateway owns the external origin, authentication and mobile PWA. Prefix the returned `path` with that origin. If `MAKET_BASE_PATH` is unset, links and browser paths remain rooted at `/` for local Maket use.

Structured Workspace item and collection links include `workspace` and `collection` query parameters so the document opens in its owning context. The route renders the current persistent document with a page counter, page navigation, fit-to-width reading, and zoom controls. The linked browser connection loads only the requested document and does not change another client's focus or displayed-workspace state.

This route is a read-only document surface. The TRUST mobile extension owns its project catalog, chronological interactions, questions, decisions, forms, and procedure state. Maket may later hold published or synchronized documents, but this link does not synchronize procedure state or deliver notifications. Access from a phone depends on the TRUST gateway and Maket server both running; the route does not change Maket's loopback-only network exposure.
