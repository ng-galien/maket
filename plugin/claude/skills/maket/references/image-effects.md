# Image Effects — CSS Recipes

Visual effects for images in Maket documents. All Puppeteer-compatible (PDF export).

## Combined filters

CSS filters stack. Order barely matters, but readability does.

### Warm mood
```css
filter: saturate(1.2) contrast(1.05) brightness(1.02) sepia(10%);
```
Slightly more vivid than the original, warm tint. For food, interiors.

### Cool / nordic mood
```css
filter: saturate(0.8) brightness(1.05) hue-rotate(10deg);
```
Slight shift toward blue, desaturated. For architecture, Scandinavian design.

### Dreamy / soft
```css
filter: contrast(0.9) brightness(1.1) saturate(0.7);
```
Low contrast, bright, pastel. For wellness, children, weddings.

### Dramatic / editorial
```css
filter: contrast(1.3) brightness(0.95) saturate(0.85);
```
High contrast, slightly darkened. For events, sports, music.

### Vintage / film
```css
filter: sepia(15%) contrast(1.1) saturate(0.9) brightness(1.05);
```
Light sepia tone, like a silver print. For craft, wines, boutique hospitality.

## Masks and cuts

### Dynamic angle
```css
clip-path: polygon(0 0, 100% 0, 100% 85%, 0 100%);
```
Diagonal cut at the bottom — gives motion to a static image.

### Arch / vault
```css
border-radius: 50% 50% 0 0 / 30% 30% 0 0;
```
Rounded corners only at the top, like an arched window. Elegant for architecture.

### Hexagon
```css
clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
```
For creative grids, profile thumbnails.

## Gradients on images

### Fade to bottom (for text)
```html
<div style="position:relative;">
  <img src="photo.jpg" style="width:100%;height:80mm;object-fit:cover;" />
  <div style="position:absolute;inset:0;
    background:linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.7) 100%);" />
</div>
```

### Lateral fade (image + text side by side)
```html
<div style="position:relative;">
  <img src="photo.jpg" style="width:100%;height:60mm;object-fit:cover;" />
  <div style="position:absolute;inset:0;
    background:linear-gradient(to right, var(--charte-color-bg) 0%, transparent 40%);" />
</div>
```

### Brand-color fade
```html
<div style="position:absolute;inset:0;
  background:linear-gradient(135deg, var(--charte-color-primary) 0%, transparent 60%);
  mix-blend-mode:multiply;opacity:0.4;" />
```

## Image grids

### 2 columns with gap
```html
<div data-id="galerie" style="display:grid;grid-template-columns:1fr 1fr;gap:3mm;">
  <img data-id="img1" src="a.jpg" style="width:100%;height:50mm;object-fit:cover;border-radius:2mm;" />
  <img data-id="img2" src="b.jpg" style="width:100%;height:50mm;object-fit:cover;border-radius:2mm;" />
</div>
```

### Asymmetric mosaic
```html
<div data-id="mosaic" style="display:grid;grid-template-columns:2fr 1fr;grid-template-rows:40mm 40mm;gap:2mm;">
  <img data-id="img-main" src="a.jpg" style="grid-row:1/3;width:100%;height:100%;object-fit:cover;border-radius:2mm;" />
  <img data-id="img-top" src="b.jpg" style="width:100%;height:100%;object-fit:cover;border-radius:2mm;" />
  <img data-id="img-bottom" src="c.jpg" style="width:100%;height:100%;object-fit:cover;border-radius:2mm;" />
</div>
```

### Panoramic band
```html
<img data-id="pano" src="landscape.jpg" style="width:100%;height:30mm;
  object-fit:cover;object-position:center 30%;" />
```

## Border effects

### Frame with spacing (mat / passe-partout)
```html
<div data-id="cadre" style="padding:3mm;background:white;box-shadow:0 1mm 4mm rgba(0,0,0,0.1);">
  <img src="photo.jpg" style="width:100%;display:block;" />
</div>
```

### Accent border
```html
<img src="photo.jpg" style="border:0.5mm solid var(--charte-color-accent);border-radius:1mm;" />
```

### Polaroid
```html
<div data-id="polaroid" style="background:white;padding:2mm 2mm 8mm 2mm;
  box-shadow:0 1mm 6mm rgba(0,0,0,0.12);transform:rotate(-2deg);">
  <img src="photo.jpg" style="width:60mm;height:50mm;object-fit:cover;display:block;" />
</div>
```

## Text and image — compositions

### Floating text with semi-transparent backdrop
```html
<div style="position:relative;">
  <img src="photo.jpg" style="width:100%;height:70mm;object-fit:cover;" />
  <div style="position:absolute;bottom:4mm;left:4mm;right:4mm;
    background:rgba(255,255,255,0.92);backdrop-filter:blur(2px);
    padding:4mm;border-radius:2mm;">
    <h2 style="font-size:5mm;margin:0;">Title</h2>
    <p style="font-size:3mm;margin-top:1mm;">Short description</p>
  </div>
</div>
```

### Background image with centered text
```html
<div data-id="hero" style="position:relative;width:100%;height:100mm;overflow:hidden;">
  <img src="photo.jpg" style="position:absolute;inset:0;width:100%;height:100%;
    object-fit:cover;filter:brightness(0.5) saturate(0.8);" />
  <div style="position:relative;z-index:1;height:100%;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    color:white;text-align:center;padding:10mm;">
    <h1 style="font-size:12mm;font-weight:300;">Grand Title</h1>
    <p style="font-size:4mm;margin-top:3mm;opacity:0.85;">Elegant subtitle</p>
  </div>
</div>
```
