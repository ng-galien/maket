# Typography Pairings — Google Fonts

Every pairing below is on Google Fonts (free, available via `@import`).

## How to pick

### Serif = tradition, elegance, editorial
Evokes luxury, craft, culture. Display serifs (Cormorant, Playfair) are spectacular at large sizes but unreadable small.

### Sans-serif = modernity, clarity, tech
Functional, neutral, professional. Geometric sans-serifs (Inter, DM Sans) are versatile.

### The rule: contrast or consistency
- **Contrast**: serif heading + sans-serif body → the classic, works almost every time
- **Consistency**: same family for both → modern, minimal, needs a versatile font (Inter, Source Sans)

## Pairings by style

### Luxury / Elegant
```
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400&family=Source+Sans+3:wght@300;400;600&display=swap');
```
- Heading: `'Cormorant Garamond', Georgia, serif` (300–700)
- Body: `'Source Sans 3', system-ui, sans-serif` (300–600)
- Vibe: refined, timeless, high-end

### Luxury / Modern
```
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Lato:wght@300;400;700&display=swap');
```
- Heading: `'Playfair Display', Georgia, serif` (400–700)
- Body: `'Lato', system-ui, sans-serif` (300–700)
- Vibe: contemporary chic, magazine

### Modern / Clean
```
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
```
- Heading: `'Inter', system-ui, sans-serif` (600–700)
- Body: `'Inter', system-ui, sans-serif` (300–400)
- Vibe: tech, startup, dashboard, UI

### Tech / Geometric
```
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=DM+Sans:wght@300;400;500;700&display=swap');
```
- Heading: `'Space Grotesk', system-ui, sans-serif` (500–700)
- Body: `'DM Sans', system-ui, sans-serif` (300–500)
- Vibe: startup, innovation, crypto

### Artisanal / Warm
```
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Nunito:wght@300;400;600&display=swap');
```
- Heading: `'Playfair Display', Georgia, serif` (400–700)
- Body: `'Nunito', system-ui, sans-serif` (300–600)
- Vibe: bakery, fine grocer, craft

### Editorial / Culture
```
@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Source+Serif+4:ital,wght@0,300;0,400;0,600;1,400&display=swap');
```
- Heading: `'Libre Baskerville', Georgia, serif` (400–700)
- Body: `'Source Serif 4', Georgia, serif` (300–600)
- Vibe: newspaper, magazine, literary

### Bold / Events
```
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;700&family=Nunito+Sans:wght@300;400;600;700&display=swap');
```
- Heading: `'Oswald', system-ui, sans-serif` (500–700)
- Body: `'Nunito Sans', system-ui, sans-serif` (300–600)
- Vibe: festival, sports, concert

### Nature / Organic
```
@import url('https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,300;0,400;0,700;1,300&family=Open+Sans:wght@300;400;600&display=swap');
```
- Heading: `'Merriweather', Georgia, serif` (300–700)
- Body: `'Open Sans', system-ui, sans-serif` (300–600)
- Vibe: organic, nature, camping, garden

### Minimal / Zen
```
@import url('https://fonts.googleapis.com/css2?family=Raleway:wght@200;300;400;600&family=Work+Sans:wght@300;400;500&display=swap');
```
- Heading: `'Raleway', system-ui, sans-serif` (200–600)
- Body: `'Work Sans', system-ui, sans-serif` (300–500)
- Vibe: yoga, spa, architecture, design

### Premium / Finance
```
@import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');
```
- Heading: `'EB Garamond', Georgia, serif` (400–700)
- Body: `'IBM Plex Sans', system-ui, sans-serif` (300–600)
- Vibe: banking, insurance, consulting, corporate

## Sizing rules

| Element | Print format (A3/A4) | Screen format (Desktop/Mobile) |
|---------|----------------------|--------------------------------|
| Main title | 12–18mm | 8–14mm |
| Subtitle | 6–10mm | 5–8mm |
| Body text | 3.5–5mm | 3–4.5mm |
| Caption / fine print | 2–3mm | 2–2.5mm |
| Title→body spacing | 1.5× body size | same |

## Common mistakes

- More than 2 font families → visual chaos
- Heading and body too close in size → no hierarchy
- Display font used as body text → unreadable small (Cormorant < 5mm = illegible)
- No fallback after the Google Font → always append `Georgia, serif` or `system-ui, sans-serif`
- Forgetting the `@import` → fonts don't load in PDF export
