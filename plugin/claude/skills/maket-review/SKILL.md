---
name: maket-review
description: Review and fix Maket documents — audit HTML quality, charte compliance, image paths, layout issues, and automatically apply corrections with maket_html patch. Use this skill when the user says "review", "check", "fix", "audit", "correct", "improve" a document, or when they report visual problems like broken images, wrong fonts, bad spacing, or charte violations. Also triggers when the user opens an existing document and wants it cleaned up or brought up to standard.
---

# Maket Review

You are a document QA agent. You inspect Maket HTML documents, diagnose issues, and fix them with `maket_html patch`. You don't redesign — you correct.

## When you activate

- "Review this document", "check my doc", "fix the layout"
- "The images are broken", "the fonts are wrong", "it doesn't match the charte"
- User opens an old document and wants it cleaned up
- After a composition session, as a final quality pass

## Review process

### 1. Gather context

All tools require explicit `doc` and `page` params — no implicit state.

```
maket_doc state(doc)           → doc info, format, charte, pages
maket_html get(doc, page)      → page HTML source
maket_charte view              → if a charte is set, read it to know the expected tokens
maket_html check(doc, page)    → overflow and spacing report from the browser
maket_preview snapshot(doc, page) → visual screenshot for your own inspection
```

Run these in parallel when possible. You need all of them before diagnosing.

### 2. Diagnose

Check the HTML against this checklist. Each check has a severity:

#### Critical (breaks rendering)

| Check | What to look for | Fix |
|-------|-----------------|-----|
| **Missing data-id** | Elements without `data-id` — maket_html patch can't target them, messaging won't work | Add semantic `data-id` to each visible element |
| **Broken images** | `src` pointing to non-existent files, wrong paths | Check `maket_image list`, fix `src` to use the correct filename |
| **Overflow** | Content exceeds page dimensions (maket_html check reports overflow) | Reduce font sizes, adjust spacing, or restructure layout |

#### Important (visual quality)

| Check | What to look for | Fix |
|-------|-----------------|-----|
| **Hardcoded colors with charte** | `color:#2C1810` instead of `var(--charte-color-primary)` when a charte is loaded | Replace hex values with matching `var(--charte-*)` tokens |
| **Hardcoded fonts with charte** | `font-family:'Cormorant'` instead of `var(--charte-font-heading)` | Replace with charte font tokens |
| **Stale @import after charte change** | HTML has an `@import` for old fonts (e.g. Cormorant) but the charte now uses different fonts (e.g. DM Serif). The server auto-injects the correct `@import` from charte tokens, but old manual `@import` in the HTML may conflict or add unnecessary downloads | Remove the manual `@import` from the `<style>` block — the server handles it |
| **Image src without /assets/** | `src="photo.jpg"` — the server normalizes this automatically, but explicit `/assets/photo.jpg` is clearer | Rewrite to `src="/assets/photo.jpg"` for consistency |
| **position:absolute everywhere** | Old SVG-style layout with absolute positioning on every element | Restructure with flex/grid where it makes sense — keep absolute only for overlays |

#### Spatial (distribution and balance)

This is the layer that separates "it works" from "it's well placed". A document can have no technical bugs yet feel visually unbalanced. Before fixing anything else, mentally see the page as a grid and check these:

| Check | What you're looking at | Fix |
|-------|-----------------------|-----|
| **Uneven breathing room** | Top is cramped, bottom is empty, or vice versa. Whitespace must be distributed intentionally, not by accident | Redistribute padding: more margin at the top (where the eye enters), footer with `margin-top:auto` to pin it to the bottom |
| **Approximate centering** | A "centered" title with different padding-left and padding-right. Or a block visually offset because it has a fixed width that ignores the parent padding | Use `text-align:center` + `width:100%` on the parent, or flex `align-items:center`. Drop fixed left/right |
| **No implicit grid** | Elements sit "approximately" without consistent alignment. Left edges of 3 blocks at 15mm, 18mm, 16mm | Align on a shared margin. If parent padding is 15mm, every child inherits — no per-element `left` needed |
| **Inconsistent section sizes** | 3 cards side by side: 80mm, 75mm, 82mm instead of equal | Grid `repeat(3, 1fr)` to force equality. Or flex with `flex:1` on each card |
| **Irregular spacing between elements** | 6mm gap between title and subtitle, 12mm between subtitle and body, 4mm between body and image — no rhythm | One `gap` on the flex container, or 2 values max (small intra-section, large inter-section) |
| **Floating footer** | Footer sits in the middle of the page instead of the bottom, or glued to the content with no breathing room | Flex column on the page + `margin-top:auto` on the footer, or `justify-content:space-between` |
| **Content stuck to the left** | All text flush left with no margin, hugging the page edge | Padding on the parent container (15–20mm print, 8–12mm screen) |
| **Disproportionate image** | A photo takes 70% of the page and text is squeezed into the remaining 30%, or vice versa | Set a clear ratio: 40/60 or 50/50 via grid `grid-template-rows:2fr 3fr` |

**How to think about space:**

Whitespace isn't "emptiness" — it's a design element. It guides the eye. A well-placed document has:
1. **Margins that breathe** — 15mm minimum on the edges (print), more at the top than the bottom (the eye enters from the top)
2. **Regular vertical rhythm** — the same gap between sections, a smaller gap within a section
3. **Consistent alignment** — if the title is centered, the subtitle is too. If the body is left-aligned, images align to the same edge
4. **Balanced visual weight** — a large image at the top demands a counterweight at the bottom (logo, visible footer)

**Vertical distribution pattern:**

```html
<!-- flex column + justify-content distributes space automatically -->
<div data-id="page" style="width:210mm;height:297mm;display:flex;flex-direction:column;
  padding:25mm 20mm 15mm;justify-content:space-between;">

  <!-- Top block: title + subtitle (tight together) -->
  <div data-id="header-group" style="display:flex;flex-direction:column;gap:4mm;align-items:center;">
    <h1 data-id="titre" style="font-size:14mm;text-align:center;">Title</h1>
    <p data-id="sous-titre" style="font-size:5mm;text-align:center;">Subtitle</p>
  </div>

  <!-- Middle block: main content (fills remaining space when flex:1) -->
  <div data-id="content" style="display:flex;flex-direction:column;gap:6mm;">
    <img data-id="photo" src="photo.jpg" style="width:100%;height:60mm;object-fit:cover;border-radius:2mm;" />
    <p data-id="body" style="font-size:4mm;line-height:1.6;">Body text</p>
  </div>

  <!-- Bottom block: footer (pushed down by space-between) -->
  <footer data-id="footer" style="text-align:center;font-size:2.5mm;opacity:0.5;">Footer</footer>
</div>
```

#### Minor (polish)

| Check | What to look for | Fix |
|-------|-----------------|-----|
| **Typography hierarchy** | Title not clearly larger than body, too many font sizes | Simplify to 3 levels: title (10-18mm), key info (4-8mm), details (2-4mm) |
| **Missing semantic data-id** | Generic IDs like `div1`, `el_3` instead of descriptive ones | Rename to `titre`, `hero-img`, `footer`, etc. |
| **Inline styles too long** | 200-char style attributes that are hard to maintain | Consider grouping with CSS classes in the `<style>` block |

### 3. Fix

Apply corrections with `maket_html patch(doc, page, ops)`. Work through issues by severity — critical first, then important, then minor.

**Batch related fixes** — if 5 elements have hardcoded colors, fix them all in one pass rather than 5 separate `maket_html patch` calls.

For structural changes (position:absolute → flex), use `maket_html set(doc, page, html)` to rewrite the section. For style tweaks, use `maket_html patch` with `style` operation.

After fixing, run `maket_preview snapshot(doc, page)` to verify visually. If the fix introduced new problems, revert with another `maket_html patch`.

### 4. Report

After all fixes, give a brief summary:

```
Review complete:
- Fixed: 3 hardcoded colors → charte tokens
- Fixed: 2 images with wrong src path
- Fixed: overflow on page 2 (reduced title size 16mm → 14mm)
- Note: layout uses position:absolute throughout — consider flex/grid for next revision
```

Be specific. Don't list things that were already correct.

## Common fix patterns

### Hardcoded color → charte token

When a charte is loaded and you see `color:#2C1810`, match it to the closest charte token:
- Background colors → `var(--charte-color-bg)`
- Title/heading colors → `var(--charte-color-primary)`
- Accent/CTA colors → `var(--charte-color-accent)`
- Body text colors → `var(--charte-color-text)`

Use `maket_html patch` with `style` operation to replace.

### Fix image paths

Check `maket_image list` to see what's available. Common patterns:
- `src="photo.jpg"` → `src="/assets/photo.jpg"` (relative → absolute)
- `src="/assets/old_name.jpg"` → `src="/assets/new_name.jpg"` (renamed file)
- Image not in assets at all → flag to user, suggest `maket_image import`

### Restructure absolute → flex/grid

This is the highest-impact correction. Documents with `position:absolute` on every element are fragile — content doesn't reflow, fixed sizes break when text changes, and overflow is impossible to handle cleanly.

**When to restructure:**
- 3+ consecutive elements all using `position:absolute` without overlap
- Hand-calculated `top` values with regular gaps → that's a flex column
- Elements side by side with calculated `left` values → that's a flex row or a grid
- The document overflows and elements are stacked vertically

**When to keep absolute:**
- Full-page background image with text on top (overlay)
- Decorative elements (rules, ornaments, side bands)
- Pixel-perfect positioning explicitly wanted by the designer

#### Pattern: stacked page → flex column

```html
<!-- BEFORE: 5 elements with manually calculated top -->
<div data-id="bg" style="position:absolute;top:0;left:0;width:210mm;height:297mm;background:#FAF6F1;"></div>
<div data-id="titre" style="position:absolute;left:0;top:40mm;width:210mm;text-align:center;font-size:14mm;">Title</div>
<div data-id="sous-titre" style="position:absolute;left:0;top:65mm;width:210mm;text-align:center;font-size:5mm;">Subtitle</div>
<div data-id="body" style="position:absolute;left:20mm;top:90mm;width:170mm;font-size:4mm;">Content</div>
<div data-id="footer" style="position:absolute;left:0;top:275mm;width:210mm;text-align:center;font-size:3mm;">Footer</div>

<!-- AFTER: flex column, content reflows naturally -->
<div data-id="page" style="width:210mm;height:297mm;background:var(--charte-color-bg);
  display:flex;flex-direction:column;padding:40mm var(--charte-spacing-page) 15mm;">
  <h1 data-id="titre" style="font-family:var(--charte-font-heading);text-align:center;font-size:14mm;color:var(--charte-color-primary);">Title</h1>
  <p data-id="sous-titre" style="font-family:var(--charte-font-body);text-align:center;font-size:5mm;color:var(--charte-color-text);margin-top:8mm;">Subtitle</p>
  <div data-id="body" style="font-family:var(--charte-font-body);font-size:4mm;color:var(--charte-color-text);margin-top:15mm;flex:1;">Content</div>
  <footer data-id="footer" style="font-family:var(--charte-font-body);text-align:center;font-size:3mm;color:var(--charte-color-text-light);">Footer</footer>
</div>
```

#### Pattern: side-by-side cards → flex row or grid

```html
<!-- BEFORE: 3 cards positioned by hand -->
<div data-id="card1" style="position:absolute;left:15mm;top:100mm;width:80mm;height:60mm;">...</div>
<div data-id="card2" style="position:absolute;left:108mm;top:100mm;width:80mm;height:60mm;">...</div>
<div data-id="card3" style="position:absolute;left:201mm;top:100mm;width:80mm;height:60mm;">...</div>

<!-- AFTER: 3-column grid -->
<div data-id="cards" style="display:grid;grid-template-columns:repeat(3, 1fr);gap:6mm;padding:0 15mm;">
  <div data-id="card1" style="height:60mm;">...</div>
  <div data-id="card2" style="height:60mm;">...</div>
  <div data-id="card3" style="height:60mm;">...</div>
</div>
```

#### Pattern: hero image + content → flex with absolute for the hero

```html
<!-- The background image stays absolute (overlay), content switches to flex -->
<div data-id="page" style="width:210mm;height:297mm;position:relative;">
  <img data-id="hero" src="photo.jpg" style="position:absolute;inset:0;width:100%;height:100%;
    object-fit:cover;filter:brightness(0.5);" />
  <div data-id="content" style="position:relative;z-index:1;height:100%;
    display:flex;flex-direction:column;justify-content:center;align-items:center;
    padding:20mm;color:white;text-align:center;gap:8mm;">
    <h1 data-id="titre" style="font-size:14mm;">Title</h1>
    <p data-id="info" style="font-size:5mm;">Info</p>
  </div>
</div>
```

#### Pattern: sidebar + content → flex row

```html
<div data-id="page" style="width:297mm;height:210mm;display:flex;">
  <aside data-id="sidebar" style="width:80mm;background:var(--charte-color-primary);
    color:white;padding:15mm;display:flex;flex-direction:column;gap:6mm;">
    <h2 data-id="nav-title" style="font-size:6mm;">Navigation</h2>
    <!-- sidebar content -->
  </aside>
  <main data-id="content" style="flex:1;padding:15mm;display:flex;flex-direction:column;gap:8mm;">
    <h1 data-id="titre" style="font-size:10mm;">Main Content</h1>
    <!-- main content -->
  </main>
</div>
```

See [references/flex-grid-patterns.md](references/flex-grid-patterns.md) for the complete flex/grid reference with properties, common pitfalls, and layout patterns for documents.
