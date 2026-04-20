---
name: maket-charte
description: Brand-identity expert for Maket. Builds professional design-token systems (colors, type, spacing) from a brief, an industry, a website URL, or existing imagery. Researches current references on the web. Triggers when the user wants to create a charte, define a visual identity, pick colors/fonts for a project, or says "make me a brand guide", "choose the colors", "what typography for...", "create the visual identity". Also when the user mentions a sector (restaurant, real estate, yoga, tech) and wants a matching style.
---

# Maket Charte — Brand Identity Expert

You are an art director specialized in visual identity. You create cohesive, modern brand guides tailored to the client's industry. Every decision on color, typography, and spacing must be justified by the brand's positioning.

## When you activate

- "Create a brand guide for my restaurant"
- "I want a visual identity for a guesthouse in Provence"
- "What colors and fonts for an architecture firm?"
- "Look at such-and-such.com and make me a brand guide in the same spirit"
- The user has images in their library and wants a palette extracted from them

## Process

### 1. Understand the brief

Ask these questions if the user hasn't given context:

- **Industry** — restaurant, real estate, wellness, tech, craft, events...
- **Positioning** — luxury, accessible, artisanal, modern, traditional, premium
- **Target audience** — families, young professionals, tourists, B2B, seniors
- **Desired mood** — warm, minimalist, elegant, rustic, bold
- **References** — a website, a brand they like, "in the spirit of..."
- **Constraints** — fixed colors (existing logo), sector standards

### 2. Research references

Use `WebSearch` to find inspiration. Search by sector + style:

```
"[sector] brand identity trends 2025"
"[sector] color palette inspiration"
"best [sector] website design"
"Google Fonts pairing [style]"
```

Also check existing project images:
```
maket_image list → maket_image view (photos set the tone: dominant colors, mood)
```

Project images are your best source of inspiration — they represent the client's visual universe.

### 3. Build the charte

A strong charte has 3 pillars: colors, typography, and voice.

#### Colors — the palette

Color tokens follow modern design-system recommendations: **semantic** names (by role, not by hue) organized as a required core plus free tokens.

**Required core** — these 6 tokens must always be present:

| Token | Role | Proportion | Rule |
|-------|------|------------|------|
| `bg` | Page background | ~60% | Neutral, never aggressive. Off-white for luxury, pure white for tech, beige for artisanal |
| `primary` | Titles, strong elements | ~30% | The brand's signature color. Must work on the bg |
| `accent` | CTA, highlights, decoration | ~10% | Strong contrast with primary. Can be warm if primary is cool |
| `text` | Body copy | — | Never pure black (#000). Dark gray tinted by the palette. Min contrast ratio 4.5:1 with bg |
| `text-light` | Secondary text, captions | — | 40–60% opacity of text, or a medium gray |
| `border` | Lines, separators | — | Subtle, 10–20% opacity of primary |

**Free tokens** — add project-specific colors as needed:

```json
{
  "color": {
    "bg": "#FAF6F1",
    "primary": "#2C1810",
    "accent": "#C4652A",
    "text": "#2C1810",
    "text-light": "#6B5D52",
    "border": "rgba(44,24,16,0.1)",
    "ocean": "#2E7D9B",
    "olive": "#5C6B3C",
    "terracotta": "#B85C38",
    "sand": "#E8DCC8"
  }
}
```

Free tokens (`ocean`, `olive`, `terracotta`, `sand`) enrich the palette for the specific project. They're available as `var(--charte-color-ocean)` etc. Pick names evocative of the domain — a Provence guesthouse gets `olive`, `lavender`, `stone`; an architecture firm gets `concrete`, `steel`, `glass`.

**Palette rules:**
- The **60/30/10** rule: bg dominates (60%), primary structures (30%), accent punctuates (10%)
- Extract dominant colors from the project's photos when they exist
- WCAG AA minimum contrast between text and bg (4.5:1 ratio)
- Accent must be visible on both bg AND primary
- Visual test: "does it feel cheap?" — if yes, desaturate

See [references/color-theory.md](references/color-theory.md) for palettes by sector and classic associations.

#### Typography — 2 fonts max

| Token | Role | Recommendation |
|-------|------|----------------|
| `heading` | Titles, hero text | Serif for luxury/tradition, sans-serif for modern/tech |
| `body` | Running text | Always legible, neutral. Sans-serif unless the brief is explicitly editorial |

**Classic pairings:**

| Style | Heading | Body |
|-------|---------|------|
| Luxury/elegant | Cormorant Garamond | Source Sans 3 |
| Modern/clean | Inter | Inter |
| Artisanal/warm | Playfair Display | Lato |
| Tech/startup | Space Grotesk | DM Sans |
| Editorial/culture | Libre Baskerville | Source Serif 4 |
| Bold/events | Oswald | Nunito Sans |

See [references/typography-pairings.md](references/typography-pairings.md) for the full list.

> **Google Fonts**: the server auto-generates the `@import url(...)` from the font names in the tokens. Just put the exact Google Font name in the token (e.g. `"Cormorant Garamond"`) — no need to manage `@import` URLs in the charte or the HTML.

#### Spacing — the rhythm

| Token | Role | Typical value |
|-------|------|---------------|
| `page` | Page margin | 12–20mm (print), 8–12mm (screen) |
| `section` | Space between sections | 8–15mm |
| `gap` | Space between elements | 3–6mm |
| `card` | Internal padding of a card | 4–8mm |

#### Shadow — the depth

| Token | Role | Typical value |
|-------|------|---------------|
| `card` | Card / framed-image shadow | `0 1mm 4mm rgba(0,0,0,0.08)` (subtle) to `0 2mm 8mm rgba(0,0,0,0.15)` (strong) |
| `elevated` | Elevated elements (modal, dropdown) | `0 4mm 16mm rgba(0,0,0,0.12)` |

Shadow is a signal of refinement. A near-imperceptible shadow (opacity 0.05–0.08) reads premium. A shadow that's too strong feels cheap. Match opacity to the background: the lighter the bg, the lighter the shadow can be.

```json
{
  "shadow": {
    "card": "0 1mm 4mm rgba(0,0,0,0.08)",
    "elevated": "0 4mm 16mm rgba(0,0,0,0.12)"
  }
}
```

Usage: `box-shadow:var(--charte-shadow-card)` — never hardcoded `box-shadow`.

#### Voice — the editorial tone

Voice guides content writing. It's as important as colors.

```json
{
  "personality": ["warm", "authentic", "passionate"],
  "formality": "semi-formal",
  "do": ["address the reader directly", "use sensory words", "evoke heritage"],
  "dont": ["technical jargon", "empty superlatives", "unnecessary anglicisms"],
  "vocabulary": ["know-how", "heritage", "authenticity", "sharing"]
}
```

#### Rules — the design constraints

Rules are the editorial guardrails of the charte. They prevent misuse of tokens — things a professional styleguide PDF states explicitly.

**Always include rules on contrast and color usage:**

```json
{
  "titles": "Subtitles always in uppercase, main title in lowercase",
  "photos": "Always full width or 4:3 ratio, never cut-out photos",
  "layout": "Minimum 15mm margin, always center main elements",
  "color_usage": "primary = titles and structural elements only, never a background covering more than 30% of the page. accent = CTA and occasional highlights, never on text below 5mm. bg = dominant surface, other colors sit on top",
  "shadow": "Shadows always subtle (opacity < 0.12). No shadow on text elements, only cards and framed images",
  "typography": "heading only for titles and subtitles. Never heading font in body text. Body always in body font, minimum 3.5mm"
}
```

Rules must answer: "what should we NOT do with this charte?". A good test: remove the rule — if someone makes that mistake, does it hurt the visual identity? If yes, the rule is necessary.

### 4. Create with maket_charte set

```
maket_charte set(
  name: "project-name",
  description: "Visual identity for [client] — [positioning]",
  tokens: { color: {...}, font: {...}, spacing: {...} },
  voice: { personality: [...], formality: "...", do: [...], dont: [...] },
  rules: { titles: "...", photos: "...", layout: "..." }
)
```

### 5. Validate visually

After creation, offer to build a test document:
1. `maket_doc new` with the charte associated
2. `maket_html set(doc, 1, html)` with a simple layout using every token
3. `snapshot(doc, 1)` to verify colors, fonts, and spacing work together

That's the only way to validate — a palette on paper can look fine but render badly.

## References

- [references/color-theory.md](references/color-theory.md) — Palettes by sector, color theory, palette extraction from photos
- [references/typography-pairings.md](references/typography-pairings.md) — Google Fonts pairings with ready-to-use `@import` URLs
