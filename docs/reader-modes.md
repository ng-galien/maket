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

## Board presentation

Fixed-layout pages open fitted within the available width, never enlarged
beyond their real size. Reader, the linked document view and the standalone
viewer then share one board control:

| Input | Effect |
| --- | --- |
| Zoom buttons, `+` / `-` | Step the zoom by 10 %, from 25 % (or the fit, when smaller) to 200 % |
| Percentage button, `0` | Return to the fit |
| Trackpad pinch (`ctrl`/`⌘` wheel in Chromium and Firefox, gesture events in Safari) | Continuous zoom around the pointer |
| Mouse drag on the page, once zoomed beyond the fit | Pan; scrolling pans as well |

The zoom is a CSS `zoom` on the page stack, not a transform: layout, scrolling
and hit testing follow the zoomed geometry, so links and `data-maket-bind`
controls keep working at any zoom. A drag never starts on a link, a control, a
label or a bound element, and the click that ends a drag is ignored. Touch keeps
native scrolling.

Once the page is zoomed beyond the fit, a mouse drag on the page pans it, so
text cannot be selected with the mouse; text selection is turned off on the
document while a pan lasts and comes back when it ends. Return to the fit to
select text.

The zoom level is remembered per document in this browser only
(`localStorage`, key `maket.reader.zoom:<document id>`); it is never written to
the document, and returning to the fit forgets it. `embed=1` keeps a minimal
zoom control at the bottom right, with the same keyboard and pinch input.

## Links between pages

An anchor `href="#page=3"` (canonical, 1-based page number) or
`href="#page:Exact page name"` navigates to that page of the same document in
Reader and the viewer on a plain click. In the authoring Canvas a plain click
selects the link for editing, and ⌘-click (Ctrl-click outside Apple platforms)
follows it: the Canvas focuses the target page and fits the view on it. A
collection template page resolves to its first logical page. In print and PDF
the link becomes an internal link to the first printed page of the target. A
link to a missing page does nothing and is reported by `maket_html
action=check`. The target is a literal: `maket_html` set and patch and
`maket_page` add refuse Mustache in a page link.

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
set its own sizing policy; the Reader fits fixed-layout pages within the
available width down to 320 px, and the reader can zoom from there.
