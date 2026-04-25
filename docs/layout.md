# Layout & print margins

Maket renders your document on a fixed canvas (A4, A5, poster, etc.). Whatever
your AI assistant places on that canvas is checked against a print-safe area
before you export to PDF or share. This page explains what you see in the live
preview and what to ask your assistant when something looks wrong.

## The cyan dashed rectangle

When the document has print margins set, the live preview draws a cyan dashed
rectangle inside the page. **This is the safe zone.** Anything inside it will
print cleanly on any consumer printer or commercial press. Anything that
crosses or sits outside that line risks being cut off, ending up too close to
the edge, or being lost in the binding gutter of a printed book.

The rectangle is informational only — it's there so you can spot at a glance
whether your content lives inside the safe area.

## Margin presets by use case

Real-world margin conventions, with public sources you can quote when asking
your assistant for a setup:

| Use case | Top | Right | Bottom | Left | Source |
|---|---|---|---|---|---|
| Poster / flyer | 10mm | 10mm | 10mm | 10mm | [Lava Print artwork specs](https://lavaprint.com.au/artwork-specifications-for-print/) |
| Paperback book (A4, left binding) | 15mm | 15mm | 15mm | 18mm | [Book Printing UK](https://info.bookprintinguk.com/en/articles/3340626-how-to-format-a4-paperback-books) |
| Magazine | 10mm | 20mm | 10mm | 13mm | [Envato Tuts+ — Magazine layout](https://design.tutsplus.com/tutorials/how-to-create-a-professional-magazine-layout--vector-3702) |
| Office document (Word default) | 25mm | 25mm | 25mm | 25mm | Microsoft Word default page setup |

If your work doesn't fit one of these, give the assistant the millimeter values
directly. Anything below 5mm risks getting trimmed by the printer.

## Asking the assistant to fix the layout

You don't need to diagnose anything yourself. Just describe what you want and
let the assistant check and correct. A few prompts that work well:

- *"Set up paperback book margins, then check the layout."*
- *"Check the layout and fix anything that won't print cleanly."*
- *"Run a layout check before we export to PDF, and fix what doesn't pass."*
- *"This is a poster — use tight 10mm margins and rearrange so everything fits
  inside the safe zone."*
- *"My footer looks too close to the bottom edge. Fix the layout."*
- *"Make sure nothing overlaps and nothing falls outside the safe area."*

The assistant has tools to measure and patch your document. It will run the
checks, surface any blocks that need attention, and apply the fixes — you only
need to confirm the result in the preview.
