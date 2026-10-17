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

Reader does not expose text/template editing, structural changes, author
diagnostics, safe margins, or collection binding controls. In a connected,
writable document, the explicit **Annotate** toggle enables element selection
and the annotation dialog, with pending annotation markers. It does not enable
HTML editing or state mutations. Static exports and the linked read-only
document route cannot create annotations. Changing document focus is navigation.

## Document annotations

In a collection split view, **Annotate** belongs to the detail document's own
toolbar, not the application's general toolbar. It is scoped to that document;
the list remains navigable. The standalone connected Reader offers the same
document tool. While enabled, clicking an element or pressing Enter/Space on a
focusable element opens a note rather than following its document/page link.
Drag-to-pan is suspended so the annotation target remains selectable. Turning
the toggle off closes the dialog and restores navigation without changing any
saved annotation. Locked and read-only documents do not offer the toggle.

The existing persisted annotation queue is used. An agent reads it through
`maket_workspace action=list_messages doc=<exact-name>`; omitting `doc` reads all
pending document and workspace messages. Notes carry `id`, `type`, `docName`,
`pageIndex` (zero-based), `elementId`, `text`, and `ts`. Read the target HTML and
human request before making a correction; acknowledge only handled ids with
`maket_workspace action=ack_messages ids=[...]`. Annotation does not itself
change a document's content or record a business decision.

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

## Structured Workspace reading

A structured collection opens as two reading panes: a narrow index on the left
and one detail document on the right. The index is the collection document,
not an extra navigation tree. Use a narrow AUTO-format index template when
composing a menu: its height follows its content and the pane scrolls normally.
An AUTO index stays one continuous page with all compact items; `pageSize` and
physical-page pagination apply only to fixed-height collection pages.
Each document keeps its pages and page links. Opening another item replaces
the detail while preserving the index and its scroll position; closing the
detail leaves the index available.

Both panes start fitted in Reader, independently of previously saved document
zoom. The pane header offers an explicit Canvas navigation mode for wheel zoom
and drag pan. Switching back to Reader restores the fit and ordinary scrolling.
This is a transient presentation choice and does not change the document, its
templates, or its bindings. The separator resizes the panes; its initial index
width is 28 percent and a double-click returns to that width.

The general toolbar replaces its reading button with one icon-only display toggle in the Structured Workspace context: **Square** means one document and **PanelLeft** means list and detail. The tooltip states the current mode and the available switch. The former view-choice toolbar is removed; the annotation tool stays icon-only in the detail document toolbar. On narrow windows, opening the
library uses an overlay instead of shrinking both documents below a readable
width. Selecting a document closes that overlay but preserves the pin choice;
searching or expanding folders keeps the library open. A wide window retains
the docked library, using its user-selected width.


## Connected mobile reading

Narrow windows (below 960 CSS px) and primary-touch devices always use the
connected Reader shell, including an unfolded phone and a landscape tablet.
This is a transient presentation policy: it does not set document read-only,
change the desktop preference, or alter paper/PDF geometry. Existing writable
JSON Forms and bound state controls remain connected and persistent. The
standalone document-link route retains its separate read-only contract.

Documents, Photos, Workspaces, Messages and Settings are mobile reading destinations.
Collection navigation shows one page at a time. System Back restores the actual
previous navigation and its context; it does not always return to a list.
The Documents button explicitly opens the catalogue root, while the parent
control follows the category hierarchy independently of browser history. The
hidden list stays mounted to preserve its scroll position and context. Motion
respects reduced-motion. The editor and Canvas navigation toggle are not
mobile destinations. One finger scrolls the reader; a two-finger pinch zooms
its document around the gesture centre without changing document content.


The mobile explorer navigates one hierarchy level at a time: Workspaces then
collections, or document categories then their children. A tap always navigates
to the selected document; repeating the tap does not close it. Only the current
document is marked active. Preview and list presentations share that behavior;
previews use the existing first-page thumbnail route. The full-width search
field stays near the bottom of the explorer and matches names and categories
within its library, with provenance shown on results. A short context/return
control replaces the desktop breadcrumb and multi-document picker on mobile.
This presentation does not close the desktop's open documents or reset forms.

Mobile PDF sharing keeps a prepared PDF for the current document, invalidating
it when its content, state revision or charte changes. A single Share PDF action
hands that file to the browser's native share sheet. While an export is still
being prepared, an accessible full-screen activity indicator offers cancellation;
there is no intermediate share button or residual dialog. Browsers without file
sharing export the PDF instead and state that fallback explicitly.

Native sharing requires the browser's transient user activation. A cold export
that outlasts that activation cannot open the native sheet automatically: Maket
reports the refusal without claiming a share or offering a second intermediate
button. Pre-preparation reduces this case but does not remove the browser limit.


The document menu is shared by catalogue rows and the current reader: copy the
title and link, write a document message, share its PDF, or rename it when the
existing document policy permits. Unavailable renaming is omitted. Folders do
not receive document actions. Previews fill their frame and show the top of the
first page on both mobile and desktop.

The Messages view also offers a general message without any document, even when
a document is open. Its scope is displayed as General message; the existing
persistent queue and agent `maket_workspace list_messages` / `ack_messages`
contract apply. The agent reads it on its next visit. Mobile composition uses
the visible screen including keyboard resizing; errors retain the draft.
