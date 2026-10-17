# Responsive document reading

A document may opt in to fluid browser reading with `maket_doc action=meta doc=<name> responsive=true`. This single document metadata flag applies to every page, both in the workspace reader and in document links and MCP readers. Omitted or `false` keeps the existing paper-scaled reading behavior.

Responsive reading uses the available reader pane width, a 16px root font, and natural page height. Pages may use container queries such as `@container (max-width: 600px) { ... }` to adapt their internal layout. Fixed-width authored HTML or SVG may still require document CSS changes; opting in does not rewrite its layout. Horizontal overflow remains scrollable.

The flag does not change authored canvas dimensions, editing, printing, or PDF geometry. It travels with document metadata in `.maket` bundles.

For a Structured Workspace, set the flag on the relevant index or detail **template**, then call `maket_structured_workspace action=sync_template workspace=<workspace>`. Existing projections inherit the template choice on synchronization, and new projections inherit it at creation. Direct metadata edits on projections remain forbidden. An owned template accepts only this metadata field in that call; other template changes retain their existing controls. Set `responsive=false` on the template and synchronize to restore paper-scaled reading.
