import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { BottomBar } from "./BottomBar";

function makeDoc(name: string): Document {
	return {
		id: `id-${name}`,
		name,
		category: "flyer",
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: [{ name: "p1", elements: [] }],
		activePage: 0,
	};
}

beforeEach(() => {
	useStore.setState({
		connected: false,
		docs: new Map(),
		workspaceDocNames: [],
		focusedDocName: null,
		pending: [],
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
		expect(screen.queryByRole("link", { name: "PDF" })).not.toBeInTheDocument();
	});

	it("renders the focused doc name and a PDF link pointing at /print?name=", () => {
		const doc = makeDoc("my-flyer");
		useStore.setState({
			docs: new Map([["my-flyer", doc]]),
			focusedDocName: "my-flyer",
		});
		render(<BottomBar />);
		expect(screen.getByText("my-flyer")).toBeInTheDocument();
		const pdf = screen.getByRole("link", { name: "PDF" });
		expect(pdf).toHaveAttribute("href", "/print?name=my-flyer");
		expect(pdf).toHaveAttribute("target", "_blank");
	});

	it("URL-encodes the doc name in the PDF href", () => {
		const doc = makeDoc("flyer été 2026");
		useStore.setState({
			docs: new Map([["flyer été 2026", doc]]),
			focusedDocName: "flyer été 2026",
		});
		render(<BottomBar />);
		const pdf = screen.getByRole("link", { name: "PDF" });
		expect(pdf.getAttribute("href")).toBe(
			"/print?name=flyer%20%C3%A9t%C3%A9%202026",
		);
	});

	it("toggles the active panel when a panel icon is clicked", async () => {
		const user = userEvent.setup();
		render(<BottomBar />);
		await user.click(screen.getByTitle(/chartes/i));
		expect(useStore.getState().activePanel).toBe("chartes");
		await user.click(screen.getByTitle(/chartes/i));
		expect(useStore.getState().activePanel).toBeNull();
	});

	it("switches between panels", async () => {
		const user = userEvent.setup();
		render(<BottomBar />);
		await user.click(screen.getByTitle(/chartes/i));
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
