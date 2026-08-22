import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { PhotosTab } from "./PhotosTab";

const originalAddPending = useStore.getState().addPending;

beforeEach(() => {
	setLang("en");
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			json: async () => ({ images: [{ file: "sample.png" }] }),
		}),
	);
	useStore.setState({
		docs: new Map(),
		workspaceDocNames: ["missing-document"],
		focusedDocName: "missing-document",
		addPending: vi.fn(),
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	useStore.setState({ addPending: originalAddPending });
});

describe("PhotosTab insertion availability", () => {
	it("disables insertion when the focused document is not loaded", async () => {
		const user = userEvent.setup();
		render(<PhotosTab />);

		await user.click(await screen.findByRole("button", { name: "Actions" }));
		const menuInsert = await screen.findByRole("button", {
			name: "Insert into document",
		});
		expect(menuInsert).toBeDisabled();
		expect(menuInsert).toHaveAttribute(
			"title",
			"Open a document before inserting this image",
		);

		await user.click(menuInsert);
		expect(useStore.getState().addPending).not.toHaveBeenCalled();

		await user.keyboard("{Escape}");
		await user.click(
			screen.getByRole("button", { name: "sample.png sample.png" }),
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Insert into document" }),
			).toBeDisabled(),
		);
	});
});
