import type { Collection } from "@maket/shared";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import * as wsClient from "../store/ws";
import { BottomBar } from "./BottomBar";

const clientsCollection: Collection = {
	name: "clients",
	schema: {
		type: "object",
		properties: { client_name: { type: "string" } },
		required: ["client_name"],
		additionalProperties: false,
	},
	members: [
		{ id: "member_1", position: 0, data: { client_name: "Acme" } },
		{ id: "member_2", position: 1, data: { client_name: "Globex" } },
	],
};

function makeDoc(name: string): Document {
	return {
		id: `id-${name}`,
		name,
		category: "flyer",
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: [{ id: `${name}-page-1`, name: "p1", elements: [] }],
		activePage: 0,
	};
}

beforeEach(() => {
	setLang("en");
	useStore.setState({
		connected: false,
		docs: new Map(),
		workspaceDocNames: [],
		focusedDocName: null,
		focusedPageIndex: 0,
		focusedCollectionName: null,
		pending: [],
		collections: [],
		collectionDrafts: {},
		collectionCursors: {},
		activePanel: null,
		barPosition: "bottom",
		darkMode: false,
		readOnly: false,
	});
});

afterEach(() => {
	cleanup();
});

describe("BottomBar", () => {
	it("shows 'no document' placeholder when nothing is focused", () => {
		render(<BottomBar />);
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
	});

	it("renders the focused doc name and a Print link pointing at /print?name=", () => {
		const doc = makeDoc("my-flyer");
		useStore.setState({
			docs: new Map([["my-flyer", doc]]),
			focusedDocName: "my-flyer",
		});
		render(<BottomBar />);
		expect(screen.getByText("my-flyer")).toBeInTheDocument();
		const print = screen.getByRole("link");
		expect(print).toHaveAttribute("href", "/print?name=my-flyer");
		expect(print).toHaveAttribute("target", "_blank");
	});

	it("URL-encodes the doc name in the Print href", () => {
		const doc = makeDoc("flyer été 2026");
		useStore.setState({
			docs: new Map([["flyer été 2026", doc]]),
			focusedDocName: "flyer été 2026",
		});
		render(<BottomBar />);
		const print = screen.getByRole("link");
		expect(print.getAttribute("href")).toBe(
			"/print?name=flyer+%C3%A9t%C3%A9+2026",
		);
	});

	it("keeps the Print href plain — the server follows the shared cursor", () => {
		const doc = makeDoc("poster");
		doc.pages[0].collection = { name: "clients" };
		useStore.setState({
			docs: new Map([["poster", doc]]),
			focusedDocName: "poster",
			collections: [clientsCollection],
		});
		useStore.getState().setCollectionCursors([
			{
				docName: "poster",
				pageIndex: 0,
				collection: "clients",
				mode: "rendered",
				memberId: "member_2",
			},
		]);
		render(<BottomBar />);
		const print = screen.getByRole("link");
		expect(print.getAttribute("href")).toBe("/print?name=poster");
	});

	it("opens the active page data-source addon on the toolbar free side", async () => {
		const user = userEvent.setup();
		const doc = makeDoc("poster");
		doc.pages.push({ id: "poster-page-2", name: "p2", elements: [] });
		useStore.setState({
			docs: new Map([["poster", doc]]),
			focusedDocName: "poster",
			focusedPageIndex: 1,
			collections: [clientsCollection],
		});

		render(<BottomBar />);
		await user.click(screen.getByRole("button", { name: "Link data" }));

		const addon = screen.getByRole("dialog", { name: "Data source" });
		expect(addon).toHaveAttribute("data-side", "bottom");
		expect(screen.getByText(/Page 2 \/ 2/)).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /move to top/i }));
		expect(
			screen.queryByRole("dialog", { name: "Data source" }),
		).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Link data" }));
		expect(screen.getByRole("dialog", { name: "Data source" })).toHaveAttribute(
			"data-side",
			"top",
		);
	});

	it("binds a collection to the active page without optimistic state", async () => {
		const user = userEvent.setup();
		const send = vi.spyOn(wsClient, "wsSend").mockImplementation(() => {});
		const doc = makeDoc("poster");
		useStore.setState({
			docs: new Map([["poster", doc]]),
			focusedDocName: "poster",
			focusedPageIndex: 0,
			collections: [clientsCollection],
		});

		render(<BottomBar />);
		await user.click(screen.getByRole("button", { name: "Link data" }));
		await user.selectOptions(
			screen.getByRole("combobox", { name: "Page binding" }),
			"clients",
		);

		expect(send).toHaveBeenCalledWith({
			type: "collection_bind_page",
			docName: "poster",
			pageIndex: 0,
			collectionName: "clients",
		});
		expect(doc.pages[0].collection).toBeUndefined();
		send.mockRestore();
	});

	it("keeps detach explicit and scoped to the active page", async () => {
		const user = userEvent.setup();
		const send = vi.spyOn(wsClient, "wsSend").mockImplementation(() => {});
		const doc = makeDoc("poster");
		doc.pages[0].collection = { name: "clients" };
		useStore.setState({
			docs: new Map([["poster", doc]]),
			focusedDocName: "poster",
			focusedPageIndex: 0,
			collections: [clientsCollection],
		});

		render(<BottomBar />);
		await user.click(
			screen.getByRole("button", { name: /clients · Template/i }),
		);
		await user.click(screen.getByRole("button", { name: "Detach" }));

		expect(send).toHaveBeenCalledWith({
			type: "collection_clear_page",
			docName: "poster",
			pageIndex: 0,
		});
		send.mockRestore();
	});

	it("sends cursor moves to the server and opens the bound collection workspace", async () => {
		const user = userEvent.setup();
		const send = vi.spyOn(wsClient, "wsSend").mockImplementation(() => {});
		const doc = makeDoc("poster");
		doc.pages[0].collection = { name: "clients" };
		useStore.setState({
			docs: new Map([["poster", doc]]),
			focusedDocName: "poster",
			focusedPageIndex: 0,
			collections: [clientsCollection],
		});

		render(<BottomBar />);
		await user.click(
			screen.getByRole("button", { name: /clients · Template/i }),
		);
		await user.click(
			screen.getByRole("button", { name: "Current row render" }),
		);
		expect(send).toHaveBeenCalledWith({
			type: "collection_cursor_set",
			docName: "poster",
			pageIndex: 0,
			mode: "rendered",
		});

		await user.click(screen.getByRole("button", { name: "Next row" }));
		expect(send).toHaveBeenCalledWith({
			type: "collection_cursor_set",
			docName: "poster",
			pageIndex: 0,
			memberId: "member_2",
		});

		await user.click(screen.getByRole("button", { name: "Open data" }));
		expect(useStore.getState().focusedCollectionName).toBe("clients");
		expect(useStore.getState().focusedDocName).toBe("poster");
		expect(useStore.getState().activePanel).toBeNull();
		send.mockRestore();
	});

	it("disables row-render modes when the bound collection is empty", async () => {
		const user = userEvent.setup();
		const doc = makeDoc("poster");
		doc.pages[0].collection = { name: "clients" };
		useStore.setState({
			docs: new Map([["poster", doc]]),
			focusedDocName: "poster",
			focusedPageIndex: 0,
			collections: [{ ...clientsCollection, members: [] }],
		});

		render(<BottomBar />);
		await user.click(
			screen.getByRole("button", { name: /clients · Template/i }),
		);

		expect(
			screen.getByRole("button", { name: "Current row render" }),
		).toBeDisabled();
		expect(screen.getByRole("button", { name: "All rows" })).toBeDisabled();
	});

	it("shows the shared cursor position on the chip in row mode", () => {
		const doc = makeDoc("poster");
		doc.pages[0].collection = { name: "clients" };
		useStore.setState({
			docs: new Map([["poster", doc]]),
			focusedDocName: "poster",
			focusedPageIndex: 0,
			collections: [clientsCollection],
		});
		useStore.getState().setCollectionCursors([
			{
				docName: "poster",
				pageIndex: 0,
				collection: "clients",
				mode: "rendered",
				memberId: "member_2",
			},
		]);
		render(<BottomBar />);
		expect(
			screen.getByRole("button", { name: /clients · Row 2\/2/i }),
		).toBeInTheDocument();
	});

	it("toggles the active panel when a panel icon is clicked", async () => {
		const user = userEvent.setup();
		render(<BottomBar />);
		await user.click(screen.getByTitle(/brand|chartes/i));
		expect(useStore.getState().activePanel).toBe("chartes");
		await user.click(screen.getByTitle(/brand|chartes/i));
		expect(useStore.getState().activePanel).toBeNull();
	});

	it("switches between panels", async () => {
		const user = userEvent.setup();
		render(<BottomBar />);
		await user.click(screen.getByTitle(/brand|chartes/i));
		await user.click(screen.getByTitle(/photos/i));
		expect(useStore.getState().activePanel).toBe("photos");
	});

	it("shows a pending badge when pending.length > 0", () => {
		useStore.setState({
			pending: [
				{ id: "a", type: "note", ts: 0 },
				{ id: "b", type: "note", ts: 0 },
				{ id: "c", type: "note", ts: 0 },
			],
		});
		render(<BottomBar />);
		// Badge lives inside the exchange button
		expect(screen.getByText("3")).toBeInTheDocument();
	});

	it("flips bar position via the toggle button and persists to localStorage", async () => {
		const user = userEvent.setup();
		render(<BottomBar />);
		await user.click(screen.getByRole("button", { name: /move to top/i }));
		expect(useStore.getState().barPosition).toBe("top");
		expect(localStorage.getItem("bar-position")).toBe("top");
	});

	it("triggers fit-to-view when the fit button is clicked", async () => {
		const user = userEvent.setup();
		const { registerFitToView } = await import("../store/zoomBridge");
		let fitCalls = 0;
		registerFitToView(() => {
			fitCalls += 1;
		});
		render(<BottomBar />);
		await user.click(screen.getByTitle(/recadrer|fit to view/i));
		expect(fitCalls).toBe(1);
	});

	it("opens the built-in help document", async () => {
		const user = userEvent.setup();
		const send = vi.spyOn(wsClient, "wsSend").mockImplementation(() => {});
		render(<BottomBar />);
		await user.click(screen.getByRole("button", { name: /help|aide/i }));
		expect(send).toHaveBeenCalledWith({ type: "open_onboarding", lang: "en" });
		send.mockRestore();
	});

	it("toggles dark mode via the sun/moon button", async () => {
		const user = userEvent.setup();
		render(<BottomBar />);
		await user.click(screen.getByRole("button", { name: /dark mode/i }));
		expect(useStore.getState().darkMode).toBe(true);
	});

	it("renders a disconnected indicator when connected=false", () => {
		const { container } = render(<BottomBar />);
		// The dot pulses in red when disconnected
		expect(container.querySelector(".bg-danger")).not.toBeNull();
	});
});
