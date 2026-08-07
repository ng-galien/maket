import type {
	DocumentStateClientView,
	DocumentStateData,
	DocumentStateSchema,
} from "@maket/shared";
import type { Document } from "../store/types";
import type { DemoScenario, DemoWorkspace } from "./scenario";
import { siteCharte } from "./scenario";

const PAGE_ID = "opening-checklist-page";
const DOC_NAME = "opening-checklist";

const schema: DocumentStateSchema = {
	type: "object",
	properties: {
		title: { type: "string" },
		owner: { type: "string" },
		status: { type: "string", enum: ["todo", "ready"] },
		approved: { type: "boolean" },
	},
	required: ["title", "owner", "status", "approved"],
	additionalProperties: false,
};

const template = `<style>
  .living-sheet {
    position: relative;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
    padding: 15mm 14mm 11mm;
    background: var(--charte-color-paper);
    color: var(--charte-color-ink);
    font-family: var(--charte-font-heading);
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 10mm;
  }
  .living-sheet::before {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    height: 4mm;
    background: var(--charte-color-accent);
  }
  .living-sheet::after {
    content: "";
    position: absolute;
    width: 78mm;
    height: 78mm;
    right: -38mm;
    top: 34mm;
    border: 1px solid var(--charte-color-line);
    border-radius: 50%;
    pointer-events: none;
  }
  .living-header,
  .living-controls,
  .living-footer {
    position: relative;
    z-index: 1;
  }
  .living-meta-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 5mm;
    margin-bottom: 7mm;
  }
  .living-kicker {
    margin: 0;
    color: var(--charte-color-accent);
    font: 600 8px var(--charte-font-mono);
    letter-spacing: .14em;
    text-transform: uppercase;
  }
  .living-status {
    padding: 2mm 3mm;
    border-radius: 99px;
    background: var(--charte-color-accent-light);
    color: var(--charte-color-ink);
    font: 600 8px var(--charte-font-mono);
    letter-spacing: .11em;
    text-transform: uppercase;
  }
  .living-title {
    max-width: 9ch;
    margin: 0;
    font: 500 39px/.92 var(--charte-font-display);
    letter-spacing: -.035em;
  }
  .living-intro {
    max-width: 38ch;
    margin: 5mm 0 0;
    color: var(--charte-color-muted);
    font-size: 11px;
    line-height: 1.55;
  }
  .living-controls {
    display: grid;
    align-content: start;
    gap: 6mm;
  }
  .living-approval {
    display: grid;
    grid-template-columns: 7mm 1fr auto;
    align-items: center;
    gap: 4mm;
    padding: 5mm;
    border: 1px solid var(--charte-color-line);
    border-radius: 3mm;
    background: color-mix(in srgb, var(--charte-color-paper) 84%, white);
    box-shadow: 0 4mm 10mm rgba(16, 28, 25, .08);
    cursor: pointer;
    transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
  }
  .living-approval:hover {
    border-color: var(--charte-color-accent);
    transform: translateY(-.5mm);
    box-shadow: 0 5mm 12mm rgba(16, 28, 25, .11);
  }
  .living-approval input {
    width: 6mm;
    height: 6mm;
    margin: 0;
    accent-color: var(--charte-color-accent);
  }
  .living-approval-copy {
    display: grid;
    gap: 1mm;
  }
  .living-approval-copy strong {
    font-size: 14px;
    font-weight: 600;
  }
  .living-approval-copy small {
    color: var(--charte-color-muted);
    font-size: 9px;
    line-height: 1.4;
  }
  .living-index {
    color: var(--charte-color-accent);
    font: 600 9px var(--charte-font-mono);
  }
  .living-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4mm;
  }
  .living-field {
    display: grid;
    gap: 2mm;
    color: var(--charte-color-muted);
    font: 600 8px var(--charte-font-mono);
    letter-spacing: .12em;
    text-transform: uppercase;
  }
  .living-field input,
  .living-field select {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: 12mm;
    padding: 0 3mm;
    border: 1px solid var(--charte-color-line);
    border-radius: 2mm;
    background: rgba(255, 255, 255, .62);
    color: var(--charte-color-ink);
    font: 600 12px var(--charte-font-heading);
    text-transform: none;
    transition: border-color 160ms ease, box-shadow 160ms ease;
  }
  .living-field input:hover,
  .living-field select:hover,
  .living-field input:focus,
  .living-field select:focus {
    border-color: var(--charte-color-accent);
  }
  .living-field input:focus-visible,
  .living-field select:focus-visible,
  .living-approval input:focus-visible {
    outline: 2px solid var(--charte-color-accent);
    outline-offset: 2px;
  }
  .living-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 5mm;
    padding-top: 4mm;
    border-top: 1px solid var(--charte-color-line);
    color: var(--charte-color-muted);
    font: 500 8px var(--charte-font-mono);
    letter-spacing: .05em;
  }
  .living-footer strong {
    color: var(--charte-color-ink);
    font-weight: 600;
  }
  .living-footer-status {
    color: var(--charte-color-accent);
    text-transform: uppercase;
  }
</style>
<main data-id="checklist" class="living-sheet">
  <header data-id="header" class="living-header">
    <div class="living-meta-line">
      <p class="living-kicker">Living document · validated state</p>
      <span class="living-status">{{ state.status }}</span>
    </div>
    <h1 data-id="title" class="living-title">{{ state.title }}</h1>
    <p class="living-intro">Final checks before the doors open. Update the owner, set the status and tick the approval when everything is ready.</p>
  </header>
  <section data-id="controls" class="living-controls">
    <label data-id="approved-label" class="living-approval">
      <input data-id="approved-input" type="checkbox" data-maket-bind="state.approved">
      <span class="living-approval-copy"><strong>Venue approved</strong><small>Space, access and safety checks completed</small></span>
      <span class="living-index">01</span>
    </label>
    <div class="living-fields">
      <label data-id="owner-label" class="living-field">Owner<input data-id="owner-input" type="text" data-maket-bind="state.owner"></label>
      <label data-id="status-label" class="living-field">Status<select data-id="status-select" data-maket-bind="state.status"><option value="todo">To do</option><option value="ready">Ready</option></select></label>
    </div>
  </section>
  <footer data-id="footer" class="living-footer"><span>Current owner · <strong>{{ state.owner }}</strong></span><span class="living-footer-status">{{ state.status }}</span></footer>
</main>`;

function workspace(data: DocumentStateData, revision: number): DemoWorkspace {
	const document: Document = {
		id: DOC_NAME,
		name: DOC_NAME,
		category: "checklist",
		dataModel: "state",
		canvas: { w: 148, h: 210, background: "#fbfaf6", format: "A5" },
		activePage: 0,
		meta: { charte: "living-document" },
		pages: [{ id: PAGE_ID, name: "Checklist", elements: [], html: template }],
	};
	const view: DocumentStateClientView = {
		schema,
		data,
		revision,
		createdAt: `2026-08-05T10:0${revision}:00.000Z`,
		templates: { [PAGE_ID]: template },
	};
	return {
		documents: [document],
		chartes: [siteCharte("living-document")],
		collections: [],
		documentStates: { [DOC_NAME]: view },
	};
}

const first = {
	title: "Opening checklist",
	owner: "Camille",
	status: "todo",
	approved: false,
};
const approved = { ...first, status: "ready", approved: true };

export const livingChecklistScenario: DemoScenario = {
	id: "living-checklist",
	title: "Living document",
	downloadName: "living-checklist.maket",
	steps: [
		{
			id: "request",
			actor: "user",
			caption:
				"Make an opening checklist whose owner, approval, and status stay editable.",
			workspace: workspace(first, 1),
		},
		{
			id: "bind",
			actor: "agent",
			caption:
				"Your agent attaches a JSON Schema and binds native HTML controls to document-owned state.",
		},
		{
			id: "live-edit",
			actor: "user",
			caption:
				"In Maket's live canvas, approving the venue and selecting Ready creates revision 2.",
			workspace: workspace(approved, 2),
		},
		{
			id: "agent-patch",
			actor: "agent",
			caption:
				"The agent patches the same validated state; the document re-renders without changing its page count.",
			workspace: workspace({ ...approved, owner: "Nora" }, 3),
		},
		{
			id: "history",
			actor: "info",
			caption:
				"Download the current validated snapshot as a portable .maket bundle. Its local revision history starts again after import.",
		},
	],
};
