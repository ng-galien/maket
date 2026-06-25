import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import * as wsClient from "../store/ws";
import { BottomBar } from "./BottomBar";

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
		pending: [],
		collections: [],
		collectionDrafts: {},
		collectionPreview: {},
		activePanel: null,
		barPosition: "bottom",
		darkMode: false,
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

	it("adds the collection preview selection to the Print href", () => {
		const doc = makeDoc("poster");
		doc.pages[0].collection = { name: "clients" };
		useStore.setState({
			docs: new Map([["poster", doc]]),
			focusedDocName: "poster",
			collections: [
				{
					name: "clients",
					schema: {
						type: "object",
						properties: { client_name: { type: "string" } },
					},
					members: [{ id: "member_2", position: 0, data: {} }],
				},
			],
			collectionPreview: {
				clients: { mode: "rendered", memberId: "member_2" },
			},
		});
		render(<BottomBar />);
		const print = screen.getByRole("link");
		const url = new URL(`http://localhost${print.getAttribute("href")}`);
		expect(url.searchParams.get("name")).toBe("poster");
		expect(url.searchParams.get("collection_preview")).toBe(
			JSON.stringify({
				clients: { mode: "rendered", memberId: "member_2" },
			}),
		);
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
