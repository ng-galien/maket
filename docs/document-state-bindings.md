# Document-state HTML binding contract

Status: **Implemented**

Version: **0.2**
Scope: document-owned persistent state only; collections and mail merge are out
of scope.

## Purpose

This specification defines the boundary between a Maket document and the Maket
runtime when document HTML is bound to persistent JSON state.

The central rule is:

> The document authors the interface in standard HTML and CSS. Maket resolves
> declared bindings and synchronizes the authored interface with the document
> store. Maket does not choose the representation of a value.

In particular, a JSON boolean does not inherently mean "checkbox". A document
may represent it as a native checkbox, a switch, a badge, an icon, text, or no
visible control at all.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in
this document are normative.

## Status and compatibility

This is the active contract for document-state bindings.

The earlier living-document prototype implicitly wrapped terminal Mustache
values in generated `<span role="button">` elements and supplied visual
checkbox CSS from the Maket client. Version 0.1 replaces that prototype markup;
no compatibility promise is made for it.

## Terminology

- **Source template**: the persistent HTML/CSS authored through `maket_html`.
- **Document state**: the current validated JSON object and its JSON Schema.
- **Binding expression**: the author-written value of `data-maket-bind`.
- **Resolved path**: the absolute RFC 6901 JSON Pointer calculated for one
  rendered binding.
- **Hydrated DOM**: the transient DOM produced from a source template and one
  state revision.
- **Terminal value**: a JSON string, number, boolean, or `null`; not an object
  or array.
- **Live mode**: hydrated DOM with user interactions connected to the store.
- **Static mode**: hydrated DOM without store interactions, used by previews,
  printing, and export.
- **Model mode**: the unhydrated source template.

## Responsibility boundary

| Responsibility | Owner |
| --- | --- |
| Choose checkbox, badge, button, text, or another representation | Document |
| Author HTML structure, labels, CSS, icons, and transitions | Document |
| Declare an editable value with `data-maket-bind` | Document |
| Validate binding syntax and schema compatibility | Maket |
| Resolve a binding to an absolute JSON Pointer | Maket |
| Hydrate native element properties from state | Maket |
| Translate user interaction into an RFC 6902 patch | Maket |
| Validate, persist, version, and broadcast the new state | Maket |
| Re-render affected document scopes | Maket |
| Handle pending operations, conflicts, and errors | Maket |

Maket MUST NOT insert a checkbox merely because a rendered value is boolean.
Maket MUST NOT prescribe control dimensions, colors, icons, borders, shadows,
or animations inside the document canvas.

The browser's native control appearance is the fallback when a document authors
no custom CSS.

## Persistent source contract

### Explicit interactivity

Mustache interpolation is display-only:

```html
<span data-id="done-value">{{ done }}</span>
```

The example above renders the value but MUST NOT become interactive implicitly.

Interactivity is explicit through the standard HTML `data-*` mechanism:

```html
<input
  data-id="done-input"
  type="checkbox"
  data-maket-bind="done"
/>
```

`data-maket-bind` is valid HTML custom data. It is the only state-binding
extension required in source HTML for version 0.2.

### Binding expressions

A binding expression uses the same scope model as document-state Mustache
names:

- At the document root, a binding MUST be state-namespaced, for example
  `data-maket-bind="state.done"`.
- Inside a state section, an unqualified name is relative to the current
  section frame, for example `data-maket-bind="done"` inside
  `{{#state.items}}`.
- A source template MUST NOT author an array index derived from the current
  data, such as `/items/2/done`.
- A source binding MUST resolve to a terminal value in every rendered frame.
- Property names follow the supported Mustache name grammar. JSON Pointer
  escaping is a runtime concern, not a template-author concern.

Example:

```html
<section data-id="checklist">
  {{#state.items}}
  <label data-id="checklist-row" class="checklist-row">
    <input
      data-id="done-input"
      type="checkbox"
      data-maket-bind="done"
    />
    <span data-id="label">{{ label }}</span>
  </label>
  {{/state.items}}
</section>
```

If this is the third rendered item, `done` resolves to `/items/2/done`.

### Element identity and data binding

`data-id` and `data-maket-bind` have different roles:

- `data-id` identifies authored document structure for HTML patching,
  selection, and annotations.
- `data-maket-bind` declares the state expression to hydrate and update.

Neither attribute substitutes for the other.

### Supported editable controls in version 0.2

| Authored element | Required state type | Live interaction |
| --- | --- | --- |
| `<input type="checkbox" data-maket-bind>` | boolean | Native `change`, terminal `replace` patch |
| `<input type="text" data-maket-bind>` | string | Local typing; one terminal `replace` on blur or Enter |
| `<select data-maket-bind>` | string constrained by `enum` | Native `change`, terminal `replace` patch |
| `<button type="button" data-maket-bind>` | string, number, boolean, or `null` | Open the single-value editor |

Other input types, radio groups, `<select multiple>`, editable comboboxes,
structural array editing, whole-object editing, multi-field submission, and
form-level transactions are outside version 0.2.

A schema/control mismatch MUST reject the template before persistence. For
example, a checkbox bound to a string is invalid.

Version 0.2 resolves bindable and section paths through direct JSON Schema
`properties`, `items`, and `type` declarations. Schema composition keywords
such as `$ref`, `allOf`, `anyOf`, `oneOf`, conditional schemas, and `not` are
not supported on a path referenced by the template and MUST be rejected
clearly before persistence. They may still describe state that the template
does not reference; general state validation remains owned by AJV.

Multiple controls MAY bind the same terminal value. They MUST converge after
the authoritative state update.

### Text input contract

A text input binds one JSON string. Maket MUST hydrate both its live `value`
property and its serializable `value` attribute.

Typing remains local to the control and MUST NOT create a patch, pending state,
or revision for every keystroke. A dirty text input commits exactly one
terminal `replace` operation when either:

- the control loses focus; or
- the user presses Enter.

Enter MUST NOT submit an enclosing form. Escape cancels the local edit,
restores the last authoritative value, and creates no patch. Committing an
unchanged value also creates no patch.

Schema constraints such as `minLength`, `maxLength`, and `pattern` remain owned
by the document-state schema. If a committed value fails schema validation,
Maket restores the authoritative value and exposes the normal binding error.

### Select contract

A version 0.2 select is the native HTML `<select>` element, not an editable
combobox. It binds one JSON string constrained by a JSON Schema `enum`.

The document authors the option values, visible labels, order, grouping, and
CSS. Maket MUST NOT generate options from the schema. Every allowed enum value
MUST have exactly one matching `<option value="…">`, and every selectable
option value MUST be allowed by the enum. Duplicate, missing, or incompatible
values make the source template invalid. An option inside a disabled
`<optgroup>` is disabled for this validation and cannot satisfy enum coverage.
The complete option list is static document-authored HTML; Mustache does not
generate or conditionally remove options.

Maket MUST hydrate the live `value` property. For serializable static output it
MUST also emit `selected` on the matching option and remove it from all other
options. A native `change` creates exactly one terminal `replace` operation.

An autocomplete input, `<datalist>`, or custom ARIA combobox is not a select
under this contract.

### Native HTML and accessibility

Documents SHOULD prefer native form controls over ARIA simulations.

- A checkbox SHOULD have an authored `<label>` association.
- Maket MUST NOT replace a native checkbox with `role="button"`.
- Maket MUST NOT synthesize document wording or accessible labels.
- Keyboard behavior MUST remain the browser's native behavior.
- Document CSS SHOULD preserve a visible `:focus-visible` state.

## Hydrated DOM contract

Hydration MUST NOT mutate the persistent source template.

For each binding instance, Maket adds transient runtime metadata while
preserving the authored declaration. A conforming runtime representation is:

```html
<input
  data-id="done-input"
  type="checkbox"
  data-maket-bind="done"
  data-maket-path="/items/2/done"
  data-maket-type="boolean"
  checked
/>
```

The following attributes are reserved runtime hooks:

| Attribute | Meaning |
| --- | --- |
| `data-maket-path` | Resolved absolute RFC 6901 JSON Pointer |
| `data-maket-type` | Validated terminal JSON type |
| `data-maket-pending` | A mutation for this binding is awaiting settlement |
| `data-maket-error` | The last mutation for this binding failed |

Runtime attributes MUST NOT be persisted into the source template.

For a checkbox, Maket MUST set the live `HTMLInputElement.checked` property.
For serializable static output it MUST also emit or remove the `checked`
attribute. For text inputs and selects, Maket MUST apply the `value` and
`selected` serialization rules defined above so print and export match Live
mode.

The document MAY use the runtime attributes as CSS hooks, but it SHOULD prefer
native selectors such as `:checked`, `:focus-visible`, `:disabled`, and `:has()`
for authored presentation.

## CSS ownership

All document-canvas presentation belongs to the source template.

Maket MAY expose runtime state through attributes, but MUST NOT ship canvas CSS
that overrides authored control appearance. In particular, Maket MUST NOT set
checkbox width, height, background, border, icon, radius, margin, or animation.

A minimally styled native checkbox can use `accent-color`:

```css
.checklist-row input[type="checkbox"] {
  accent-color: #23684f;
}
```

A fully custom but native interaction can use an authored visual sibling:

```html
<label data-id="checklist-row" class="checklist-row">
  <input
    data-id="done-input"
    class="check-input"
    type="checkbox"
    data-maket-bind="done"
  />
  <span data-id="check-visual" class="check-visual" aria-hidden="true"></span>
  <span data-id="label">{{ label }}</span>
  <span data-id="status-open" class="status-open">À faire</span>
  <span data-id="status-done" class="status-done">Fait</span>
</label>
```

```css
.check-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.check-visual {
  width: 8mm;
  height: 8mm;
  border: 0.5mm solid #8e9c94;
  border-radius: 2mm;
}

.check-input:checked + .check-visual {
  background: #23684f;
}

.checklist-row:has(.check-input:checked) .status-open,
.checklist-row:not(:has(.check-input:checked)) .status-done {
  display: none;
}

.checklist-row:focus-within .check-visual {
  outline: 0.5mm solid #23684f;
  outline-offset: 1mm;
}
```

The input retains native focus, keyboard, label, and `change` behavior. The
document owns the visual sibling and every transition.

## Live mutation lifecycle

For a committed bound-control interaction, Maket MUST perform the following
cycle:

1. Read `data-maket-path` from the interacted control.
2. Read the terminal value according to the control contract.
3. Mark the binding pending without displaying a routine success popup.
4. Send one RFC 6902 `replace` operation with the client's expected revision.
5. Validate the patched JSON against the current revision's JSON Schema.
6. Persist a complete schema-and-data revision atomically.
7. Broadcast the authoritative revision and affected paths.
8. Re-render the affected scope and clear pending state.

The revision belongs to the whole document, not to an individual pointer.
Maket therefore permits at most one bound-control mutation in flight per
document. While it is pending, every Live control in that document is inert;
another document may continue independently.

On failure or revision conflict, Maket MUST discard the speculative control
state, rehydrate from the authoritative revision, and expose an actionable
error. Errors remain visible; routine successful mutations remain silent. A
local timeout may release the controls, but Maket MUST retain request
correlation so a later authoritative success can clear the stale timeout error.

Document controls can replace terminal values only. Adding, removing, moving,
or replacing arrays and objects remains an agent/MCP operation in version 0.2.

## Rendering modes

| Mode | Source shown | State hydrated | Interactive |
| --- | --- | --- | --- |
| Model | Persistent template | No | No |
| Live | Derived DOM | Yes | Yes |
| Static preview | Derived DOM | Yes | No |
| Print/PDF/export | Derived DOM | Yes | No |

Live and static rendering MUST have visual parity for the same state revision.
Static output MUST retain native control state such as `checked`, `value`, and
`selected`, but MUST NOT attach store mutation behavior.

## Lists and pointer stability

The source template binds relative names and never persists positional runtime
pointers. During every render, Maket resolves each repeated binding against its
current section frame.

If an item is inserted, removed, or moved:

- the relevant render scope MUST be regenerated;
- every affected `data-maket-path` MUST be recalculated;
- no previous positional pointer is treated as immutable identity;
- an interaction uses the pointer present in the current hydrated DOM.

Stable replay or cross-revision identity is not provided by a positional JSON
Pointer. If that capability is later required, it needs a separate explicit
identity contract and is outside this specification.

## Schema and template lifecycle

- Attaching state MUST validate every binding against the proposed schema and
  initial data.
- Schema validation MUST inspect bindings in every Mustache branch, including
  empty loops and currently false sections; current data MUST NOT hide an
  invalid source binding.
- Persisting template HTML MUST validate every binding against the current
  revision's schema.
- Changing the state schema MUST validate all templates and proposed data
  before committing the new revision.
- Restoring a revision MUST restore schema and data together, then validate the
  templates before rendering.
- Invalid source HTML or binding expressions MUST leave both the template and
  state unchanged.

Document state and collections remain separate data models, APIs, storage, and
lifecycles. This contract MUST NOT be reused as a hidden collection mode.

## Security constraints

- Only declared `data-maket-bind` attributes emitted by the current render
  participate in state mutation. The server MUST reject a terminal patch whose
  path is absent from the active hydrated bindings, even if the path exists in
  the JSON state and satisfies the schema.
- A resolved path MUST remain inside the document-state JSON root.
- Unsafe JSON Pointer segments MUST be rejected.
- Prototype-polluting segments MUST be rejected.
- A control MUST NOT submit a form or navigate as a side effect of state
  mutation; editable buttons use `type="button"`.
- Hydration MUST preserve existing HTML escaping guarantees.
- Binding expressions in `<script>` or `<style>` content are invalid.

## Acceptance criteria

An implementation conforms to version 0.2 when automated tests prove that:

1. A source checkbox hydrates `checked=true` and `checked=false` correctly.
2. A text input hydrates its value, keeps typing local, commits once on blur or
   Enter, and cancels without a patch on Escape.
3. A select hydrates the matching option and native `change` commits its value.
4. Missing, duplicate, non-enum, disabled-group, multi-select, and
   type-incompatible select options are rejected before persistence.
5. A committed native interaction creates one terminal `replace` patch at the
   resolved path; an unchanged value creates none.
6. A repeated relative binding resolves to the correct array index.
7. Inserting, removing, and moving list members recalculates affected paths.
8. The persistent source template never receives runtime paths or attributes.
9. Model mode shows the source; Live and static modes show hydrated controls.
10. Live, print, and PDF output have the same checked, text, and selected state.
11. Maket applies no visual control styling inside the document canvas.
12. Document-authored native state and focus selectors remain effective.
13. Pending operations settle correctly and conflicts restore authoritative
    state.
14. Routine successes create no popup; failures remain visible.
15. Schema/control mismatches and structural bindings are rejected atomically.
16. Collection rendering and collection cursors remain unchanged.
17. Bindings in empty or false Mustache branches are validated atomically.
18. Two rapid patches on different pointers of one document cannot share one
    expected revision.
19. A late success clears a prior local timeout error for the same request.
20. The server rejects existing terminal paths that are not exposed by an
    active binding.

## Non-goals for version 0.2

- Automatic UI generation from JSON Schema.
- Automatic choice of a visual control from a JSON type.
- Inline editing of complete objects or arrays.
- User-driven array insertion, removal, or reordering.
- Multi-field forms, submit actions, and atomic form transactions.
- Editable combobox, autocomplete, `<datalist>`, radio-group, range, date, file,
  or rich-text binding.
- Custom Elements such as `<maket-checkbox>`.
- Cross-revision stable identity for positional array members.
- Multi-user merge or offline replay.

Future control types can extend the element/type matrix without changing the
ownership rule: the document authors standard HTML; Maket binds and
synchronizes it.
