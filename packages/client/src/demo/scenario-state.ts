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

const template = `<main data-id="checklist" style="width:100%;height:100%;box-sizing:border-box;padding:18mm;background:var(--charte-color-paper);color:var(--charte-color-ink);font-family:var(--charte-font-heading);display:grid;grid-template-rows:auto 1fr auto;gap:12mm">
  <header data-id="header"><p style="margin:0 0 3mm;font:500 9px var(--charte-font-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--charte-color-accent)">Living document · validated state</p><h1 data-id="title" style="margin:0;font:500 34px/1 var(--charte-font-display)">{{ state.title }}</h1></header>
  <section data-id="controls" style="display:grid;gap:5mm;align-content:start">
    <label data-id="approved-label" style="display:flex;align-items:center;gap:4mm;padding:5mm;border:1px solid var(--charte-color-line)"><input data-id="approved-input" type="checkbox" data-maket-bind="state.approved"><span>Venue approved</span></label>
    <label data-id="owner-label" style="display:grid;gap:2mm;font:500 9px var(--charte-font-mono);text-transform:uppercase">Owner<input data-id="owner-input" type="text" data-maket-bind="state.owner" style="padding:4mm;border:1px solid var(--charte-color-line);background:white;font:500 14px var(--charte-font-heading)"></label>
    <label data-id="status-label" style="display:grid;gap:2mm;font:500 9px var(--charte-font-mono);text-transform:uppercase">Status<select data-id="status-select" data-maket-bind="state.status" style="padding:4mm;border:1px solid var(--charte-color-line);background:white;font:500 14px var(--charte-font-heading)"><option value="todo">To do</option><option value="ready">Ready</option></select></label>
  </section>
  <footer data-id="footer" style="display:flex;justify-content:space-between;border-top:1px solid var(--charte-color-line);padding-top:4mm;font:500 9px var(--charte-font-mono);text-transform:uppercase"><span>{{ state.owner }}</span><strong style="color:var(--charte-color-accent)">{{ state.status }}</strong></footer>
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
