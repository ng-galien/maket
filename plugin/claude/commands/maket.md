---
description: Design a visual document or get a guided tour of Maket
argument-hint: What to design (e.g. "A3 poster for a jazz festival") — leave empty for a guided tour
---

# /maket — Visual document creation with Maket

Brief: $ARGUMENTS

## When $ARGUMENTS is empty — Onboarding

If the user typed `/maket` with no arguments, they might be discovering Maket.

**First, check if the onboarding has already been done:** call `maket_doc list` and look for a document named "Welcome to Maket".

- **If it exists** — the user already has the tutorial. Skip onboarding and instead ask: "What would you like to create? Give me a format (A3, A4, DESKTOP, TABLET, MOBILE...), the type (poster, flyer, card, label, wireframe) and the main content."
- **If it doesn't exist** — this is the first experience. Ask:

> "Welcome to Maket! Want a guided tour? I'll create a small document that shows you how it works."

If they accept, load the pre-built tutorial pages from the plugin assets:

### How to load the onboarding

1. `maket_doc new(doc: "Welcome to Maket", format: "A5", orientation: "landscape", category: "tutorial")`
2. `maket_preview open`
3. Read `assets/onboarding/page1-bienvenue.html` and pass its content to `maket_html set`
4. `maket_page add(name: "Your images")` → Read `assets/onboarding/page2-images.html` → `maket_html set`
5. `maket_page add(name: "Brand guides")` → Read `assets/onboarding/page3-chartes.html` → `maket_html set`
6. `maket_page add(name: "Messages")` → Read `assets/onboarding/page4-messages.html` → `maket_html set`
7. `maket_doc focus(doc, 1)` to go back to the welcome page

The asset files are located at: `plugin/claude/skills/maket/assets/onboarding/`

Page 2 (Images) has a placeholder for the library section — after loading, use `maket_image list` to get the actual categories and update the `library` element via `maket_html patch` with the real data.

### After the tutorial

Tell the user their guide is ready and invite them to try the messaging loop on the tutorial itself. Wait for their first message via `maket_message list`.

When they're ready, ask what they'd like to design for real.

---

## When $ARGUMENTS has a brief — Design workflow

### Step 1 — Analyze the brief

Extract: format, orientation, title, subtitle, body, tone, colors.
Show a short summary before proceeding.

### Step 2 — Check assets and charte

1. `maket_charte list` → `maket_charte view` if applicable (get `context_token`)
2. `maket_image list` (filter by category if relevant)
3. `maket_image view` on best candidates
4. Decide: photo background, solid color, gradient?

### Step 3 — Create and compose

1. `maket_doc new` with format, orientation, category, and `charte`
2. `maket_preview open`
3. `maket_doc state` to confirm canvas dimensions

Build the layout with `maket_html set`. Pass `context_token` if a charte is loaded. Every element gets a `data-id`.

### Step 4 — Iterate

1. `maket_html patch` to refine
2. `maket_message list` for user annotations → process and `maket_message ack`
3. Repeat until satisfied

### Step 5 — Visual review

1. `maket_preview snapshot` — analyze critically
2. `maket_html check` — fix issues
3. `maket_html patch` + `maket_preview snapshot` again

### Step 6 — Finalize

1. All mutations persist immediately — no explicit save needed
2. Export: `maket_pdf` (PDF) or standalone HTML
