---
name: maket
description: Orientation skill for Maket visual document work. Use when the user asks Claude to design, edit, review, or learn Maket; call maket_learn first for live product guidance, then operate through MCP tools.
---

# Maket

Maket knowledge lives in the MCP server, not in this skill.

Start each Maket session with:

```text
maket_learn action=overview audience=agent
```

Then ask for the specific topic you need:

```text
maket_learn action=topics
maket_learn action=topic topic=workflow
maket_learn action=topic topic=html
maket_learn action=topic topic=collections
```

Use `maket_workspace` for session state and user messages, `maket_doc` for document lifecycle, `maket_html` for page composition, `maket_charte` for brand language, `maket_collection` for structured placeholder data, `maket_preview` for visual checks, and `maket_pdf` for export.

The user-facing onboarding is a built-in Help document opened from the Maket UI. Do not recreate that document from this skill.
