---
description: Design a visual document with Maket
argument-hint: What to design (e.g. "A3 poster for a jazz festival")
---

# /maket — Visual document creation with Maket

Brief: $ARGUMENTS

## When $ARGUMENTS is empty

Call `maket_learn action=overview audience=agent`, then ask what the user wants to create. The user-facing onboarding is opened from Maket's Help button; do not generate a tutorial document here.

---

## When $ARGUMENTS has a brief — Design workflow

First call `maket_learn action=topic topic=workflow`.

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
3. `maket_workspace state` to confirm canvas dimensions

Build the layout with `maket_html set`. Pass `context_token` if a charte is loaded. Every element gets a `data-id`.

### Step 4 — Iterate

1. `maket_html patch` to refine
2. `maket_workspace list_messages` for user annotations → process and `maket_workspace ack_messages`
3. Repeat until satisfied

### Step 5 — Visual review

1. `maket_preview snapshot` — analyze critically
2. `maket_html check` — fix issues
3. `maket_html patch` + `maket_preview snapshot` again

### Step 6 — Finalize

1. All mutations persist immediately — no explicit save needed
2. Export: `maket_pdf` (PDF) or standalone HTML
