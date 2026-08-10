# Reader presentation contract

Reader and Canvas use the same document renderer. A transient presentation
policy changes the visible capabilities; it does not create a second document
model or persist a reader-specific copy.

| Surface | Data source | Access | Document authoring | State controls | Representation |
| --- | --- | --- | --- | --- | --- |
| Canvas | Connected | Writable | Enabled | Persisted | Current Canvas choice |
| Canvas | Connected | Locked | Disabled | Disabled | Current Canvas choice |
| Reader | Connected | Writable | Disabled | Persisted | Live |
| Reader | Connected | Locked | Disabled | Disabled | Live |
| Reader | Static bundle | Read-only | Disabled | Local, not saved | Live snapshot |

Reader never exposes selection, annotation, text/template editing, structural
changes, author diagnostics, safe margins, pending markers, or collection
binding controls. Changing document focus is navigation, not authoring.

A collection-bound template is expanded locally for reading: each saved member
produces a successive logical page. This does not update the shared collection
cursor or the document. Draft-only members are not part of Reader output.

The connected Reader has a fixed minimal navigation bar. The standalone viewer
uses the same Reader surface; `embed=1` removes its toolbar and paper chrome.
`src` remains same-origin, and `doc` selects a bundle document by id or name,
falling back to the first document.

## Publishing an embed

`npm run build:pages` writes the static viewer to `docs/app/viewer.html`. Publish
that directory and the `.maket` bundle under the same site origin, then embed
the viewer with a root-relative bundle URL:

```html
<iframe
  src="/app/viewer.html?src=/documents/article.maket&doc=article&embed=1"
  title="Article">
</iframe>
```

Cross-origin bundle URLs are rejected before fetching. The iframe host should
set its own sizing policy; the Reader keeps fixed-layout pages within the
available width down to 320 px.
