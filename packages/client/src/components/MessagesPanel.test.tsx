import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../store/useStore";
import { MessagesPanel } from "./MessagesPanel";

beforeEach(() => {
	useStore.setState({
		pending: [],
		activePanel: "exchange",
		focusedDocName: "alpha",
		barPosition: "bottom",
	});
});

afterEach(() => {
	cleanup();
});

describe("MessagesPanel", () => {
	it("renders the empty-state placeholder when there are no pending messages", () => {
		render(<MessagesPanel />);
		// pending_empty has a newline inside; we match on the first clause
		expect(screen.getByText(/Clique sur un élément/i)).toBeInTheDocument();
	});

	it("renders one entry per pending message with the correct type-specific text", () => {
		useStore.setState({
			pending: [
				{ id: "m1", type: "note", elementId: "a", text: "fix me", ts: 0 },
				{ id: "m2", type: "delete", elementId: "b", ts: 0 },
				{ id: "m3", type: "drop-image", file: "hero.jpg", ts: 0 },
				{ id: "m4", type: "drop-text", ts: 0 },
			],
		});
		render(<MessagesPanel />);
		expect(screen.getByText("fix me")).toBeInTheDocument();
		expect(screen.getByText(/à supprimer/i)).toBeInTheDocument();
		expect(screen.getByText(/hero\.jpg/)).toBeInTheDocument();
		expect(screen.getByText(/insérer texte/i)).toBeInTheDocument();
	});

	it("shows scope chips (doc + page + element) on messages", () => {
		useStore.setState({
			pending: [
				{
					id: "m1",
					type: "note",
					docName: "alpha",
					pageIndex: 0,
					elementId: "a",
					text: "fix me",
					ts: 0,
				},
				{
					id: "m2",
					type: "classify-images",
					text: "3 new images",
					ts: 0,
				},
			],
		});
		render(<MessagesPanel />);
		// "alpha" shows both on the m1 scope chip and on the input-area scope
		expect(screen.getAllByText("alpha").length).toBeGreaterThan(0);
		expect(screen.getByText(/p1/i)).toBeInTheDocument();
		// workspace-scoped message has a workspace chip
		expect(screen.getAllByText(/workspace/i).length).toBeGreaterThan(0);
	});

	it("removes a pending entry when its X button is clicked", async () => {
		const user = userEvent.setup();
		useStore.setState({
			pending: [
				{ id: "m1", type: "note", elementId: "a", text: "keep", ts: 0 },
				{ id: "m2", type: "note", elementId: "b", text: "drop", ts: 0 },
			],
		});
		const { container } = render(<MessagesPanel />);
		const buttons = container.querySelectorAll("button");
		// Each message has an X button. The second message's X is the second.
		const drop = [...buttons].find((b) =>
			b.closest('[role="button"]')?.textContent?.includes("drop"),
		);
		expect(drop).toBeDefined();
		await user.click(drop as HTMLElement);
		expect(useStore.getState().pending.map((p) => p.id)).toEqual(["m1"]);
	});

	it("adds a pending note when Enter is pressed in the textarea", async () => {
		const user = userEvent.setup();
		render(<MessagesPanel />);
		const textarea = screen.getByPlaceholderText(/Note sur le document/i);
		await user.click(textarea);
		await user.keyboard("hello{Enter}");
		const pending = useStore.getState().pending;
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({
			type: "note",
			text: "hello",
			docName: "alpha",
		});
	});

	it("ignores blank input on Enter", async () => {
		const user = userEvent.setup();
		render(<MessagesPanel />);
		const textarea = screen.getByPlaceholderText(/Note sur le document/i);
		await user.click(textarea);
		await user.keyboard("   {Enter}");
		expect(useStore.getState().pending).toHaveLength(0);
	});

	it("Shift+Enter inserts a newline instead of submitting", async () => {
		const user = userEvent.setup();
		render(<MessagesPanel />);
		const textarea = screen.getByPlaceholderText(
			/Note sur le document/i,
		) as HTMLTextAreaElement;
		await user.click(textarea);
		await user.keyboard("line1{Shift>}{Enter}{/Shift}line2");
		expect(textarea.value).toBe("line1\nline2");
		expect(useStore.getState().pending).toHaveLength(0);
	});

	it("disables the input area when no doc is focused", () => {
		useStore.setState({ focusedDocName: null });
		const { container } = render(<MessagesPanel />);
		const input = container.querySelector(".pointer-events-none");
		expect(input).not.toBeNull();
	});

	it("is hidden (pointer-events-none) when activePanel !== 'exchange'", () => {
		useStore.setState({ activePanel: null });
		const { container } = render(<MessagesPanel />);
		// Root panel has pointer-events-none in the closed state
		const root = container.firstElementChild as HTMLElement;
		expect(root.className).toMatch(/pointer-events-none/);
	});
});
