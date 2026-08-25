import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { ChartesTab } from "./ChartesTab";

const wsMocks = vi.hoisted(() => ({ wsSend: vi.fn(() => true) }));
vi.mock("../store/ws", () => wsMocks);

beforeEach(() => {
	setLang("en");
	localStorage.setItem("maket-chartes-view", "list");
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			json: async () => [
				{
					name: "atelier-intention",
					tokens: {
						color: { primary: "#18181b" },
						spacing: { gutter: "24px" },
					},
				},
				{
					name: "editorial",
					tokens: { color: { primary: "#f4f1ea" } },
				},
			],
		}),
	);
	const document = makeDoc("brief");
	useStore.setState({
		docs: new Map([[document.name, document]]),
		workspaceDocNames: [document.name],
		focusedDocName: document.name,
		chartesVersion: 0,
	});
	wsMocks.wsSend.mockClear();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("ChartesTab actions", () => {
	it("keeps apply in the contextual menu and uses a theme-aware row hover", async () => {
		const user = userEvent.setup();
		const { container } = render(<ChartesTab />);

		const charteName = await screen.findByText("atelier-intention");
		expect(charteName.closest("button")).toHaveClass("hover:bg-input/70");
		expect(
			screen.queryByRole("button", {
				name: "Apply brand guide atelier-intention",
			}),
		).toBeNull();
		expect(
			container.querySelectorAll("[data-library-list-divider]"),
		).toHaveLength(1);

		await user.click(screen.getAllByRole("button", { name: "Actions" })[0]);
		const trigger = screen.getAllByRole("button", { name: "Actions" })[0];
		expect(trigger).toHaveAttribute("aria-haspopup", "menu");
		expect(trigger).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByRole("menu")).toBeInTheDocument();
		const apply = screen.getByRole("menuitem", { name: "Apply" });
		await user.click(apply);
		expect(wsMocks.wsSend).toHaveBeenCalledWith({
			type: "update_meta",
			docName: "brief",
			charte: "atelier-intention",
		});
	});

	it("uses an accent hover affordance in grid view", async () => {
		const user = userEvent.setup();
		render(<ChartesTab />);
		await screen.findByText("atelier-intention");

		await user.click(screen.getByRole("button", { name: "Grid view" }));
		const charteName = await screen.findByText("atelier-intention");
		expect(charteName.closest("button")).toHaveClass(
			"hover:border-accent/40",
			"hover:ring-accent/30",
		);
	});

	it("uses the canonical localized token-group labels in the preview", async () => {
		setLang("fr");
		const user = userEvent.setup();
		render(<ChartesTab />);

		await user.click(await screen.findByText("atelier-intention"));

		expect(screen.getByRole("heading", { name: "Couleurs" })).toBeVisible();
		expect(screen.getByRole("heading", { name: "Espacements" })).toBeVisible();
	});
});

function makeDoc(name: string): Document {
	return {
		id: `id-${name}`,
		name,
		category: "test",
		canvas: { w: 210, h: 297, background: "#fff" },
		pages: [{ id: `${name}-1`, name: "Page 1", elements: [] }],
		activePage: 0,
	};
}
