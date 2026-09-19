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
						items: {
							type: "array",
							items: {
								type: "object",
								properties: {
									title: { type: "string" },
									owner: { type: "string" },
								},
							},
						},
					},
				},
				data: {
					title: "Launch",
					done: false,
					status: "draft",
					items: [{ title: "Ship the release", owner: "Alex" }],
				},
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
		const { container } = render(<StateWorkspace />);

		expect(
			screen.getByRole("region", { name: "Document state" }),
		).toBeVisible();
		expect(screen.queryByText("Document state")).toBeNull();
		const headers = container.querySelectorAll("[data-state-dock] > header");
		expect(headers).toHaveLength(1);
		expect(headers[0]).toContainElement(
			screen.getByRole("button", { name: "Live" }),
		);
		expect(headers[0]).toContainElement(
			screen.getByRole("button", { name: "Fields" }),
		);
		const renderMode = screen.getByRole("group", {
			name: "State document view",
		});
		const dataMode = screen.getByRole("group", { name: "State data display" });
		expect(renderMode.className).toBe(dataMode.className);
		expect(screen.getByRole("button", { name: "Live" }).className).toBe(
			screen.getByRole("button", { name: "Fields" }).className,
		);
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

	it("keeps derived Structured Workspace collection fields read-only", async () => {
		const sendPatch = vi.spyOn(ws, "sendStateValuePatch");
		const collectionDocument: Document = {
			...document,
			meta: {
				structuredWorkspace: {
					role: "collection",
					workspaceId: "workspace-1",
					collectionId: "backlog",
				},
			},
		};
		useStore.setState({
			docs: new Map([[collectionDocument.name, collectionDocument]]),
		});
		const user = userEvent.setup();
		render(<StateWorkspace />);

		expect(screen.getByDisplayValue("Launch")).toBeDisabled();
		expect(screen.getByRole("checkbox")).toBeDisabled();
		expect(screen.getByRole("combobox")).toBeDisabled();
		await user.click(screen.getByRole("checkbox"));
		expect(sendPatch).not.toHaveBeenCalled();
	});

	it("keeps fields as the default and renders the same nested state as JSON", async () => {
		const user = userEvent.setup();
		const { container } = render(<StateWorkspace />);

		expect(screen.getByRole("button", { name: "Fields" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByDisplayValue("Launch")).toBeVisible();
		expect(
			screen.queryByRole("tree", { name: "Document state JSON tree" }),
		).toBeNull();

		await user.click(screen.getByRole("button", { name: "JSON" }));

		expect(screen.queryByDisplayValue("Launch")).toBeNull();
		expect(
			screen.getByRole("tree", { name: "Document state JSON tree" }),
		).toBeVisible();
		expect(screen.getByText('"Ship the release"')).toBeVisible();
		expect(screen.getByText("false")).toHaveClass("text-danger");
		expect(
			container.querySelector('[data-json-line][data-json-path="$"]'),
		).toHaveStyle({ paddingInlineStart: "0px" });
		expect(
			container.querySelector('[data-json-line][data-json-path="$.items"]'),
		).toHaveStyle({ paddingInlineStart: "20px" });
		expect(
			container.querySelector('[data-json-line][data-json-path="$.items[0]"]'),
		).toHaveStyle({ paddingInlineStart: "40px" });
		expect(
			container.querySelector(
				'[data-json-line][data-json-path="$.items[0].title"]',
			),
		).toHaveStyle({ paddingInlineStart: "60px" });
		expect(container.querySelectorAll("[data-json-guide]")).toHaveLength(3);
	});

	it("collapses nested JSON and expands matches with highlighted search results", async () => {
		const user = userEvent.setup();
		const { container } = render(<StateWorkspace />);
		await user.click(screen.getByRole("button", { name: "JSON" }));

		const itemToggle = screen.getByRole("button", {
			name: "Collapse JSON at $.items[0]",
		});
		await user.click(itemToggle);
		expect(itemToggle).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByText('"Ship the release"')).toBeNull();

		await user.type(
			screen.getByRole("searchbox", { name: "Search JSON" }),
			"release",
		);
		expect(await screen.findByText("1 match(es)")).toBeVisible();
		const highlights = container.querySelectorAll("[data-json-highlight]");
		expect(highlights).toHaveLength(1);
		expect(highlights[0]).toHaveTextContent("release");
		expect(
			await screen.findByRole("button", {
				name: "Collapse JSON at $.items[0]",
			}),
		).toHaveAttribute("aria-expanded", "true");

		await user.clear(screen.getByRole("searchbox", { name: "Search JSON" }));
		await user.type(
			screen.getByRole("searchbox", { name: "Search JSON" }),
			"owner",
		);
		expect(container.querySelector("[data-json-highlight]")).toHaveTextContent(
			"owner",
		);
	});
});
