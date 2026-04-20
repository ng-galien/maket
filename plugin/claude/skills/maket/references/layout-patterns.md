# Layout Patterns

Modern layout structures using flex and grid. All dimensions in mm.
Images use bare filenames as `src` — the server resolves them to `/assets/`.

> **Critical CSS rule for images in flex/grid:** Always add `min-height:0` (in column flex) or `min-width:0` (in row flex / grid) on `<img>` elements. Without this, images refuse to shrink below their intrinsic size and blow out the layout.

---

## 1. Centered hero — Poster / Event (A3 portrait)

Vertical flex, everything centered. Classic for events, concerts, announcements.

```html
<div data-id="page" style="width:297mm;height:420mm;
  background:linear-gradient(180deg, rgba(0,0,0,0.3), rgba(0,0,0,0.8));
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:30mm 25mm;gap:var(--charte-spacing-section);text-align:center;">

  <h1 data-id="titre" style="font-family:var(--charte-font-heading);
    font-size:16mm;font-weight:bold;color:var(--charte-color-primary);line-height:1.15;">
    Event Title
  </h1>

  <p data-id="sous-titre" style="font-family:var(--charte-font-body);
    font-size:7mm;font-weight:600;color:var(--charte-color-text);">
    Date · Location
  </p>

  <div data-id="sep" style="width:60mm;height:0.3mm;background:var(--charte-color-accent);"></div>

  <p data-id="details" style="font-family:var(--charte-font-body);
    font-size:4.5mm;font-weight:300;color:var(--charte-color-text-light);line-height:1.7;max-width:240mm;">
    Program details here
  </p>
</div>
```

## 2. Hero image + content below (A4 portrait)

Top image, content below in flex column. Natural flow, no absolute needed.

```html
<div data-id="page" style="width:210mm;height:297mm;background:var(--charte-color-bg);
  display:flex;flex-direction:column;">

  <img data-id="hero" src="photo.jpg" style="width:100%;height:120mm;
    object-fit:cover;flex:none;" />

  <div data-id="content" style="flex:1;padding:var(--charte-spacing-page);
    display:flex;flex-direction:column;gap:var(--charte-spacing-section);">

    <h1 data-id="titre" style="font-family:var(--charte-font-heading);
      font-size:12mm;color:var(--charte-color-primary);">
      Title
    </h1>

    <p data-id="body" style="font-family:var(--charte-font-body);
      font-size:4mm;color:var(--charte-color-text);line-height:1.6;">
      Body text
    </p>

    <div data-id="cta" style="margin-top:auto;padding:4mm 8mm;
      background:var(--charte-color-accent);color:white;border-radius:2mm;
      font-family:var(--charte-font-body);font-size:4mm;font-weight:600;align-self:flex-start;">
      Call to action
    </div>
  </div>
</div>
```

## 3. Split layout — 60/40 (A4 landscape)

Two-column split: image left, content right. Use flex with fixed proportions.

```html
<div data-id="page" style="width:297mm;height:210mm;background:var(--charte-color-bg);
  display:flex;">

  <img data-id="photo" src="photo.jpg" style="flex:0 0 60%;object-fit:cover;min-width:0;" />

  <div data-id="content" style="flex:1;padding:var(--charte-spacing-page);
    display:flex;flex-direction:column;justify-content:center;gap:var(--charte-spacing-section);">

    <p data-id="label" style="font-family:var(--charte-font-body);font-size:4.2mm;
      text-transform:uppercase;letter-spacing:1.5mm;color:var(--charte-color-accent);">
      Category
    </p>

    <h1 data-id="titre" style="font-family:var(--charte-font-heading);
      font-size:12mm;color:var(--charte-color-primary);line-height:1.15;">
      Title
    </h1>

    <p data-id="body" style="font-family:var(--charte-font-body);
      font-size:4mm;color:var(--charte-color-text);line-height:1.6;">
      Description text
    </p>
  </div>
</div>
```

## 4. Bento grid — Feature showcase (A4 portrait)

Modular blocks of varying sizes. Inspired by Apple-style feature grids. Use CSS Grid with `span`.

```html
<div data-id="page" style="width:210mm;height:297mm;background:var(--charte-color-bg);
  display:grid;grid-template-columns:1fr 1fr;grid-template-rows:auto 1fr 1fr 1fr;
  gap:4mm;padding:var(--charte-spacing-page);">

  <h1 data-id="titre" style="grid-column:span 2;
    font-family:var(--charte-font-heading);font-size:12mm;color:var(--charte-color-primary);
    padding:5mm 0;">
    Features
  </h1>

  <!-- Large feature block — spans 2 columns -->
  <div data-id="feature-main" style="grid-column:span 2;
    background:var(--charte-color-border);border-radius:4mm;padding:10mm;
    display:flex;align-items:center;gap:8mm;">
    <img data-id="feat-img" src="photo.jpg" style="width:60mm;height:60mm;
      object-fit:cover;border-radius:3mm;flex:none;" />
    <div>
      <h2 style="font-family:var(--charte-font-heading);font-size:7mm;
        color:var(--charte-color-primary);margin-bottom:3mm;">Main Feature</h2>
      <p style="font-family:var(--charte-font-body);font-size:4.5mm;
        color:var(--charte-color-text-light);line-height:1.5;">Description</p>
    </div>
  </div>

  <!-- Smaller blocks -->
  <div data-id="feat-1" style="background:var(--charte-color-border);border-radius:4mm;padding:8mm;
    display:flex;flex-direction:column;justify-content:flex-end;">
    <h3 style="font-family:var(--charte-font-heading);font-size:5mm;
      color:var(--charte-color-primary);">Feature 1</h3>
    <p style="font-family:var(--charte-font-body);font-size:4.2mm;
      color:var(--charte-color-text-light);">Detail</p>
  </div>

  <div data-id="feat-2" style="background:var(--charte-color-border);border-radius:4mm;padding:8mm;
    display:flex;flex-direction:column;justify-content:flex-end;">
    <h3 style="font-family:var(--charte-font-heading);font-size:5mm;
      color:var(--charte-color-primary);">Feature 2</h3>
    <p style="font-family:var(--charte-font-body);font-size:4.2mm;
      color:var(--charte-color-text-light);">Detail</p>
  </div>

  <div data-id="feat-3" style="background:var(--charte-color-border);border-radius:4mm;padding:8mm;
    display:flex;flex-direction:column;justify-content:flex-end;">
    <h3 style="font-family:var(--charte-font-heading);font-size:5mm;
      color:var(--charte-color-primary);">Feature 3</h3>
    <p style="font-family:var(--charte-font-body);font-size:4.2mm;
      color:var(--charte-color-text-light);">Detail</p>
  </div>

  <div data-id="feat-4" style="background:var(--charte-color-border);border-radius:4mm;padding:8mm;
    display:flex;flex-direction:column;justify-content:flex-end;">
    <h3 style="font-family:var(--charte-font-heading);font-size:5mm;
      color:var(--charte-color-primary);">Feature 4</h3>
    <p style="font-family:var(--charte-font-body);font-size:4.2mm;
      color:var(--charte-color-text-light);">Detail</p>
  </div>
</div>
```

## 5. Photo grid — Gallery (A4 portrait)

Equal-weight photo gallery. The key trick: `min-height:0` and `min-width:0` on every `<img>` inside flex.

```html
<div data-id="page" style="width:210mm;height:297mm;background:var(--charte-color-bg);
  display:flex;flex-direction:column;padding:var(--charte-spacing-page);gap:4mm;">

  <h1 data-id="titre" style="font-family:var(--charte-font-heading);font-size:10mm;
    color:var(--charte-color-primary);text-align:center;
    text-transform:uppercase;letter-spacing:1mm;flex:none;">
    Gallery
  </h1>

  <!-- Row: 2/3 + 1/3 split -->
  <div data-id="row1" style="display:flex;gap:4mm;flex:1;min-height:0;">
    <img data-id="img1" src="photo1.jpg" style="flex:2;min-width:0;object-fit:cover;border-radius:3mm;" />
    <img data-id="img2" src="photo2.jpg" style="flex:1;min-width:0;object-fit:cover;border-radius:3mm;" />
  </div>

  <!-- Row: 3 equal -->
  <div data-id="row2" style="display:flex;gap:4mm;flex:1;min-height:0;">
    <img data-id="img3" src="photo3.jpg" style="flex:1;min-width:0;object-fit:cover;border-radius:3mm;" />
    <img data-id="img4" src="photo4.jpg" style="flex:1;min-width:0;object-fit:cover;border-radius:3mm;" />
    <img data-id="img5" src="photo5.jpg" style="flex:1;min-width:0;object-fit:cover;border-radius:3mm;" />
  </div>
</div>
```

## 6. Editorial — Magazine spread (A4 landscape)

Asymmetric grid with text overlapping image. Uses CSS Grid for 2D placement.

```html
<div data-id="page" style="width:297mm;height:210mm;background:var(--charte-color-bg);
  display:grid;grid-template-columns:1fr 1fr 1fr;grid-template-rows:1fr 1fr;
  gap:0;overflow:hidden;">

  <!-- Image spans left 2 columns, full height -->
  <img data-id="hero" src="photo.jpg" style="grid-column:1/3;grid-row:1/3;
    width:100%;height:100%;object-fit:cover;" />

  <!-- Text block overlaps into image area -->
  <div data-id="content" style="grid-column:2/4;grid-row:1/3;
    padding:20mm 15mm;display:flex;flex-direction:column;justify-content:center;gap:5mm;
    background:linear-gradient(to right, transparent 0%, var(--charte-color-bg) 30%);">

    <p data-id="label" style="font-family:var(--charte-font-body);font-size:4.2mm;
      text-transform:uppercase;letter-spacing:2mm;color:var(--charte-color-accent);">
      Category
    </p>

    <h1 data-id="titre" style="font-family:var(--charte-font-heading);
      font-size:14mm;color:var(--charte-color-primary);line-height:1.1;">
      Editorial Title
    </h1>

    <p data-id="body" style="font-family:var(--charte-font-body);
      font-size:4mm;color:var(--charte-color-text);line-height:1.7;max-width:120mm;">
      Body text flows alongside the image, creating an editorial feel.
    </p>
  </div>
</div>
```

## 7. Cards row — Services / Team (A4 portrait)

Repeating card pattern in flex wrap. Good for services, team, features.

```html
<div data-id="page" style="width:210mm;height:297mm;background:var(--charte-color-bg);
  display:flex;flex-direction:column;padding:var(--charte-spacing-page);gap:var(--charte-spacing-section);">

  <h1 data-id="titre" style="font-family:var(--charte-font-heading);
    font-size:10mm;color:var(--charte-color-primary);text-align:center;">
    Our Services
  </h1>

  <div data-id="cards" style="display:flex;gap:6mm;flex:1;">

    <div data-id="card-1" style="flex:1;background:var(--charte-color-bg);border-radius:3mm;
      box-shadow:0 1mm 4mm rgba(0,0,0,0.08);padding:8mm;
      display:flex;flex-direction:column;gap:4mm;">
      <img data-id="card-img-1" src="icon1.jpg" style="width:20mm;height:20mm;
        object-fit:cover;border-radius:50%;" />
      <h3 style="font-family:var(--charte-font-heading);font-size:5mm;
        color:var(--charte-color-primary);">Service 1</h3>
      <p style="font-family:var(--charte-font-body);font-size:4.5mm;
        color:var(--charte-color-text);line-height:1.5;">Description</p>
    </div>

    <div data-id="card-2" style="flex:1;background:var(--charte-color-bg);border-radius:3mm;
      box-shadow:0 1mm 4mm rgba(0,0,0,0.08);padding:8mm;
      display:flex;flex-direction:column;gap:4mm;">
      <img data-id="card-img-2" src="icon2.jpg" style="width:20mm;height:20mm;
        object-fit:cover;border-radius:50%;" />
      <h3 style="font-family:var(--charte-font-heading);font-size:5mm;
        color:var(--charte-color-primary);">Service 2</h3>
      <p style="font-family:var(--charte-font-body);font-size:4.5mm;
        color:var(--charte-color-text);line-height:1.5;">Description</p>
    </div>

    <div data-id="card-3" style="flex:1;background:var(--charte-color-bg);border-radius:3mm;
      box-shadow:0 1mm 4mm rgba(0,0,0,0.08);padding:8mm;
      display:flex;flex-direction:column;gap:4mm;">
      <img data-id="card-img-3" src="icon3.jpg" style="width:20mm;height:20mm;
        object-fit:cover;border-radius:50%;" />
      <h3 style="font-family:var(--charte-font-heading);font-size:5mm;
        color:var(--charte-color-primary);">Service 3</h3>
      <p style="font-family:var(--charte-font-body);font-size:4.5mm;
        color:var(--charte-color-text);line-height:1.5;">Description</p>
    </div>
  </div>
</div>
```

## 8. Full-bleed hero with text overlay (A4 portrait)

Image covers the page, text floats on top with gradient scrim. Use position:relative + absolute (this is the valid use case for absolute).

```html
<div data-id="page" style="width:210mm;height:297mm;position:relative;overflow:hidden;">

  <img data-id="bg-photo" src="hero.jpg" style="position:absolute;inset:0;
    width:100%;height:100%;object-fit:cover;" />

  <div data-id="scrim" style="position:absolute;inset:0;
    background:linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 50%);" />

  <div data-id="content" style="position:absolute;bottom:0;left:0;right:0;
    padding:20mm 15mm;display:flex;flex-direction:column;gap:5mm;">

    <h1 data-id="titre" style="font-family:var(--charte-font-heading);
      font-size:14mm;color:white;line-height:1.1;">
      Big Title
    </h1>

    <p data-id="sous-titre" style="font-family:var(--charte-font-body);
      font-size:5mm;color:rgba(255,255,255,0.85);">
      Subtitle text
    </p>
  </div>
</div>
```

## 9. Sidebar layout (A4 portrait)

Colored sidebar with navigation/branding, main content area. Use flex.

```html
<div data-id="page" style="width:210mm;height:297mm;display:flex;">

  <div data-id="sidebar" style="flex:0 0 50mm;background:var(--charte-color-primary);
    padding:var(--charte-spacing-page) 8mm;display:flex;flex-direction:column;
    gap:var(--charte-spacing-section);color:var(--charte-color-bg);">

    <h2 data-id="brand" style="font-family:var(--charte-font-heading);
      font-size:6mm;font-weight:700;">Brand</h2>

    <nav data-id="nav" style="display:flex;flex-direction:column;gap:4mm;margin-top:auto;">
      <span style="font-family:var(--charte-font-body);font-size:4.2mm;opacity:0.7;">Section 1</span>
      <span style="font-family:var(--charte-font-body);font-size:4.2mm;opacity:0.7;">Section 2</span>
      <span style="font-family:var(--charte-font-body);font-size:4.2mm;opacity:0.7;">Section 3</span>
    </nav>
  </div>

  <div data-id="main" style="flex:1;padding:var(--charte-spacing-page);
    display:flex;flex-direction:column;gap:var(--charte-spacing-section);">

    <h1 data-id="titre" style="font-family:var(--charte-font-heading);
      font-size:10mm;color:var(--charte-color-primary);">
      Page Title
    </h1>

    <p data-id="body" style="font-family:var(--charte-font-body);
      font-size:4mm;color:var(--charte-color-text);line-height:1.6;">
      Content here
    </p>
  </div>
</div>
```

---

## CSS cheatsheet — Flex & Grid in mm

### Flex basics
```css
display:flex;flex-direction:column;gap:6mm;    /* vertical stack */
display:flex;gap:4mm;                          /* horizontal row */
align-items:center;                            /* cross-axis center */
justify-content:center;                        /* main-axis center */
justify-content:space-between;                 /* spread items */
flex:none;                                     /* don't grow/shrink (fixed-height headers) */
flex:1;min-height:0;                           /* grow AND allow shrink (images!) */
flex:0 0 60%;                                  /* fixed proportion */
margin-top:auto;                               /* push to bottom (footer, CTA) */
```

### Grid basics
```css
display:grid;grid-template-columns:1fr 1fr;gap:4mm;        /* 2 equal columns */
display:grid;grid-template-columns:1fr 2fr;gap:4mm;        /* 1/3 + 2/3 */
display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;  /* 3 equal columns */
grid-column:span 2;                                         /* span 2 columns (bento) */
grid-row:span 2;                                            /* span 2 rows */
grid-column:1/3;grid-row:1/3;                               /* explicit placement (editorial) */
```

### Image rules
```css
object-fit:cover;         /* always — fills container, crops excess */
min-width:0;              /* required in flex row — allows shrink */
min-height:0;             /* required in flex column — allows shrink */
flex:none;                /* fixed-size image (won't grow/shrink) */
```
