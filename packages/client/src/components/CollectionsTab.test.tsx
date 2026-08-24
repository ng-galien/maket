import type { Collection } from "@maket/shared";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { DocSummary, Document } from "../store/types";
import { useStore } from "../store/useStore";
import * as wsClient from "../store/ws";
import { CollectionsTab } from "./CollectionsTab";

function collection(name: string, rows: number): Collection {
	return {
		name,
		schema: {
			type: "object",
			properties: { client: { type: "string" } },
			required: [],
			additionalProperties: false,
		},
		members: Array.from({ length: rows }, (_, index) => ({
			id: `${name}-${index}`,
			position: index,
			data: { client: `Client ${index}` },
		})),
	};
}

beforeEach(() => {
	setLang("en");
	useStore.setState({
		collections: [collection("Alpha", 2), collection("Beta", 1)],
		docList: [],
		docs: new Map(),
		workspaceDocNames: [],
		focusedDocName: null,
		focusedCollectionName: null,
		dataDockMode: "split",
	});
});

afterEach(cleanup);

describe("CollectionsTab", () => {
	it("uses compact selectable rows without a redundant section heading", async () => {
		const user = userEvent.setup();
		const { container } = render(<CollectionsTab />);

		expect(
			screen.queryByRole("heading", { name: "Collections" }),
		).not.toBeInTheDocument();
		expect(container.querySelectorAll("[data-collection-row]")).toHaveLength(2);
		expect(
			container.querySelectorAll("[data-library-list-divider]"),
		).toHaveLength(1);
		expect(
			container.querySelector("[data-collection-row]")?.className,
		).not.toContain("border-b");

		await user.click(screen.getByRole("button", { name: /Beta/ }));
		expect(useStore.getState()).toMatchObject({
			focusedCollectionName: "Beta",
			dataDockMode: "expanded",
		});
		expect(
			container.querySelector('[data-collection-row="Beta"]'),
		).toHaveAttribute("data-active", "true");
	});

	it("filters collections through the shared library search", async () => {
		const user = userEvent.setup();
		const { container } = render(<CollectionsTab />);

		await user.type(
			screen.getByRole("textbox", { name: "Search collections…" }),
			"Beta",
		);
		expect(container.querySelectorAll("[data-collection-row]")).toHaveLength(1);
		expect(
			container.querySelector('[data-collection-row="Beta"]'),
		).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Clear search" }));
		expect(container.querySelectorAll("[data-collection-row]")).toHaveLength(2);
	});

	it("keeps the toolbar focused on search and the shared compact action style", () => {
		const { container } = render(<CollectionsTab />);
		const actions = container.querySelector("[data-library-toolbar-actions]");
		const createButton = screen.getByRole("button", { name: "New collection" });

		expect(actions).toHaveTextContent("");
		expect(actions?.querySelectorAll("button")).toHaveLength(1);
		expect(createButton).toHaveClass("h-8", "w-8", "bg-input", "text-text-3");
	});

	it("lists linked documents and opens them without closing the collection", async () => {
		const user = userEvent.setup();
		const document: Document = {
			id: "annual-report",
			name: "Annual report",
			category: "Reports/2026",
			canvas: { w: 210, h: 297, background: "#fff" },
			pages: [
				{
					id: "page-1",
					name: "Page 1",
					elements: [],
					collection: { name: "Alpha" },
				},
			],
			activePage: 0,
		};
		const summary: DocSummary = {
			id: document.id,
			name: document.name,
			category: document.category,
			format: "A4",
			pageCount: 1,
			elementCount: 0,
			collectionBindings: [{ name: "Alpha", pageCount: 1 }],
		};
		useStore.setState({
			docList: [summary],
			docs: new Map([[document.name, document]]),
			workspaceDocNames: [document.name],
			focusedCollectionName: "Beta",
			dataDockMode: "expanded",
		});

		render(<CollectionsTab />);
		const collectionButton = screen.getByRole("button", { name: /^Alpha/ });
		const documentButton = screen.getByRole("button", {
			name: "Open Annual report",
		});
		expect(collectionButton.querySelector("svg")).toBeNull();
		expect(documentButton.querySelector("svg")).toBeNull();
		await user.click(documentButton);

		expect(useStore.getState()).toMatchObject({
			focusedDocName: "Annual report",
			focusedCollectionName: "Alpha",
			dataDockMode: "split",
		});
	});

	it("owns page binding as a secondary collection action", async () => {
		const user = userEvent.setup();
		const send = vi.spyOn(wsClient, "wsSend").mockImplementation(() => true);
		const document: Document = {
			id: "draft",
			name: "Draft",
			category: "Reports",
			canvas: { w: 210, h: 297, background: "#fff" },
			pages: [{ id: "page-1", name: "Page 1", elements: [] }],
			activePage: 0,
		};
		useStore.setState({
			docs: new Map([[document.name, document]]),
			workspaceDocNames: [document.name],
			focusedDocName: document.name,
			focusedPageIndex: 0,
		});

		render(<CollectionsTab />);
		await user.click(
			screen.getAllByRole("button", { name: "Link the active page" })[0],
		);

		expect(send).toHaveBeenCalledWith({
			type: "collection_bind_page",
			docName: "Draft",
			pageIndex: 0,
			collectionName: "Alpha",
		});
		expect(useStore.getState()).toMatchObject({
			focusedCollectionName: "Alpha",
			dataDockMode: "split",
		});
	});
});
