---
name: maket
description: Orientation skill for Maket visual document work. Use when Codex is asked to design, edit, review, or learn Maket; call maket_learn first for live product guidance, then operate through MCP tools.
---

# Maket

Maket guidance lives in the MCP server.

Start with `maket_learn action=overview audience=agent`, then ask for focused topics such as `workflow`, `tools`, `html`, `chartes`, `diagrams`, `collections`, `state`, `structured-workspaces`, `review`, or `install`.

## Structured Workspaces

Build a Structured Workspace with the method of `maket_learn action=topic topic=structured-workspaces`. Its first path, from a data schema alone:

1. maket_structured_workspace {"action":"create","workspace":"<name>","data_schema":<JSON Schema object with a required "id" string property>}
2. Read the answer: `Verdict: ready.`, the collection id `items` and the binding id `item`.
3. maket_structured_workspace {"action":"add_item","workspace":"<name>","collection":"items","binding":"item","document_name":"<item name>","data":<item JSON with its own "id">}
4. maket_structured_workspace {"action":"check","workspace":"<name>"} must answer "verdict": "ready".
5. On an error answer, apply every `Fix:` line and call again; the full method: maket_learn action=topic topic=structured-workspaces.

Never create template documents in the Documents library unless you bind them with `create` or `update_definition` in the same session; the inline-templates and named-documents paths are in the method.

Use the MCP tool surface as the source of truth. The built-in Help document is user onboarding opened from the Maket UI, and must not be recreated by this skill.
