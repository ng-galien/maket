import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AnchoredMenu,
	AnchoredMenuItem,
	computeAnchoredMenuPosition,
} from "./AnchoredMenu";

afterEach(cleanup);

describe("AnchoredMenu", () => {
	it("transfers focus, supports arrow navigation, and returns focus on Escape", async () => {
		const user = userEvent.setup();
		render(<MenuHarness />);
		const trigger = screen.getByRole("button", { name: "Actions" });

		await user.click(trigger);
		expect(trigger).toHaveAttribute("aria-haspopup", "menu");
		expect(trigger).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByRole("menu")).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus();

		await user.keyboard("{ArrowDown}");
		expect(screen.getByRole("menuitem", { name: "Second" })).toHaveFocus();
		const focus = vi.spyOn(trigger, "focus");
		await user.keyboard("{Escape}");

		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
		expect(focus).toHaveBeenCalledWith({ preventScroll: true });
	});

	it("closes when the user clicks outside", async () => {
		const user = userEvent.setup();
		render(<MenuHarness />);
		await user.click(screen.getByRole("button", { name: "Actions" }));

		await user.click(screen.getByRole("button", { name: "After" }));

		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
	});

	it("closes on Shift+Tab and continues before the trigger", async () => {
		const user = userEvent.setup();
		render(<MenuHarness />);
		await user.click(screen.getByRole("button", { name: "Actions" }));

		await user.tab({ shift: true });

		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Before" })).toHaveFocus();
	});

	it("closes on Tab and continues after the trigger", async () => {
		const user = userEvent.setup();
		render(<MenuHarness />);
		await user.click(screen.getByRole("button", { name: "Actions" }));

		await user.tab();

		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
	});

	it("does not scroll-focus the trigger when the viewport closes the menu", async () => {
		const user = userEvent.setup();
		render(<MenuHarness />);
		const trigger = screen.getByRole("button", { name: "Actions" });
		await user.click(trigger);

		fireEvent.scroll(window);

		await waitFor(() =>
			expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
		);
		expect(trigger).not.toHaveFocus();
	});

	it("does not restore trigger focus when resize closes the menu", async () => {
		const user = userEvent.setup();
		render(<MenuHarness />);
		const trigger = screen.getByRole("button", { name: "Actions" });
		await user.click(trigger);

		fireEvent(window, new Event("resize"));

		await waitFor(() =>
			expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
		);
		expect(trigger).not.toHaveFocus();
	});
});

describe("computeAnchoredMenuPosition", () => {
	it("flips above a bottom anchor and clamps both axes to the viewport", () => {
		expect(
			computeAnchoredMenuPosition({
				anchor: { top: 570, bottom: 594, left: 760, right: 790 },
				menuWidth: 200,
				menuHeight: 180,
				viewportWidth: 800,
				viewportHeight: 600,
				align: "start",
			}),
		).toEqual({ top: 386, left: 592, placement: "top" });
	});
});

function MenuHarness() {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	return (
		<>
			<button type="button">Before</button>
			<button
				ref={anchorRef}
				type="button"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				Actions
			</button>
			{open && (
				<AnchoredMenu anchorRef={anchorRef} onClose={() => setOpen(false)}>
					<AnchoredMenuItem onClick={vi.fn()}>First</AnchoredMenuItem>
					<AnchoredMenuItem onClick={vi.fn()}>Second</AnchoredMenuItem>
				</AnchoredMenu>
			)}
			<button type="button">After</button>
		</>
	);
}
