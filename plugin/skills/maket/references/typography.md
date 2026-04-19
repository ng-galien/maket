# Typography Cheatsheet

Font sizing and CSS patterns for Maket HTML canvas.

## Loading fonts

```html
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,700;1,300;1,400&family=Source+Sans+3:wght@300;400;600&display=swap');
</style>
```

## Font families

### Serif
| Font | CSS | Best for |
|------|-----|----------|
| Cormorant Garamond | `'Cormorant Garamond', Georgia, serif` | Elegant, wine, artisan |
| Libre Baskerville | `'Libre Baskerville', Georgia, serif` | Editorial, classic |
| Playfair Display | `'Playfair Display', Georgia, serif` | Luxe, magazine |
| Lora | `'Lora', Georgia, serif` | Body text, brochures |
| Cinzel | `'Cinzel', serif` | Roman capitals, ceremonies |

### Sans-serif
| Font | CSS | Best for |
|------|-----|----------|
| Source Sans 3 | `'Source Sans 3', system-ui, sans-serif` | Body text, universal |
| Montserrat | `'Montserrat', system-ui, sans-serif` | Modern titles |
| Raleway | `'Raleway', system-ui, sans-serif` | Minimal, fashion |
| Oswald | `'Oswald', system-ui, sans-serif` | Condensed, impactful |

### Display
| Font | CSS | Best for |
|------|-----|----------|
| Bebas Neue | `'Bebas Neue', sans-serif` | Block uppercase |
| Caveat | `'Caveat', cursive` | Handwritten |

## Size guide (font-size in mm)

| Role | A2 | A3 | A4 | A5 | A6 | A7 | A8 | MOBILE |
|------|-----|-----|-----|-----|-----|-----|-----|--------|
| Title | 14–20 | 12–18 | 10–14 | 8–12 | 6–10 | 5–8 | 4–6 | 12–16 |
| Subtitle | 8–12 | 6–9 | 5–7 | 4–6 | 3.5–5 | 3–4 | 2.5–3.5 | 4–6 |
| Body | 5–6 | 4.2–5 | 3.5–4.5 | 3.2–4 | 2.8–3.5 | 2.5–3 | 2.2–2.8 | 3–4 |
| Caption | 3.5–4.5 | 3–3.5 | 2.8–3.5 | 2.5–3 | 2.2–2.8 | 2–2.5 | 1.8–2.2 | 2–3 |

**Rules:**
- Title >= 2× body size.
- Body minimum: 3.5mm (A4), 4.2mm (A3), 5mm (A2). Below 2.8mm is hard to read in print.
- Caption minimum: 2.8mm (A4+), 2.1mm absolute floor (6pt).
- Reversed text (light on dark): add ~0.3mm to minimum sizes.
- Sans-serif stays legible at smaller sizes than serif.

## CSS patterns

### Centered text
```html
<div data-id="titre" style="position:absolute;left:0;top:40mm;width:210mm;
  text-align:center;font-family:'Cormorant Garamond',Georgia,serif;
  font-size:14mm;font-weight:300;color:#2C1810;line-height:1.1;">
  Title
</div>
```

### Uppercase spaced label
```html
<div data-id="label" style="position:absolute;left:0;top:60mm;width:210mm;
  text-align:center;font-family:'Source Sans 3',system-ui,sans-serif;
  font-size:2.5mm;font-weight:600;letter-spacing:2mm;
  color:#8B4513;text-transform:uppercase;">
  CATEGORY
</div>
```

### Italic accent
```html
<div data-id="parfum" style="position:absolute;left:0;top:75mm;width:210mm;
  text-align:center;font-family:'Cormorant Garamond',Georgia,serif;
  font-size:5mm;font-style:italic;color:#722F37;">
  Santal · Bergamote
</div>
```

## Spacing

| Between | Gap |
|---------|-----|
| Title → subtitle | 5–8mm |
| Subtitle → separator | 6–10mm |
| Separator → body | 5–8mm |
| Body → footer | 15–25mm |
| Canvas edge → content | 10–15mm (print), 8–12mm (screen) |

## Ornament characters

| Char | Use |
|------|-----|
| ✦ | Star separator |
| ♦ / ♢ | Diamond separator |
| · | Middle dot (item separator) |
| « » | French quotes |
