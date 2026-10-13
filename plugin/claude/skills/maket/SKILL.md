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
maket_learn action=topic topic=state
maket_learn action=topic topic=structured-workspaces
```

Use `maket_workspace` for session state and user messages, `maket_doc` for document lifecycle, side-effect-free lookup by exact name, and pinning the documents the user keeps at hand (`maket_doc action=pin|unpin doc=<name>`; pinned documents lead the desktop list and the Reader navigation), `maket_html` for page composition, `maket_charte` for brand language, `maket_collection` for mail-merge data, `maket_state` for one document's living data, revisions, and revision retention (state values can also drive SVG geometry and style width/height/left/top/transform/opacity, see the `html` topic), `maket_structured_workspace` for typed item collections whose items open as documents, with grouped, multi-page collection indexes, `maket_preview` for visual checks, and `maket_pdf` for export.

## Structured Workspaces

Build a Structured Workspace with the method of `maket_learn action=topic topic=structured-workspaces`. Its first path, from a data schema alone:

1. maket_structured_workspace {"action":"create","workspace":"<name>","data_schema":<JSON Schema object with a required "id" string property>}
2. Read the answer: `Verdict: ready.`, the collection id `items` and the binding id `item`.
3. maket_structured_workspace {"action":"add_item","workspace":"<name>","collection":"items","binding":"item","document_name":"<item name>","data":<item JSON with its own "id">}
4. maket_structured_workspace {"action":"check","workspace":"<name>"} must answer "verdict": "ready".
5. On an error answer, apply every `Fix:` line and call again; the full method: maket_learn action=topic topic=structured-workspaces.

Never create template documents in the Documents library unless you bind them with `create` or `update_definition` in the same session; the inline-templates and named-documents paths are in the method.

The user-facing onboarding is a built-in Help document opened from the Maket UI. Do not recreate that document from this skill.
