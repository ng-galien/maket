# Flex & Grid — Reference for Maket Documents

Maket documents are HTML with mm-based dimensions. Flex and grid work perfectly with mm units.

## Table of contents

1. [Flexbox essentials](#flexbox-essentials)
2. [Grid essentials](#grid-essentials)
3. [When to pick flex vs grid vs absolute](#when-to-use-what)
4. [Full-page patterns](#page-patterns)
5. [Overflow handling](#overflow)
6. [Common pitfalls](#pitfalls)

## Flexbox essentials

### Direction and alignment

```css
/* Vertical column — the most common for a page */
display: flex;
flex-direction: column;

/* Center children horizontally */
align-items: center;

/* Center vertically (when the container has a fixed height) */
justify-content: center;

/* Spacing between elements */
gap: 8mm;
```

### The 4 basic flex layouts

```css
/* 1. Centered stack — simple page */
display:flex; flex-direction:column; align-items:center; gap:8mm;

/* 2. Stack with footer at the bottom — with space-between */
display:flex; flex-direction:column; justify-content:space-between;

/* 3. Side by side — sidebar + content */
display:flex; flex-direction:row; gap:6mm;

/* 4. Centered in every direction — hero, splash */
display:flex; align-items:center; justify-content:center;
```

### flex: 1 — fill remaining space

```html
<!-- Body fills the space between header and footer -->
<div style="display:flex;flex-direction:column;height:297mm;">
  <header style="padding:10mm;">Header</header>
  <main style="flex:1;padding:10mm;">Content fills remaining space</main>
  <footer style="padding:10mm;">Footer</footer>
</div>
```

### flex-wrap — wrapping container

```html
<!-- Tags, badges, gallery -->
<div style="display:flex;flex-wrap:wrap;gap:3mm;">
  <span style="padding:2mm 4mm;background:#eee;border-radius:1mm;">Tag 1</span>
  <span style="padding:2mm 4mm;background:#eee;border-radius:1mm;">Tag 2</span>
  <!-- wraps to next line when container is full -->
</div>
```

## Grid essentials

### Fixed columns

```css
/* 2 equal columns */
display: grid;
grid-template-columns: 1fr 1fr;
gap: 6mm;

/* 3 equal columns */
grid-template-columns: repeat(3, 1fr);

/* Unequal columns (sidebar + main) */
grid-template-columns: 80mm 1fr;

/* Unequal columns (2/3 + 1/3) */
grid-template-columns: 2fr 1fr;
```

### Grid with span — mosaic

```html
<div style="display:grid;grid-template-columns:repeat(3, 1fr);grid-auto-rows:40mm;gap:3mm;">
  <!-- Large image: 2 columns, 2 rows -->
  <img style="grid-column:1/3;grid-row:1/3;width:100%;height:100%;object-fit:cover;" src="main.jpg" />
  <img style="width:100%;height:100%;object-fit:cover;" src="small1.jpg" />
  <img style="width:100%;height:100%;object-fit:cover;" src="small2.jpg" />
</div>
```

### place-items — quick centering

```css
/* Center a single child in a cell */
display: grid;
place-items: center;

/* Equivalent to flex center/center in a single line */
```

## When to use what

| Situation | Technique | Why |
|-----------|-----------|-----|
| Vertically stacked elements | `flex-direction:column` | Natural, simple gap, reflow |
| Header + content + footer | flex column + `flex:1` on content | Content fills remaining space |
| Sidebar + main | flex row | Two zones side by side |
| Card grid (equal size) | `grid` with `repeat(N, 1fr)` | Auto-equal columns |
| Image grid (varied sizes) | grid with `grid-column:span 2` | Span for large images |
| Centering a block | flex or grid with `place-items:center` | Simplest |
| Text overlaid on image | `position:relative` parent + `position:absolute` text | Intentional overlap |
| Decorative elements (rule, ornament) | `position:absolute` | Free positioning |
| Full-page background | `position:absolute;inset:0` | Covers the entire container |

## Page patterns

### A4 portrait page — standard flex column

```html
<div data-id="page" style="width:210mm;height:297mm;background:var(--charte-color-bg, #fff);
  display:flex;flex-direction:column;padding:var(--charte-spacing-page, 15mm);">

  <!-- Header -->
  <header data-id="header" style="display:flex;justify-content:space-between;align-items:center;">
    <span data-id="logo" style="font-size:5mm;font-weight:700;">Logo</span>
    <span data-id="date" style="font-size:3mm;">Date</span>
  </header>

  <!-- Content — fills remaining space -->
  <main data-id="content" style="flex:1;display:flex;flex-direction:column;
    gap:var(--charte-spacing-section, 8mm);margin-top:15mm;">
    <h1 data-id="titre" style="font-size:12mm;">Title</h1>
    <p data-id="body" style="font-size:4mm;line-height:1.6;">Body text</p>
  </main>

  <!-- Footer pinned to the bottom -->
  <footer data-id="footer" style="text-align:center;font-size:2.5mm;opacity:0.5;">
    Footer text
  </footer>
</div>
```

### A3 landscape page — 2-column grid

```html
<div data-id="page" style="width:420mm;height:297mm;
  display:grid;grid-template-columns:1fr 1fr;gap:0;">

  <!-- Left column: full image -->
  <div data-id="col-image" style="position:relative;overflow:hidden;">
    <img data-id="photo" src="photo.jpg" style="width:100%;height:100%;object-fit:cover;" />
  </div>

  <!-- Right column: content -->
  <div data-id="col-content" style="padding:25mm;display:flex;flex-direction:column;
    justify-content:center;gap:10mm;background:var(--charte-color-bg);">
    <h1 data-id="titre" style="font-size:14mm;">Title</h1>
    <p data-id="body" style="font-size:4mm;line-height:1.7;">Body</p>
  </div>
</div>
```

### Page with gallery — auto grid

```html
<div data-id="galerie" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(60mm, 1fr));
  gap:4mm;padding:15mm;">
  <img data-id="img1" src="a.jpg" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:2mm;" />
  <img data-id="img2" src="b.jpg" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:2mm;" />
  <img data-id="img3" src="c.jpg" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:2mm;" />
</div>
```

## Overflow

### Detecting overflow

`maket_html check` reports overflow from the browser. You can also anticipate it:
- Padding top + padding bottom + sum of fixed heights > page height → overflow
- Flex column without `flex-shrink` and too many children → overflow

### Fixing overflow

In order of preference:

1. **Reduce paddings/margins** — 2–3mm is often enough
2. **Reduce font-sizes** — keep the hierarchical ratio (title 2× body)
3. **Use `flex-shrink`** — images can shrink: `flex-shrink:1;min-height:0`
4. **Switch to 2 columns** — grid to distribute content laterally
5. **Add a page** — when content is genuinely too long

### Never do

- `overflow:hidden` on the main container — hides the problem instead of solving it
- `transform:scale(0.8)` to shrink everything — warps proportions and breaks PDF rendering

## Pitfalls

### gap doesn't work with position:absolute
Children in `position:absolute` are removed from the flow — `gap` doesn't affect them. That's the #1 sign you should switch to flex/grid.

### width:100% in flex vs grid
- In flex row: `width:100%` = 100% of the parent, can overflow if siblings exist
- In grid: `1fr` = proportional share, cannot overflow
- Prefer `flex:1` or grid `1fr` over `width:100%`

### mm heights on flex children
A flex child with `height:60mm` is rigid — it won't shrink when the parent overflows. Add `flex-shrink:1;min-height:0` to make it flexible, or use `max-height:60mm` instead.

### text-align:center vs align-items:center
- `text-align:center` → centers **inline** text inside a block
- `align-items:center` → centers **flex children** on the cross axis
- To center a title inside a page: both are often needed together

### margin:auto in flex
`margin-top:auto` on a flex child pushes it to the bottom of the container (like `justify-content:space-between` but for a single element). Useful to pin a footer to the bottom without affecting the rest.
