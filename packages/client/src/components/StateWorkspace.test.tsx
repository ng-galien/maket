import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import * as ws from "../store/ws";
import { StateWorkspace } from "./StateWorkspace";

const document: Document = {
	id: "state-doc",
	name: "Checklist",
	category: "tests",
	dataModel: "state",
	canvas: { w: 210, h: 297, background: "#fff" },
	pages: [{ id: "page-1", name: "Page 1", elements: [] }],
	activePage: 0,
};

beforeEach(() => {
	setLang("en");
	useStore.setState({
		docs: new Map([[document.name, document]]),
		workspaceDocNames: [document.name],
		focusedDocName: document.name,
		focusedPageIndex: 0,
		focusedCollectionName: null,
		stateDockOpen: true,
		stateCanvasModes: { [document.name]: "live" },
		documentStates: {
			[document.name]: {
				schema: {
					type: "object",
					properties: {
						title: { type: "string" },
						done: { type: "boolean" },
						status: { type: "string", enum: ["draft", "ready"] },
					},
				},
				data: { title: "Launch", done: false, status: "draft" },
				revision: 4,
				createdAt: "2026-08-21T00:00:00.000Z",
				templates: { "page-1": "<p>Checklist</p>" },
			},
		},
		statePatchPending: {},
		statePatchRequests: {},
		statePatchErrors: {},
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("StateWorkspace", () => {
	it("reuses the bottom-dock interaction model for state-backed documents", async () => {
		const user = userEvent.setup();
		render(<StateWorkspace />);

		expect(screen.getByText("Document state")).toBeVisible();
		expect(screen.getByText("Revision 4")).toBeVisible();
		expect(
			screen.getByRole("separator", {
				name: "Resize document state panel",
			}),
		).toBeVisible();
		expect(screen.getByDisplayValue("Launch")).toBeVisible();
		expect(screen.getByRole("checkbox")).not.toBeChecked();
		expect(screen.getByRole("combobox")).toHaveValue("draft");

		await user.click(screen.getByRole("button", { name: "Template" }));
		expect(useStore.getState().stateCanvasModes[document.name]).toBe("design");
		await user.click(screen.getByRole("button", { name: "Live" }));
		expect(useStore.getState().stateCanvasModes[document.name]).toBe("live");
	});

	it("patches values through the existing state contract and closes cleanly", async () => {
		const sendPatch = vi.spyOn(ws, "sendStateValuePatch").mockReturnValue("r1");
		const user = userEvent.setup();
		render(<StateWorkspace />);

		await user.click(screen.getByRole("checkbox"));
		expect(sendPatch).toHaveBeenCalledWith(document.name, "/done", 4, true);

		await user.click(screen.getByRole("button", { name: "Close" }));
		expect(useStore.getState().stateDockOpen).toBe(false);
	});
});
